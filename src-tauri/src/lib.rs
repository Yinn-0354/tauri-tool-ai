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

/// 启动 Python sidecar:python main.py,工作目录指向 python-backend。
/// stdout/stderr 重定向到日志文件(此前是 Stdio::null,导致 FastAPI 请求日志看不到,调试盲点)。
fn start_sidecar() -> std::io::Result<Child> {
    let mut cmd = Command::new("python");
    cmd.arg("main.py");
    // 开发期 tauri dev 工作目录为 src-tauri,python-backend 在上一级
    let cur = env::current_dir()?;
    let pb = cur.join("../python-backend");
    cmd.current_dir(&pb);
    // 重定向到日志文件(append 模式,保留多次启动历史;utf-8 兼容中文)
    let log_path = backend_log_path();
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let log_file_err = log_file.try_clone()?;
    cmd.stdout(Stdio::from(log_file)).stderr(Stdio::from(log_file_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW,不弹控制台
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn()
}

/// 读取 Python 写入的端口文件
fn read_port() -> Option<u16> {
    let path = env::temp_dir().join(PORT_FILE);
    let content = fs::read_to_string(&path).ok()?;
    content.trim().parse::<u16>().ok()
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
            let child = start_sidecar()?;
            app.state::<SidecarChild>().0.lock().unwrap().replace(child);
            // 轮询端口文件,直到 Python 就绪或超时
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
        // 退出时 kill sidecar 进程树
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarChild>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
