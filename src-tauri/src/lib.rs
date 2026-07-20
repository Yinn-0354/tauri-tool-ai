use std::fs;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const CREATE_NO_WINDOW: u32 = 0x08000008; // CREATE_NO_WINDOW | DETACHED_PROCESS

/// Python Sidecar 进程句柄，应用退出时 kill
struct SidecarProcess(Mutex<Option<Child>>);

/// Python 后端端口号
struct BackendPort(Mutex<Option<u16>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .manage(BackendPort(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet, get_backend_url, get_backend_status])
        .setup(|app| {
            match start_python_sidecar(app.handle()) {
                Ok(()) => {},
                Err(e) => {
                    let msg = format!("Failed to start Python: {}", e);
                    eprintln!("[tauri] {}", msg);
                    // 写入日志文件方便排查
                    let _ = fs::write(
                        std::env::temp_dir().join("tauri-tool-ai-error.log"),
                        &msg,
                    );
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                _kill_sidecar(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 启动 Python FastAPI Sidecar 进程
fn start_python_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 按优先级查找 python-backend 目录
    let search_paths: Vec<std::path::PathBuf> = vec![
        app.path().resource_dir().unwrap_or_default().join("python-backend"),
        std::env::current_exe()?.parent().unwrap_or(std::path::Path::new(".")).join("python-backend"),
        std::env::current_dir()?.join("python-backend"),
        // 开发模式: 从 Cargo 项目根目录查找
        std::env::current_dir()?.join("..").join("..").join("python-backend"),
    ];

    let backend_dir = search_paths.iter().find(|p| p.join("main.py").exists())
        .cloned()
        .unwrap_or_else(|| search_paths[0].clone());

    eprintln!("[tauri] Starting python backend from: {}", backend_dir.display());

    // 清除旧的端口文件
    let port_file = std::env::temp_dir().join("tauri-tool-ai-port.txt");
    let _ = fs::remove_file(&port_file);

    // 仅使用 python3 启动
    let python_cmds = ["python"];
    let mut child = None;
    for cmd in &python_cmds {
        let mut command = Command::new(cmd);
        command.arg("main.py");
        // 开发模式（cargo tauri dev = debug 构建）开启后端热重载；
        // 生产构建（cargo tauri build = release）不传 --reload，无重载开销。
        if cfg!(debug_assertions) {
            command.arg("--reload");
        }
        if let Ok(c) = command
            .current_dir(&backend_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            child = Some(c);
            break;
        }
    }
    let mut child = child.ok_or("Python not found")?;

    // 轮询端口文件 (最多 15 秒)，同时检测 Python 进程是否退出
    for _ in 0..75 {
        std::thread::sleep(std::time::Duration::from_millis(200));

        // 检测 Python 进程是否已退出
        if let Ok(Some(status)) = child.try_wait() {
            let mut err = String::new();
            if let Some(ref mut s) = child.stderr {
                let _ = s.read_to_string(&mut err);
            }
            let msg = if err.is_empty() {
                format!("Python exited with {:?} (no stderr output)", status)
            } else {
                format!("Python exited with {:?}\nstderr:\n{}", status, err)
            };
            let _ = fs::write(std::env::temp_dir().join("tauri-tool-ai-error.log"), &msg);
            return Err(msg.into());
        }

        if let Ok(port_str) = fs::read_to_string(&port_file) {
            if let Ok(port) = port_str.trim().parse::<u16>() {
                if port > 0 {
                    let port_state = app.state::<BackendPort>();
                    *port_state.0.lock().unwrap() = Some(port);
                    // 端口就绪后再把进程句柄存入 state（后续用于清理）
                    let state = app.state::<SidecarProcess>();
                    *state.0.lock().unwrap() = Some(child);
                    println!("Python backend started on port {}", port);
                    return Ok(());
                }
            }
        }
    }

    eprintln!("[tauri] Warning: Python backend port file not found after {} attempts", 75);
    Ok(())
}

#[tauri::command]
fn greet(name: String) -> String {
    format!("你好, {}! 来自 Tauri Tool AI", name)
}

#[tauri::command]
fn get_backend_url(port: State<'_, BackendPort>) -> Result<String, String> {
    let guard = port.0.lock().unwrap();
    match *guard {
        Some(p) => Ok(format!("http://127.0.0.1:{}", p)),
        None => Err("Backend not ready".into()),
    }
}

#[tauri::command]
fn get_backend_status() -> String {
    let log_path = std::env::temp_dir().join("tauri-tool-ai-error.log");
    if log_path.exists() {
        fs::read_to_string(&log_path).unwrap_or_else(|_| "Unknown error".into())
    } else {
        "Python backend running".into()
    }
}

/// 应用退出时清理 sidecar 进程树
impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let pid = child.id();
                // 杀死整个进程树（包括 uvicorn workers 和 conhost）
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
                let _ = child.wait();
            }
        }
    }
}

fn _kill_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let pid = child.id();
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
                let _ = child.wait();
            }
        }
    }
}
