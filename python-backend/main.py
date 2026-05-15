"""Tauri Tool AI — Python FastAPI Sidecar 入口

启动在随机端口，将端口写入临时文件供 Rust 进程读取。
"""

import json
import os
import socket
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from readers.excel import read_excel_preview
from readers.csv import read_csv, read_tab

# ─── FastAPI app ────────────────────────────────────────────────

app = FastAPI(title="Tauri Tool AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 数据存储 ───────────────────────────────────────────────────

def _sources_path() -> Path:
    return Path(__file__).parent / "sources.json"


def _load_sources() -> list[dict]:
    path = _sources_path()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def _save_sources(sources: list[dict]) -> None:
    _sources_path().write_text(
        json.dumps(sources, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# 内存缓存: table_id → { columns, rows, source_id, sheet }
loaded_tables: dict[str, dict[str, Any]] = {}

# ─── 模型 ───────────────────────────────────────────────────────

class AddSourceRequest(BaseModel):
    name: str
    type: str   # file / wps / db
    path: str


class LoadTableRequest(BaseModel):
    sourceId: str
    sheet: str | None = None


# ─── 数据源 CRUD ───────────────────────────────────────────────

@app.get("/api/table/sources")
async def list_sources():
    """获取全部数据源列表"""
    return _load_sources()


@app.post("/api/table/sources")
async def add_source(req: AddSourceRequest):
    """添加数据源"""
    sources = _load_sources()
    source = {
        "id": uuid.uuid4().hex[:12],
        "name": req.name,
        "type": req.type,
        "path": req.path,
        "addedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    sources.append(source)
    _save_sources(sources)
    return source


@app.delete("/api/table/sources/{source_id}")
async def delete_source(source_id: str):
    """删除数据源"""
    sources = _load_sources()
    before = len(sources)
    sources = [s for s in sources if s["id"] != source_id]
    if len(sources) == before:
        raise HTTPException(404, "数据源不存在")
    _save_sources(sources)
    return {"ok": True}


# ─── 加载与查询 ────────────────────────────────────────────────

@app.post("/api/table/load")
async def load_table(req: LoadTableRequest):
    """加载数据源，存入内存缓存，返回表标识"""
    sources = _load_sources()
    source = next((s for s in sources if s["id"] == req.sourceId), None)
    if not source:
        raise HTTPException(404, "数据源不存在")

    path = source["path"]

    if not os.path.isfile(path):
        raise HTTPException(404, f"文件不存在: {path}")

    table_id = uuid.uuid4().hex[:8]
    ext = path.lower()

    if source["type"] == "file" and ext.endswith((".xlsx", ".xls", ".xlsm", ".xltx")):
        result = read_excel_preview(path, req.sheet)
    elif source["type"] == "file" and ext.endswith(".csv"):
        result = read_csv(path)
    elif source["type"] == "file" and ext.endswith((".tab", ".tsv", ".txt")):
        result = read_tab(path)
    else:
        raise HTTPException(400, f"不支持的文件格式: {Path(path).suffix}")

    columns = result["columns"]
    rows = result["rows"]

    loaded_tables[table_id] = {
        "sourceId": req.sourceId,
        "sheet": req.sheet,
        "columns": columns,
        "rows": rows,
    }

    return {
        "id": table_id,
        "sourceId": req.sourceId,
        "columns": columns,
        "totalRows": len(rows),
    }


@app.get("/api/table/data/{table_id}")
async def table_data(
    table_id: str,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=1000),
):
    """分页获取表格数据"""
    table = loaded_tables.get(table_id)
    if not table:
        raise HTTPException(404, "表格未加载")

    rows = table["rows"]
    total = len(rows)
    start = (page - 1) * pageSize
    end = start + pageSize
    page_rows = rows[start:end]

    return {
        "columns": table["columns"],
        "rows": page_rows,
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


# ─── 健康检查 ──────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ─── 启动逻辑 ──────────────────────────────────────────────────

def _get_free_port() -> int:
    """绑定 127.0.0.1:0 让 OS 分配一个随机空闲端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get_port_file_path() -> str:
    return os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")


def _write_port_file(port: int) -> None:
    with open(_get_port_file_path(), "w") as f:
        f.write(str(port))


if __name__ == "__main__":
    port = _get_free_port()
    _write_port_file(port)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
