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
from jinja2 import Environment, TemplateSyntaxError
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

def _user_data_dir() -> Path:
    """获取用户数据目录（打包后可写）

    Windows: %APPDATA%/tauri-tool-ai/
    其他平台: ~/.tauri-tool-ai/
    """
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path.home()
    data_dir = base / "tauri-tool-ai"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _sources_path() -> Path:
    return _user_data_dir() / "sources.json"


def _legacy_data_path(filename: str) -> Path:
    return Path(__file__).parent / filename


def _migrate_legacy_json(filename: str, target: Path) -> None:
    if target.exists():
        return
    legacy = _legacy_data_path(filename)
    if legacy.exists():
        target.write_text(legacy.read_text(encoding="utf-8"), encoding="utf-8")


def _load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _load_sources() -> list[dict]:
    path = _sources_path()
    _migrate_legacy_json("sources.json", path)
    return _load_json_list(path)


def _save_sources(sources: list[dict]) -> None:
    _sources_path().write_text(
        json.dumps(sources, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# 内存缓存: table_id → { sourceId, df, columns }
loaded_tables: dict[str, dict] = {}

# ─── 模型 ───────────────────────────────────────────────────────

class ColumnGroupConfig(BaseModel):
    id: str
    title: str
    columns: list[str]


class AddSourceRequest(BaseModel):
    name: str
    type: str   # file / wps / db
    path: str
    alias: str = ""
    headerRow: int = 1
    skipRows: list[int] = Field(default_factory=list)
    remarkRows: list[int] = Field(default_factory=list)
    columnGroups: list[ColumnGroupConfig] = Field(default_factory=list)


class UpdateSourceRequest(BaseModel):
    name: str | None = None
    alias: str | None = None
    headerRow: int | None = None
    skipRows: list[int] | None = None
    remarkRows: list[int] | None = None
    columnGroups: list[ColumnGroupConfig] | None = None


class LoadTableRequest(BaseModel):
    sourceId: str
    sheet: str | None = None


class ColumnFilter(BaseModel):
    column: str
    op: str  # eq / ne / contains / gt / lt / gte / lte / in / between
    value: object = None


def _dump_column_groups(groups: list[ColumnGroupConfig] | list[dict] | None) -> list[dict]:
    """序列化列分组配置，保留用户配置原文。"""
    result: list[dict] = []
    for group in groups or []:
        if isinstance(group, BaseModel):
            item = group.model_dump()
        elif isinstance(group, dict):
            item = group
        else:
            continue
        group_id = str(item.get("id", "")).strip()
        title = str(item.get("title", "")).strip()
        columns = [str(c).strip() for c in item.get("columns", []) if str(c).strip()]
        result.append({"id": group_id, "title": title, "columns": columns})
    return result


def _is_contiguous(indices: list[int]) -> bool:
    if not indices:
        return False
    ordered = sorted(indices)
    return ordered == list(range(ordered[0], ordered[-1] + 1))


def _normalize_column_groups(groups: list[dict], columns: list[str]) -> list[dict]:
    """根据真实列名过滤无效列分组；无效分组直接降级忽略。"""
    col_index = {col: idx for idx, col in enumerate(columns)}
    used_columns: set[str] = set()
    used_ids: set[str] = set()
    normalized: list[dict] = []

    for group in _dump_column_groups(groups):
        group_id = group["id"]
        title = group["title"]
        if not group_id or group_id in used_ids or not title:
            continue

        group_columns: list[str] = []
        seen_in_group: set[str] = set()
        for col in group["columns"]:
            if col not in col_index or col in seen_in_group or col in used_columns:
                continue
            seen_in_group.add(col)
            group_columns.append(col)

        if len(group_columns) < 2:
            continue

        group_columns = sorted(group_columns, key=lambda c: col_index[c])
        if not _is_contiguous([col_index[c] for c in group_columns]):
            continue

        used_ids.add(group_id)
        used_columns.update(group_columns)
        normalized.append({"id": group_id, "title": title, "columns": group_columns})

    return normalized


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
        "remarkRows": req.remarkRows,
        "columnGroups": _dump_column_groups(req.columnGroups),
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
            if req.remarkRows is not None:
                s["remarkRows"] = req.remarkRows
            if req.columnGroups is not None:
                s["columnGroups"] = _dump_column_groups(req.columnGroups)
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
    remark_rows = source.get("remarkRows", [])

    try:
        if source["type"] == "file" and ext.endswith((".xlsx", ".xls", ".xlsm", ".xltx")):
            df, remark_data = read_excel_df(path, req.sheet, header_row, skip_rows, remark_rows)
        elif source["type"] == "file" and ext.endswith(".csv"):
            df, remark_data = read_csv_df(path, header_row, skip_rows, remark_rows)
        elif source["type"] == "file" and ext.endswith((".tab", ".tsv", ".txt")):
            df, remark_data = read_tab_df(path, header_row, skip_rows, remark_rows)
        else:
            raise HTTPException(400, f"不支持的文件格式: {Path(path).suffix}")
    except Exception as e:
        raise HTTPException(500, f"读取文件失败: {e}")

    columns = list(df.columns)
    column_groups = _normalize_column_groups(source.get("columnGroups", []), columns)

    loaded_tables[table_id] = {
        "sourceId": req.sourceId,
        "df": df,
        "columns": columns,
        "remarkData": remark_data,
        "columnGroups": column_groups,
    }

    return {
        "id": table_id,
        "sourceId": req.sourceId,
        "columns": columns,
        "totalRows": len(df),
        "remarkData": remark_data,
        "columnGroups": column_groups,
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
        "remarkData": table.get("remarkData", []),
    }


# ─── 健康检查 ──────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ─── 模板 CRUD ──────────────────────────────────────────────────

def _templates_path() -> Path:
    return _user_data_dir() / "templates.json"


def _load_templates() -> list[dict]:
    path = _templates_path()
    _migrate_legacy_json("templates.json", path)
    return _load_json_list(path)


def _save_templates(templates: list[dict]) -> None:
    _templates_path().write_text(
        json.dumps(templates, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class SaveTemplateRequest(BaseModel):
    name: str
    description: str | None = None
    page_schema: dict  # PageSchema JSON


class UpdateTemplateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    page_schema: dict | None = None


@app.get("/api/table/templates")
async def list_templates():
    """获取全部模板列表"""
    return _load_templates()


@app.post("/api/table/templates")
async def create_template(req: SaveTemplateRequest):
    """创建/保存模板"""
    templates = _load_templates()
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    template = {
        "id": uuid.uuid4().hex[:12],
        "name": req.name,
        "description": req.description,
        "schema": req.page_schema,
        "createdAt": now,
        "updatedAt": now,
    }
    templates.append(template)
    _save_templates(templates)
    return template


@app.put("/api/table/templates/{template_id}")
async def update_template(template_id: str, req: UpdateTemplateRequest):
    """更新模板"""
    templates = _load_templates()
    for t in templates:
        if t["id"] == template_id:
            if req.name is not None:
                t["name"] = req.name
            if req.description is not None:
                t["description"] = req.description
            if req.page_schema is not None:
                t["schema"] = req.page_schema
            t["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _save_templates(templates)
            return t
    raise HTTPException(404, "模板不存在")


@app.delete("/api/table/templates/{template_id}")
async def delete_template(template_id: str):
    """删除模板"""
    templates = _load_templates()
    before = len(templates)
    templates = [t for t in templates if t["id"] != template_id]
    if len(templates) == before:
        raise HTTPException(404, "模板不存在")
    _save_templates(templates)
    return {"ok": True}


# ─── Jinja2 模板渲染（文本模板模式） ──────────────────────────

class RenderTemplateRequest(BaseModel):
    template: str  # Jinja2 模板字符串
    tableId: str
    maxRows: int = 500


@app.post("/api/table/render-template")
async def render_template(req: RenderTemplateRequest):
    """用 Jinja2 渲染文本模板，返回渲染后的文本列表"""
    table = loaded_tables.get(req.tableId)
    if not table:
        raise HTTPException(404, "表格未加载")

    df = table["df"]
    columns = table["columns"]
    rows = df.head(req.maxRows).values.tolist()

    env = Environment(autoescape=False)
    try:
        tmpl = env.from_string(req.template)
    except TemplateSyntaxError as e:
        raise HTTPException(400, f"模板语法错误: {e}")

    rendered = []
    for row in rows:
        context = {col: row[i] for i, col in enumerate(columns)}
        context["*"] = " | ".join(str(c) for c in row)
        try:
            rendered.append(tmpl.render(**context))
        except Exception as e:
            rendered.append(f"[渲染错误: {e}]")

    return {"rendered": rendered, "total": len(rows)}


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
