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
from vcs import svn as svn_blame_mod

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


# ───────────────────────── 模块1 SVN blame(可开关) ─────────────────────────

class BlameRequest(BaseModel):
    path: str
    revision: str = "BASE"
    lineNumbers: list[int] | None = None  # 可选:只返回指定行(按需触发)


@app.post("/api/vcs/blame")
async def vcs_blame(req: BlameRequest):
    """对文件执行 svn blame,返回行级元信息(lineNumber/revision/author/date)。

    - revision 默认 BASE(工作副本 pristine 版本)
    - lineNumbers 非空时只返回这些行(按需触发,但内部仍跑一次 blame 并缓存)
    - 结果按 (abspath, revision) 做 LRU 缓存,重复打开不重跑
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    try:
        if req.lineNumbers:
            rows = await svn_blame_mod.svn_blame_lines(
                req.path, req.lineNumbers, req.revision
            )
            return {"rows": list(rows.values()), "cached": False}
        rows = await svn_blame_mod.svn_blame(req.path, req.revision)
        return {"rows": rows, "cached": False}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/vcs/blame/clear")
def vcs_blame_clear(req: BlameRequest):
    """清空 blame 缓存(或只清某 path)。"""
    n = svn_blame_mod.clear_blame_cache(req.path if req.path else None)
    return {"cleared": n}


# ───────────────────────── 模块1 SVN log(提交详情弹窗) ─────────────────────────

class LogRequest(BaseModel):
    path: str
    revision: str  # 如 "12345" 或 "BASE"/"HEAD"


@app.post("/api/vcs/log")
async def vcs_log(req: LogRequest):
    """查询单个 revision 的提交详情(供前端提交详情弹窗)。

    后端执行 svn log --xml -v -r <revision> <path>,返回第一个 logentry 的
    revision/author/date/message/changedPaths。
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    try:
        result = await svn_blame_mod.svn_log(req.path, req.revision)
    except FileNotFoundError as e:
        # svn 不可用 → 400;无 logentry → 404。这里按 404 处理路径/版本不存在
        # svn 不可用的提示含"找不到 svn 可执行文件",归 400
        if "找不到 svn 可执行文件" in str(e):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


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
