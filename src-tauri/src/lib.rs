use std::fs;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Python Sidecar 进程句柄，应用退出时 kill
struct SidecarProcess(Mutex<Option<Child>>);

/// Python 后端端口号
struct BackendPort(Mutex<Option<u16>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarProcess(Mutex::new(None)))
        .manage(BackendPort(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet, get_backend_url])
        .setup(|app| {
            if let Err(e) = start_python_sidecar(app.handle()) {
                eprintln!("Warning: Failed to start Python sidecar: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 启动 Python FastAPI Sidecar 进程
fn start_python_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let python_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("python-backend");

    // 开发模式使用项目目录
    let backend_dir = if python_dir.exists() {
        python_dir
    } else {
        std::env::current_dir()?.join("python-backend")
    };

    let child = Command::new("python")
        .arg("main.py")
        .current_dir(&backend_dir)
        .spawn()?;

    let state = app.state::<SidecarProcess>();
    *state.0.lock().unwrap() = Some(child);

    // 轮询端口文件 (最多 10 秒)
    let port_file = std::env::temp_dir().join("tauri-tool-ai-port.txt");
    for _ in 0..50 {
        if let Ok(port_str) = fs::read_to_string(&port_file) {
            if let Ok(port) = port_str.trim().parse::<u16>() {
                let port_state = app.state::<BackendPort>();
                *port_state.0.lock().unwrap() = Some(port);
                println!("Python backend started on port {}", port);
                return Ok(());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    println!("Warning: Python backend port file not found, continuing without backend");
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

/// 应用退出时清理 sidecar 进程
impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}
