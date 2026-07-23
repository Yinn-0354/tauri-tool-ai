"""配置表检查工具 · Python FastAPI sidecar

随机端口启动 → 写入临时文件 tauri-tool-ai-port.txt → Rust 轮询读取传前端。
/api/health 健康检查;模块1 表格数据层:/api/table/open + /api/table/data(见 table_io)。
"""
import os
import socket
import tempfile

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import table_io

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


# ───────────────────────── 模块1 表格数据层 ─────────────────────────

class TableOpenRequest(BaseModel):
    path: str


@app.post("/api/table/open")
def table_open(req: TableOpenRequest):
    """打开本地表格文件(xlsx/xls/tab/txt/tsv),落盘 Parquet 缓存,返回 schema 与 rowCount。"""
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    try:
        table_id, columns, row_count, _ = table_io.open_table(req.path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001 - 把解析异常转 400,避免 500 栈泄漏
        raise HTTPException(status_code=400, detail=f"解析失败: {e}")
    return {
        "tableId": table_id,
        "rowCount": row_count,
        "columns": columns,
    }


@app.get("/api/table/data")
def table_data(
    tableId: str = Query(..., description="open 返回的 tableId"),
    startRow: int = Query(0, ge=0),
    endRow: int = Query(..., ge=0),
    sortCol: str | None = Query(None, description="可选排序列名"),
    sortAsc: bool = Query(True, description="sortCol 升序(True)/降序(False)"),
):
    """对缓存 Parquet 做 lazy scan,可选 sort,slice 后取二维行数组。"""
    if endRow <= startRow:
        raise HTTPException(status_code=400, detail="endRow 必须大于 startRow")
    try:
        rows, row_count = table_io.read_rows(
            table_id=tableId,
            start_row=startRow,
            end_row=endRow,
            sort_col=sortCol,
            sort_asc=sortAsc,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"读取失败: {e}")
    return {
        "startRow": startRow,
        "endRow": endRow,
        "rowCount": row_count,
        "rows": rows,
    }


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
