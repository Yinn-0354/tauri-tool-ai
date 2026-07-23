"""配置表检查工具 · 表格数据层(模块1 数据管道)

职责:
- open_table(path): 按扩展名把本地表格文件解析为 polars DataFrame,落盘为 Parquet 缓存;
  命中缓存且 mtime/size 一致时直接 scan_parquet(mmap),不重新解析。
- read_rows(tableId, ...): 对缓存 Parquet 做 lazy scan + 可选 sort + slice,取二维行数组。

设计要点:
- tableId = sha1(f"{path}|{mtime}|{size}") 十六进制
- 缓存目录: %LOCALAPPDATA%/tauri-tool-ai/cache (回退 %TEMP%)
- 缓存文件: <tableId>.parquet,元数据 <tableId>.meta.json 记录源 path/mtime/size
- .xlsx/.xls -> pl.read_excel(engine="calamine")(fastexcel 驱动)
- .tab/.txt/.tsv -> polars read_csv(separator="\t");编码 utf8-lossy 优先,探测到非 utf8 再按探测编码重读
- 不用 pandas/openpyxl
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import polars as pl

# ───────────────────────── 缓存目录 ─────────────────────────

_LOCALAPPDATA = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
CACHE_DIR = Path(_LOCALAPPDATA) / "tauri-tool-ai" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_TAB_EXT = {".tab", ".txt", ".tsv"}
_XLSX_EXT = {".xlsx", ".xls"}


# ───────────────────────── tableId / 元数据 ─────────────────────────

def _file_signature(path: str) -> tuple[float, int, str]:
    """返回 (mtime, size, tableId)。tableId = sha1(path|mtime|size)。"""
    st = os.stat(path)
    mtime, size = st.st_mtime, st.st_size
    raw = f"{path}|{mtime}|{size}".encode("utf-8", errors="surrogatepass")
    table_id = hashlib.sha1(raw).hexdigest()
    return mtime, size, table_id


def _cache_paths(table_id: str) -> tuple[Path, Path]:
    parquet = CACHE_DIR / f"{table_id}.parquet"
    meta = CACHE_DIR / f"{table_id}.meta.json"
    return parquet, meta


def _load_meta(meta_path: Path) -> dict[str, Any] | None:
    if not meta_path.exists():
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _write_meta(meta_path: Path, *, path: str, mtime: float, size: int, table_id: str) -> None:
    payload = {"path": path, "mtime": mtime, "size": size, "tableId": table_id}
    tmp = meta_path.with_suffix(".meta.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, meta_path)


# ───────────────────────── 编码探测(.tab/.txt/.tsv) ─────────────────────────

def _detect_encoding(path: str) -> str | None:
    """读前 64KB bytes 用 chardet 探测编码;失败回退 None。"""
    try:
        with open(path, "rb") as f:
            raw = f.read(65536)
    except OSError:
        return None
    if not raw:
        return None
    enc: str | None = None
    try:
        import chardet  # type: ignore

        det = chardet.detect(raw)
        if det and det.get("encoding"):
            enc = det["encoding"]
    except Exception:
        enc = None
    if not enc:
        try:
            from charset_normalizer import from_bytes

            result = from_bytes(raw).best()
            if result is not None:
                enc = str(result.encoding)
        except Exception:
            enc = None
    return enc


def _has_excess_replacement(df: pl.DataFrame, sample_rows: int = 200) -> bool:
    """启发式:对前若干行的字符串列统计 U+FFFD 替换字符占比,>5% 视为非 utf8。"""
    str_cols = [c for c, dt in df.schema.items() if dt == pl.String]
    if not str_cols:
        return False
    head = df.head(sample_rows)
    total_chars = 0
    repl_chars = 0
    for c in str_cols:
        for v in head[c].to_list():
            if isinstance(v, str):
                total_chars += len(v)
                repl_chars += v.count("�")
    if total_chars == 0:
        return False
    return (repl_chars / total_chars) > 0.05


def _read_tab(path: str) -> pl.DataFrame:
    """读 \t 分隔文本。先 utf8-lossy,若替换字符过多则探测编码二次读;保留 utf8-lossy 兜底。"""
    # 1) utf8-lossy 首读(把无法解码的字节替换为 U+FFFD,不抛错)
    df = pl.read_csv(path, separator="\t", encoding="utf8-lossy", infer_schema_length=1000)
    if not _has_excess_replacement(df):
        return df
    # 2) 探测编码二次读
    enc = _detect_encoding(path)
    if enc:
        try:
            df2 = pl.read_csv(path, separator="\t", encoding=enc, infer_schema_length=1000)
            if not _has_excess_replacement(df2):
                return df2
        except Exception:
            pass
    # 3) 兜底:保留 utf8-lossy 结果
    return df


# ───────────────────────── open_table ─────────────────────────

def open_table(path: str) -> tuple[str, list[dict[str, str]], int, Path]:
    """打开本地表格文件,返回 (tableId, columns, rowCount, cache_path)。

    columns: [{"name": "...", "dtype": "Int64"}, ...](dtype 为 polars dtype 字符串)
    rowCount: 总行数(不含表头)
    cache_path: 落盘的 Parquet 路径

    缓存命中(path 的 mtime+size 与 .meta.json 一致)时直接复用 Parquet,不重新解析。
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"表格文件不存在: {path}")

    mtime, size, table_id = _file_signature(path)
    parquet_path, meta_path = _cache_paths(table_id)

    meta = _load_meta(meta_path)
    cache_hit = (
        meta is not None
        and meta.get("mtime") == mtime
        and meta.get("size") == size
        and parquet_path.exists()
    )

    if not cache_hit:
        ext = os.path.splitext(path)[1].lower()
        if ext in _XLSX_EXT:
            df = pl.read_excel(path, engine="calamine")
        elif ext in _TAB_EXT:
            df = _read_tab(path)
        else:
            # 未知扩展名:按 \t 分隔文本兜底尝试
            df = _read_tab(path)
        # 落盘 Parquet(列式,后续可 mmap)
        df.write_parquet(parquet_path)
        _write_meta(meta_path, path=path, mtime=mtime, size=size, table_id=table_id)

    # 取 schema 与行数:用 lazy scan 不全量物化
    lazy = pl.scan_parquet(parquet_path)
    schema = lazy.collect_schema()
    columns = [{"name": name, "dtype": str(dtype)} for name, dtype in schema.items()]
    # 行数:parquet 元数据可直接读,无需 collect 全表
    row_count = pl.scan_parquet(parquet_path).select(pl.len()).collect().item()

    return table_id, columns, row_count, parquet_path


# ───────────────────────── read_rows ─────────────────────────

def _to_jsonable(v: Any) -> Any:
    """把 polars 标量转为 JSON 可序列化类型。空值 None;datetime/decimal 转 str。"""
    if v is None:
        return None
    # bool/int/float/str 本身可序列化
    if isinstance(v, (bool, int, float, str)):
        return v
    # datetime/date/time/timedelta → ISO 字符串
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    # decimal.Decimal 等
    return str(v)


def read_rows(
    table_id: str,
    start_row: int,
    end_row: int,
    sort_col: str | None = None,
    sort_asc: bool = True,
) -> tuple[list[list[Any]], int]:
    """对缓存 Parquet 做 lazy scan,可选 sort,slice(start_row, end_row-startRow),collect。

    返回 (rows, rowCount):rows 为二维数组,顺序与 columns 一致,空值 None。
    """
    parquet_path, _ = _cache_paths(table_id)
    if not parquet_path.exists():
        raise FileNotFoundError(f"缓存不存在,请先 /api/table/open: tableId={table_id}")

    lazy = pl.scan_parquet(parquet_path)
    row_count = lazy.select(pl.len()).collect().item()

    if sort_col:
        schema = lazy.collect_schema()
        if sort_col in schema:
            lazy = lazy.sort(sort_col, descending=not sort_asc)

    length = max(0, end_row - start_row)
    if length == 0:
        return [], row_count

    # slice_pushdown 会让这个 slice 下推到 parquet 读取,不全量物化
    df = lazy.slice(start_row, length).collect()
    # rows() 返回 list[tuple];转二维 list 并规范化空值
    rows = [[_to_jsonable(v) for v in row] for row in df.rows()]
    return rows, row_count
