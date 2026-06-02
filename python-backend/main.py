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

import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from readers.excel import read_excel_df
from readers.csv import read_csv_df, read_tab_df

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


# 内存缓存: table_id → { sourceId, df, columns }
loaded_tables: dict[str, dict] = {}

# ─── 模型 ───────────────────────────────────────────────────────

class AddSourceRequest(BaseModel):
    name: str
    type: str   # file / wps / db
    path: str
    alias: str = ""
    headerRow: int = 1
    skipRows: list[int] = []


class UpdateSourceRequest(BaseModel):
    name: str | None = None
    alias: str | None = None
    headerRow: int | None = None
    skipRows: list[int] | None = None


class LoadTableRequest(BaseModel):
    sourceId: str
    sheet: str | None = None


class ColumnFilter(BaseModel):
    column: str
    op: str  # eq / ne / contains / gt / lt / gte / lte / in / between
    value: object = None


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
        "alias": req.alias,
        "headerRow": req.headerRow,
        "skipRows": req.skipRows,
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


@app.put("/api/table/sources/{source_id}")
async def update_source(source_id: str, req: UpdateSourceRequest):
    """更新数据源配置（名称、表头行、跳过行等）"""
    sources = _load_sources()
    for s in sources:
        if s["id"] == source_id:
            if req.name is not None:
                s["name"] = req.name
            if req.alias is not None:
                s["alias"] = req.alias
            if req.headerRow is not None:
                s["headerRow"] = req.headerRow
            if req.skipRows is not None:
                s["skipRows"] = req.skipRows
            _save_sources(sources)
            return s
    raise HTTPException(404, "数据源不存在")


# ─── 加载与查询 ────────────────────────────────────────────────

@app.post("/api/table/load")
async def load_table(req: LoadTableRequest):
    """加载数据源为 DataFrame，存入内存缓存，仅返回元信息"""
    sources = _load_sources()
    source = next((s for s in sources if s["id"] == req.sourceId), None)
    if not source:
        raise HTTPException(404, "数据源不存在")

    path = source["path"]

    if not os.path.isfile(path):
        raise HTTPException(404, f"文件不存在: {path}")

    table_id = uuid.uuid4().hex[:8]
    ext = path.lower()
    header_row = source.get("headerRow", 1)
    skip_rows = source.get("skipRows", [])

    try:
        if source["type"] == "file" and ext.endswith((".xlsx", ".xls", ".xlsm", ".xltx")):
            df = read_excel_df(path, req.sheet, header_row, skip_rows)
        elif source["type"] == "file" and ext.endswith(".csv"):
            df = read_csv_df(path, header_row, skip_rows)
        elif source["type"] == "file" and ext.endswith((".tab", ".tsv", ".txt")):
            df = read_tab_df(path, header_row, skip_rows)
        else:
            raise HTTPException(400, f"不支持的文件格式: {Path(path).suffix}")
    except Exception as e:
        raise HTTPException(500, f"读取文件失败: {e}")

    columns = list(df.columns)

    loaded_tables[table_id] = {
        "sourceId": req.sourceId,
        "df": df,
        "columns": columns,
    }

    return {
        "id": table_id,
        "sourceId": req.sourceId,
        "columns": columns,
        "totalRows": len(df),
    }


def _apply_filters(df: pd.DataFrame, filters: list[dict]) -> pd.DataFrame:
    """对 DataFrame 应用筛选条件"""
    for f in filters:
        col = f.get("column")
        op = f.get("op")
        val = f.get("value")

        if not col or col not in df.columns or not op:
            continue

        series = df[col]

        if op == "eq":
            df = df[series == str(val)]
        elif op == "ne":
            df = df[series != str(val)]
        elif op == "contains":
            df = df[series.str.contains(str(val), na=False)]
        elif op == "gt":
            df = df[pd.to_numeric(series, errors="coerce") > float(val)]
        elif op == "lt":
            df = df[pd.to_numeric(series, errors="coerce") < float(val)]
        elif op == "gte":
            df = df[pd.to_numeric(series, errors="coerce") >= float(val)]
        elif op == "lte":
            df = df[pd.to_numeric(series, errors="coerce") <= float(val)]
        elif op == "in" and isinstance(val, list):
            df = df[series.isin([str(v) for v in val])]
        elif op == "between" and isinstance(val, list) and len(val) == 2:
            num = pd.to_numeric(series, errors="coerce")
            df = df[num.between(float(val[0]), float(val[1]))]

    return df


@app.get("/api/table/data/{table_id}")
async def table_data(
    table_id: str,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=10000),
    sortCol: str | None = Query(None),
    sortOrder: str | None = Query(None),
    filters: str | None = Query(None, description="JSON 格式的筛选条件数组"),
):
    """筛选 + 排序 + 分页获取表格数据"""
    table = loaded_tables.get(table_id)
    if not table:
        raise HTTPException(404, "表格未加载")

    df = table["df"]

    # 筛选
    if filters:
        try:
            filter_list = json.loads(filters)
            if isinstance(filter_list, list) and filter_list:
                df = _apply_filters(df, filter_list)
        except (json.JSONDecodeError, TypeError):
            pass

    filtered_total = len(df)

    # 排序
    if sortCol and sortCol in df.columns:
        ascending = sortOrder != "desc"
        # 尝试数值排序，失败则字符串排序
        numeric = pd.to_numeric(df[sortCol], errors="coerce")
        if numeric.notna().sum() > len(df) * 0.5:
            df = df.assign(_sort_key=numeric).sort_values("_sort_key", ascending=ascending, na_position="last").drop(columns=["_sort_key"])
        else:
            df = df.sort_values(sortCol, ascending=ascending, na_position="last")

    # 分页
    total = len(table["df"])
    start = (page - 1) * pageSize
    end = start + pageSize
    page_df = df.iloc[start:end]

    return {
        "columns": table["columns"],
        "rows": page_df.values.tolist(),
        "total": total,
        "filteredTotal": filtered_total,
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
