"""配置表检查工具 · Python FastAPI sidecar(最小版)

随机端口启动 → 写入临时文件 tauri-tool-ai-port.txt → Rust 轮询读取传前端。
本阶段只跑通 /api/health,后续在此扩展表格解析(polars)/SVN blame/MCP 集成。
"""
import os
import socket
import tempfile

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

PORT_FILE = os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")

app = FastAPI(title="配置表检查工具 Backend")

# dev:前端 localhost:5173 调后端,放开 CORS;生产收紧
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def write_port_file(port: int) -> None:
    with open(PORT_FILE, "w", encoding="utf-8") as f:
        f.write(str(port))


if __name__ == "__main__":
    port = get_free_port()
    write_port_file(port)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
