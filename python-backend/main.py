"""Tauri Tool AI — Python FastAPI Sidecar 入口

启动在随机端口，将端口写入临时文件供 Rust 进程读取。
"""

import os
import tempfile
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tauri Tool AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


def get_port_file_path() -> str:
    return os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")


def write_port_file(port: int) -> None:
    path = get_port_file_path()
    with open(path, "w") as f:
        f.write(str(port))


if __name__ == "__main__":
    # 随机端口: 0 让 OS 分配
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="info")
    server = uvicorn.Server(config)
    # 先获取实际分配的端口
    sock = config.bind_socket()
    port = sock.getsockname()[1]
    write_port_file(port)
    print(f"Backend started on port {port}")
    server.run(sockets=[sock])
