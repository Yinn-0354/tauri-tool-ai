use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// 后端 sidecar 端口(随机分配,启动后由 Python 写入临时文件)
struct BackendPort(Mutex<Option<u16>>);

/// 持有 sidecar 子进程句柄,退出时 kill
struct SidecarChild(Mutex<Option<Child>>);

const PORT_FILE: &str = "tauri-tool-ai-port.txt";
const POLL_INTERVAL: Duration = Duration::from_millis(200);
const POLL_MAX: u32 = 75; // 15s

/// 审核会话日志目录(PRD §6:写死 D:\temp\tauri-checker)。
/// Python sidecar 审核时按 <errorObjId>_<时间戳> 建子目录存对话/截图;
/// 软件关闭时由 Rust 主进程清掉(运行期间保留供排查)。崩溃则残留,可接受。
const CHECKER_LOG_DIR: &str = r"D:\temp\tauri-checker";

/// sidecar 日志目录:%LOCALAPPDATA%/tauri-tool-ai/logs(回退 %TEMP%)
fn log_dir() -> PathBuf {
    let base = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir());
    let dir = base.join("tauri-tool-ai").join("logs");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// sidecar 日志文件路径
fn backend_log_path() -> PathBuf {
    log_dir().join("backend.log")
}

/// 定位打包后的 sidecar exe:资源目录下的 backend.exe(由 CI/打包脚本经 bundle.resources 注入)。
/// dev 期无该资源 → 返回 None,回退 python main.py。
fn find_bundled_sidecar(app: &tauri::AppHandle) -> Option<PathBuf> {
    let res_dir = app.path().resource_dir().ok()?;
    let exe = res_dir.join("backend.exe");
    if exe.is_file() {
        Some(exe)
    } else {
        None
    }
}

/// 启动后端:优先用打包进来的 sidecar exe(生产);找不到则回退 python main.py(dev)。
/// stdout/stderr 重定向到日志文件;Windows CREATE_NO_WINDOW 不弹控制台。
/// 端口仍由 Python 写 %TEMP%/tauri-tool-ai-port.txt,Rust 轮询读。
fn start_sidecar(app: &tauri::AppHandle) -> std::io::Result<Child> {
    let log_path = backend_log_path();
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let log_file_err = log_file.try_clone()?;

    let mut cmd = if let Some(sidecar_exe) = find_bundled_sidecar(app) {
        // 生产:启动 PyInstaller 打的 sidecar exe(自包含 Python + 依赖)
        Command::new(sidecar_exe)
    } else {
        // dev:回退 python main.py(工作目录指向 python-backend)
        let mut c = Command::new("python");
        c.arg("main.py");
        let cur = env::current_dir()?;
        let pb = cur.join("../python-backend");
        c.current_dir(&pb);
        c
    };
    cmd.stdout(Stdio::from(log_file)).stderr(Stdio::from(log_file_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW,不弹控制台
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn()
}

/// 读取 Python 写入的端口文件,并验证该端口确实在监听(避免读到上次遗留的陈旧端口)。
fn read_port() -> Option<u16> {
    let path = env::temp_dir().join(PORT_FILE);
    let content = fs::read_to_string(&path).ok()?;
    let port = content.trim().parse::<u16>().ok()?;
    // 探测端口是否真在监听:连一下即断。连不上说明是陈旧端口,继续等。
    use std::net::TcpStream;
    use std::time::Duration as Dur;
    TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().ok()?, Dur::from_millis(200)).ok()?;
    Some(port)
}

#[tauri::command]
fn get_backend_url(state: tauri::State<BackendPort>) -> Result<String, String> {
    let port = state
        .0
        .lock()
        .unwrap()
        .ok_or_else(|| "backend port not ready".to_string())?;
    Ok(format!("http://127.0.0.1:{}", port))
}

/// 读取 sidecar 日志尾部(默认最后 200 行),供前端调试面板或排查使用
#[tauri::command]
fn get_backend_log(tail: Option<usize>) -> Result<String, String> {
    let path = backend_log_path();
    let content = fs::read_to_string(&path).map_err(|e| format!("读取日志失败: {e}"))?;
    let n = tail.unwrap_or(200);
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].join("\n"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(BackendPort(Mutex::new(None)))
        .manage(SidecarChild(Mutex::new(None)))
        .setup(|app| {
            // 启动前删除残留端口文件,避免读到上次 sidecar 的陈旧端口
            let _ = fs::remove_file(env::temp_dir().join(PORT_FILE));
            let child = start_sidecar(&app.handle())?;
            app.state::<SidecarChild>().0.lock().unwrap().replace(child);
            // 轮询端口文件,直到 Python 就绪(且端口真能连)或超时
            let port = (0..POLL_MAX)
                .find_map(|_| {
                    std::thread::sleep(POLL_INTERVAL);
                    read_port()
                })
                .ok_or_else(|| std::io::Error::other("timeout waiting for python port"))?;
            app.state::<BackendPort>().0.lock().unwrap().replace(port);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url, get_backend_log])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // 退出时 kill sidecar 进程树(主进程 + 其子进程,uvicorn reload 模式会有子进程)
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            if let Some(state) = app_handle.try_state::<SidecarChild>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let pid = child.id();
                    let _ = child.kill();
                    // Windows:taskkill /F /T 杀整个进程树,避免遗留 uvicorn 子进程
                    #[cfg(windows)]
                    {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID"])
                            .arg(pid.to_string())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .status();
                    }
                }
            }
            // 清理审核会话日志目录(PRD §6:运行期间保留供排查,软件关闭时清)。
            // 目录由 Python sidecar 审核时写入;Rust 主进程退出(=软件关闭)时删。
            let _ = fs::remove_dir_all(CHECKER_LOG_DIR);
        }
    });
}
