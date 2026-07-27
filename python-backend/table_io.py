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

# 缓存版本:version 不一致强制重建 parquet(用于切换 has_header 语义等)
CACHE_VERSION = 2

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
    payload = {"path": path, "mtime": mtime, "size": size, "tableId": table_id, "version": CACHE_VERSION}
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
    """读 \t 分隔文本(has_header=False,parquet 保存全量原始行)。

    先 utf8-lossy 首读,若替换字符过多则探测编码二次读;保留 utf8-lossy 兜底。
    has_header=False 让 parquet 行 = 原文件行(1-based 行号 = parquet 0-based+1),
    便于 headerRow/skipRows 按原文件行号语义统一处理。
    """
    # 1) utf8-lossy 首读(把无法解码的字节替换为 U+FFFD,不抛错)
    df = pl.read_csv(
        path, separator="\t", encoding="utf8-lossy", infer_schema_length=1000,
        has_header=False,
    )
    if not _has_excess_replacement(df):
        return df
    # 2) 探测编码二次读
    enc = _detect_encoding(path)
    if enc:
        try:
            df2 = pl.read_csv(
                path, separator="\t", encoding=enc, infer_schema_length=1000,
                has_header=False,
            )
            if not _has_excess_replacement(df2):
                return df2
        except Exception:
            pass
    # 3) 兜底:保留 utf8-lossy 结果
    return df


# ───────────────────────── open_table ─────────────────────────

def _normalize_skip_rows(skip_rows: list[list[int]] | None) -> list[tuple[int, int]]:
    """规范化 skipRows 为 [(a, b), ...] 1-based 闭区间列表,剔除非法段。"""
    if not skip_rows:
        return []
    out: list[tuple[int, int]] = []
    for seg in skip_rows:
        if not isinstance(seg, list) or len(seg) != 2:
            continue
        a, b = seg[0], seg[1]
        if isinstance(a, bool) or isinstance(b, bool):
            continue
        if not isinstance(a, int) or not isinstance(b, int):
            continue
        if a <= 0 or b <= 0:
            continue
        if a > b:
            a, b = b, a
        out.append((a, b))
    return out


def _compute_skip_set(skip_rows: list[tuple[int, int]], header_row: int | None) -> set[int]:
    """计算所有被剔除的 1-based 行号集合(headerRow 行 + skipRows 段,重叠只算一次)。"""
    skipped: set[int] = set()
    for a, b in skip_rows:
        skipped.update(range(a, b + 1))
    if header_row is not None and header_row > 0:
        skipped.add(header_row)
    return skipped


def open_table(
    path: str,
    headerRow: int | None = None,
    skipRows: list[list[int]] | None = None,
) -> tuple[str, list[dict[str, str]], int, Path]:
    """打开本地表格文件,返回 (tableId, columns, rowCount, cache_path)。

    headerRow: 1-based,指定哪一行作为列名 schema;null=自动(首行当表头,即 parquet 原首行值作列名)。
    skipRows: [[a,b],...] 1-based 闭区间段,这些行从数据中剔除(不计入 rowCount,不返回)。

    tableId = sha1(path|mtime|size),不含 header/skip(同内容不同配置共享 parquet 缓存)。
    parquet 缓存仍是「全量原始行」(不做行剔除);剔除/表头逻辑在 read_rows 与 open 响应里按配置应用。

    columns: 若 headerRow 指定,读 parquet 第 headerRow-1 行(0-based)作为列名;
             否则用 parquet 原首行值作列名(headerRow=null 即首行当表头)。
             dtype 用 polars 推断(整列推断,不受 headerRow 影响)。
    rowCount: 剔除 headerRow 行与 skipRows 段(重叠只算一次)后的数据行数。
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"表格文件不存在: {path}")

    skip_norm = _normalize_skip_rows(skipRows)
    mtime, size, table_id = _file_signature(path)
    parquet_path, meta_path = _cache_paths(table_id)

    meta = _load_meta(meta_path)
    cache_hit = (
        meta is not None
        and meta.get("mtime") == mtime
        and meta.get("size") == size
        and meta.get("version") == CACHE_VERSION
        and parquet_path.exists()
    )

    if not cache_hit:
        ext = os.path.splitext(path)[1].lower()
        if ext in _XLSX_EXT:
            # has_header=False: parquet 保存全量原始行(含表头行),与 .tab 语义统一。
            # polars 1.43 read_excel 支持 has_header(不支持 header_row),列名为 column_1/2/...
            df = pl.read_excel(path, engine="calamine", has_header=False)
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
    raw_columns = [{"name": name, "dtype": str(dtype)} for name, dtype in schema.items()]
    # parquet 原始行数(全量,不含表头剔除)
    raw_row_count = lazy.select(pl.len()).collect().item()

    # 决定 columns 与 rowCount
    effective_header = headerRow if (headerRow is not None and headerRow > 0) else None
    # 若 headerRow=null,默认首行当表头 → 列名取 parquet 首行值(与原行为一致:把首行值作列名)
    # 但 polars 读取时首行已被当数据,这里要把它转成列名。
    columns = _resolve_columns(parquet_path, raw_columns, effective_header, raw_row_count)

    # rowCount:剔除 headerRow 行 + skipRows 段(重叠只算一次)
    skipped = _compute_skip_set(skip_norm, effective_header)
    # 注意:headerRow=null 时首行当表头,相当于「首行被剔除出数据」
    if effective_header is None:
        # 首行(行号1)当表头,从数据中剔除
        skipped.add(1)
    # 仅剔除落在 [1, raw_row_count] 的行号
    valid_skipped = {r for r in skipped if 1 <= r <= raw_row_count}
    row_count = raw_row_count - len(valid_skipped)

    return table_id, columns, row_count, parquet_path


def _resolve_columns(
    parquet_path: Path,
    raw_columns: list[dict[str, str]],
    header_row: int | None,
    raw_row_count: int,
) -> list[dict[str, str]]:
    """根据 headerRow 决定列名。

    - headerRow=None:首行当表头,取 parquet 首行各列值作为列名;
                    若首行为空(空表),回退用 parquet 原列名。
    - headerRow=N(1-based):取 parquet 第 N-1 行(0-based)各列值作为列名。
    - dtype:始终用 parquet schema 推断的 dtype(整列推断,不受 headerRow 影响)。
    """
    dtypes = [c["dtype"] for c in raw_columns]
    n_cols = len(raw_columns)

    if n_cols == 0:
        return raw_columns

    target_row_idx: int | None  # 0-based parquet 行号
    if header_row is None:
        target_row_idx = 0  # 首行
    else:
        # headerRow 1-based,转 0-based;越界回退用原列名
        target_row_idx = header_row - 1
        if target_row_idx < 0 or target_row_idx >= raw_row_count:
            return raw_columns

    # 读该行各列值作为列名;空值(None)回退用原列名
    try:
        df = pl.scan_parquet(parquet_path).slice(target_row_idx, 1).collect()
    except Exception:
        return raw_columns
    if df.height == 0:
        return raw_columns
    row_vals = df.row(0)
    names: list[str] = []
    for i, v in enumerate(row_vals):
        if v is None:
            names.append(raw_columns[i]["name"])
        else:
            names.append(str(v))
    # 列数不匹配时回退
    if len(names) != n_cols:
        return raw_columns
    return [{"name": names[i], "dtype": dtypes[i]} for i in range(n_cols)]


def _config_col_to_schema_col(
    parquet_path: Path,
    config_col_name: str,
    header_row: int | None,
) -> str | None:
    """把配置后的列名映射回 parquet schema 列名(按列顺序对应)。

    polars has_header=False 时 schema 列名为 column_1/column_2/...,配置后列名为首行/headerRow 值。
    找到 config_col_name 在 _resolve_columns 结果中的索引,返回同索引的 schema 列名。
    找不到返回 None。
    """
    lazy = pl.scan_parquet(parquet_path)
    schema = lazy.collect_schema()
    schema_names = [name for name in schema.names()]
    raw_columns = [{"name": name, "dtype": str(dtype)} for name, dtype in schema.items()]
    raw_row_count = lazy.select(pl.len()).collect().item()
    configured = _resolve_columns(parquet_path, raw_columns, header_row, raw_row_count)
    for i, c in enumerate(configured):
        if c["name"] == config_col_name:
            return schema_names[i] if i < len(schema_names) else None
    # 兜底:直接当 schema 列名查
    if config_col_name in schema_names:
        return config_col_name
    return None


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


def _sort_index_path(
    table_id: str,
    sort_col: str,
    sort_asc: bool,
    config_hash: str = "",
    filter_hash: str = "",
) -> Path:
    """排序索引缓存路径:<tableId>.sortidx_<col>_<asc|desc>[_<configHash>][_f<filterHash>].json。

    configHash: headerRow/skipRows 的 hash,因有效行集合变了排序结果不同。
    filterHash: 列筛选的 hash,筛选后有效行集合不同,排序结果也不同,必须入 key 防缓存污染。
    """
    direction = "asc" if sort_asc else "desc"
    # 列名可能含特殊字符,用 hash 规避文件名问题
    col_hash = hashlib.sha1(sort_col.encode("utf-8")).hexdigest()[:16]
    suffix = ""
    if config_hash:
        suffix += f"_{config_hash}"
    if filter_hash:
        suffix += f"_f{filter_hash}"
    return CACHE_DIR / f"{table_id}.sortidx_{col_hash}_{direction}{suffix}.json"


def _config_hash(header_row: int | None, skip_rows: list[tuple[int, int]]) -> str:
    """headerRow/skipRows 的短 hash,用于排序索引缓存 key。"""
    key = f"{header_row}|{sorted(skip_rows)}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]


def _filter_hash(filters: dict[str, list[str]] | None) -> str:
    """列筛选的短 hash,用于排序索引缓存 key。

    按 col 名排序后序列化「col: 排序后的值列表」,保证不同顺序的同值筛选 hash 一致。
    """
    if not filters:
        return ""
    items = sorted((c, sorted(vs or [])) for c, vs in filters.items())
    key = json.dumps(items, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]


def _normalize_filters(
    parquet_path: Path,
    filters: dict[str, list[str]] | None,
    header_row: int | None,
) -> dict[str, list[str]]:
    """把「配置列名 → 值列表」筛选规范化为「parquet schema 列名 → 值列表」。

    - 映射列名:配置列名 → schema 列名(column_N),映射失败的列丢弃。
    - 去掉空值列表与空筛选的列。
    返回规范化后的 dict(可能为空)。
    """
    if not filters:
        return {}
    out: dict[str, list[str]] = {}
    for col, values in filters.items():
        if not isinstance(values, list) or not values:
            continue
        schema_col = _config_col_to_schema_col(parquet_path, col, header_row)
        if schema_col is None:
            continue
        # 去空、保序去重
        clean = [str(v) for v in values if v is not None and v != ""]
        if clean:
            out[schema_col] = clean
    return out


def _apply_filters_effective(
    parquet_path: Path,
    effective: list[int],
    filters_schema: dict[str, list[str]],
) -> list[int]:
    """对有效行集合应用列筛选(多列 AND),返回筛选后的有效原始行号(0-based)子集。

    用 lazy scan + with_row_index + is_in(effective) + 各列 cast(Utf8).is_in(values) 的 AND 链,
    一次 collect 取满足全部筛选的行号,保持原升序。无筛选时原样返回。
    """
    if not filters_schema or not effective:
        return list(effective)
    lazy = pl.scan_parquet(parquet_path)
    effective_set = list(effective)
    expr = pl.col("row_index").is_in(effective_set)
    for schema_col, values in filters_schema.items():
        # 统一字符串比较:列值 cast 字符串,值已是字符串
        expr = expr & pl.col(schema_col).cast(pl.String, strict=False).fill_null("").is_in(values)
    with_idx = lazy.with_row_index("row_index")
    df = with_idx.filter(expr).select("row_index").collect()
    return df["row_index"].to_list()


def _effective_rows(
    raw_row_count: int,
    header_row: int | None,
    skip_rows: list[tuple[int, int]],
) -> list[int]:
    """计算「有效原始行号列表」(0-based parquet 行号,已按升序)。

    有效行 = 原始行去掉 headerRow 行 + skipRows 段(1-based,与 headerRow 重叠只算一次)。
    headerRow=null 时首行(行号1)当表头,剔除。
    返回的行号是 0-based parquet 行号(供 slice/filter row_index 使用)。
    """
    skipped_1based: set[int] = set()
    for a, b in skip_rows:
        skipped_1based.update(range(a, b + 1))
    if header_row is None:
        skipped_1based.add(1)  # 首行当表头
    elif header_row > 0:
        skipped_1based.add(header_row)
    # 仅剔除落在 [1, raw_row_count] 的行号
    out: list[int] = []
    for r in range(1, raw_row_count + 1):
        if r in skipped_1based:
            continue
        out.append(r - 1)  # 转 0-based
    return out


def _get_sort_index(
    parquet_path: Path,
    sort_col: str,
    sort_asc: bool,
    effective_rows: list[int],
    config_hash: str = "",
    filter_hash: str = "",
) -> list[int] | None:
    """取排序索引(有效行内的排序后位置 → 有效原始行号 0-based)。

    effective_rows 已是「应用 headerRow/skipRows + 列筛选后」的有效行集合。
    命中缓存(路径含 config_hash + filter_hash)则直接返回,否则对该集合按 sort_col 排序存序。
    返回 None 表示该列不存在或无法排序。
    """
    table_id = parquet_path.stem
    idx_path = _sort_index_path(table_id, sort_col, sort_asc, config_hash, filter_hash)
    if idx_path.exists():
        try:
            with open(idx_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    # 计算:scan parquet 取该列 + row_index,过滤到有效行,排序得「排序后 → 有效原始行号(0-based)」
    lazy = pl.scan_parquet(parquet_path)
    schema = lazy.collect_schema()
    if sort_col not in schema:
        return None
    effective_set = set(effective_rows)
    with_idx = (
        lazy.with_row_index("row_index")
        .filter(pl.col("row_index").is_in(list(effective_set)))
        .sort(sort_col, descending=not sort_asc)
    )
    order = with_idx.select("row_index").collect()["row_index"].to_list()
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(order, f)
    return order


def read_rows(
    table_id: str,
    start_row: int,
    end_row: int,
    sort_col: str | None = None,
    sort_asc: bool = True,
    headerRow: int | None = None,
    skipRows: list[list[int]] | None = None,
    filters: dict[str, list[str]] | None = None,
) -> tuple[list[list[Any]], int]:
    """对缓存 Parquet 取二维行数组,可选按列排序,并应用 headerRow/skipRows 剔除与列筛选。

    有效数据行 = 原始行去掉 headerRow 行 + skipRows 段(1-based 闭区间,与 headerRow 重叠只算一次),
    再应用列筛选(多列 AND,值=该列选中值集合的成员)。headerRow=null 时首行(行号1)当表头剔除。
    startRow/endRow 是「筛选+剔除后有效行序号」(0-based)的区间 [startRow, endRow)。

    排序策略:用列级排序索引缓存(key 含 headerRow/skipRows hash + 列筛选 hash),
    首次排序时对「筛选后有效行集合」按列排序存「排序后位置 → 有效原始行号(0-based)」并落盘,
    后续直接按索引取行。筛选 hash 必须入 key,否则筛选后命中未筛选的旧索引→行序错乱。

    filters: {配置列名: [值,...]},值统一按字符串比较(列值 cast Utf8)。
    返回 (rows, rowCount):rows 为二维数组,顺序与 columns 一致,空值 None;rowCount 为筛选+剔除后行数。
    """
    parquet_path, _ = _cache_paths(table_id)
    if not parquet_path.exists():
        raise FileNotFoundError(f"缓存不存在,请先 /api/table/open: tableId={table_id}")

    skip_norm = _normalize_skip_rows(skipRows)
    effective_header = headerRow if (headerRow is not None and headerRow > 0) else None
    config_h = _config_hash(effective_header, skip_norm)
    # 列筛选规范化为 schema 列名 → 值列表;空筛选 → 无筛选
    filters_schema = _normalize_filters(parquet_path, filters, effective_header)
    filter_h = _filter_hash(filters_schema)

    lazy = pl.scan_parquet(parquet_path)
    raw_row_count = lazy.select(pl.len()).collect().item()
    effective = _effective_rows(raw_row_count, effective_header, skip_norm)
    # 应用列筛选,缩小有效行集合(多列 AND)
    if filters_schema:
        effective = _apply_filters_effective(parquet_path, effective, filters_schema)
    row_count = len(effective)

    length = max(0, end_row - start_row)
    if length == 0:
        return [], row_count
    if start_row < 0 or start_row >= row_count:
        return [], row_count

    if sort_col:
        # 把配置后的列名映射回 parquet schema 列名(polars has_header=False 时 schema 列名为 column_N)
        schema_sort_col = _config_col_to_schema_col(parquet_path, sort_col, effective_header)
        if schema_sort_col is not None:
            sort_order = _get_sort_index(
                parquet_path, schema_sort_col, sort_asc, effective, config_h, filter_h
            )
        else:
            sort_order = None
        if sort_order is not None:
            # sort_order: 排序后位置 → 有效原始行号(0-based)
            wanted_orig = sort_order[start_row : start_row + length]
            # 按 wanted_orig 顺序从 parquet 取行
            wanted_set = list(dict.fromkeys(wanted_orig))  # 去重保序
            with_idx = lazy.with_row_index("row_index")
            df = with_idx.filter(pl.col("row_index").is_in(wanted_set)).collect()
            row_to_pos = {r: i for i, r in enumerate(df["row_index"].to_list())}
            rows_raw = df.drop("row_index").rows()
            ordered_rows: list[tuple] = [None] * len(wanted_orig)  # type: ignore[list-item]
            for pos, orig_row_idx in enumerate(wanted_orig):
                ordered_rows[pos] = rows_raw[row_to_pos[orig_row_idx]]
            return [[_to_jsonable(v) for v in row] for row in ordered_rows], row_count

    # 无排序:有效行序号映射到原始行号取数
    wanted_orig = effective[start_row : start_row + length]
    if not wanted_orig:
        return [], row_count
    wanted_set = list(dict.fromkeys(wanted_orig))
    with_idx = lazy.with_row_index("row_index")
    df = with_idx.filter(pl.col("row_index").is_in(wanted_set)).collect()
    row_to_pos = {r: i for i, r in enumerate(df["row_index"].to_list())}
    rows_raw = df.drop("row_index").rows()
    ordered_rows = [rows_raw[row_to_pos[orig]] for orig in wanted_orig]
    return [[_to_jsonable(v) for v in row] for row in ordered_rows], row_count


# ───────────────────────── column_unique(列去重+计数) ─────────────────────────

# 单列去重值上限:超过则截断(防基数过大列把前端下拉撑爆)
COLUMN_UNIQUE_LIMIT = 5000


def column_unique(
    table_id: str,
    column: str,
    headerRow: int | None = None,
    skipRows: list[list[int]] | None = None,
    filters: dict[str, list[str]] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """取某列的去重值 + 每个值的重复数目(按数目降序)。

    范围:在「应用 headerRow/skipRows 剔除 + filters(其他列)筛选」后的可见行集合上分组计数。
    filters 应由调用方排除「本列」——本列已选值不传入,使计数反映按其他列筛选后该值出现次数
    (本列已选值也能看到它的总数)。列值统一 cast Utf8 字符串化。

    返回 (values, truncated):
    - values: [{value: str, count: int}],按 count 降序;count = 该值在筛选后可见行里的出现次数。
    - truncated: True 表示去重值超过 COLUMN_UNIQUE_LIMIT 被截断,前端应提示。
    """
    parquet_path, _ = _cache_paths(table_id)
    if not parquet_path.exists():
        raise FileNotFoundError(f"缓存不存在,请先 /api/table/open: tableId={table_id}")

    skip_norm = _normalize_skip_rows(skipRows)
    effective_header = headerRow if (headerRow is not None and headerRow > 0) else None
    filters_schema = _normalize_filters(parquet_path, filters, effective_header)

    schema_col = _config_col_to_schema_col(parquet_path, column, effective_header)
    if schema_col is None:
        return [], False

    lazy = pl.scan_parquet(parquet_path)
    raw_row_count = lazy.select(pl.len()).collect().item()
    effective = _effective_rows(raw_row_count, effective_header, skip_norm)
    if filters_schema:
        effective = _apply_filters_effective(parquet_path, effective, filters_schema)
    if not effective:
        return [], False

    # 在筛选后有效行集合上,对该列 cast 字符串后分组计数(降序)
    expr = pl.col("row_index").is_in(list(effective))
    col_str = pl.col(schema_col).cast(pl.String, strict=False).fill_null("")
    grouped = (
        lazy.with_row_index("row_index")
        .filter(expr)
        .group_by(col_str.alias("__v"))
        .agg(pl.len().alias("__c"))
        .sort("__c", descending=True)
        .collect()
    )
    values_raw = grouped["__v"].to_list()
    counts_raw = grouped["__c"].to_list()
    truncated = len(values_raw) > COLUMN_UNIQUE_LIMIT
    out: list[dict[str, Any]] = []
    for v, c in zip(values_raw[:COLUMN_UNIQUE_LIMIT], counts_raw[:COLUMN_UNIQUE_LIMIT]):
        out.append({"value": "" if v is None else str(v), "count": int(c)})
    return out, truncated


# ───────────────────────── search_table ─────────────────────────

def search_table(
    table_id: str,
    query: str,
    skipRows: list[list[int]] | None = None,
    headerRow: int | None = None,
    limit: int = 1000,
) -> tuple[list[dict[str, Any]], int]:
    """全表查找:扫缓存 Parquet 所有列转字符串,子串匹配(大小写不敏感)。

    应用 skipRows(剔除)+ headerRow(剔除表头行)后,匹配行的「有效行序号」(0-based)
    + colIndex(在有效 columns 中的序号)+ colName + value。

    limit 截断返回条数(防百万行全匹配爆掉);total=真实匹配数。
    返回 (matches, total)。
    matches: [{ rowIndex, colIndex, colName, value }]
    """
    parquet_path, _ = _cache_paths(table_id)
    if not parquet_path.exists():
        raise FileNotFoundError(f"缓存不存在,请先 /api/table/open: tableId={table_id}")
    if not query:
        return [], 0

    skip_norm = _normalize_skip_rows(skipRows)
    effective_header = headerRow if (headerRow is not None and headerRow > 0) else None

    lazy = pl.scan_parquet(parquet_path)
    schema = lazy.collect_schema()
    raw_row_count = lazy.select(pl.len()).collect().item()
    effective = _effective_rows(raw_row_count, effective_header, skip_norm)
    # 有效原始行号(0-based)→ 有效行序号(0-based)
    orig_to_effective = {orig: i for i, orig in enumerate(effective)}

    # 解析有效列名(与 open 返回一致)
    raw_columns = [{"name": name, "dtype": str(dtype)} for name, dtype in schema.items()]
    columns = _resolve_columns(parquet_path, raw_columns, effective_header, raw_row_count)
    col_names = [c["name"] for c in columns]
    schema_names = list(schema.names())

    # 全表扫描:把所有列 cast 为字符串,做子串匹配(大小写不敏感)
    q_lower = query.lower()
    with_idx = lazy.with_row_index("row_index")
    # 每列 cast Utf8 并 lower,用 str.contains 子串匹配
    exprs = []
    for name in schema_names:
        col_expr = pl.col(name).cast(pl.String, strict=False)
        col_expr = col_expr.fill_null("")
        col_expr = col_expr.str.to_lowercase()
        exprs.append(col_expr.str.contains(q_lower, literal=True).alias(f"__hit_{name}"))
    df = with_idx.select(["row_index", *schema_names, *exprs]).collect()

    matches: list[dict[str, Any]] = []
    total = 0
    row_indices = df["row_index"].to_list()
    n_cols = len(schema_names)
    # 预取每列的 hit 标志 list
    hit_lists = {name: df[f"__hit_{name}"].to_list() for name in schema_names}
    value_lists = {name: df[name].to_list() for name in schema_names}

    for pos, orig_row_idx in enumerate(row_indices):
        eff_idx = orig_to_effective.get(orig_row_idx)
        if eff_idx is None:
            continue  # 该行被剔除(header/skip),跳过
        for ci, name in enumerate(schema_names):
            if hit_lists[name][pos]:
                total += 1
                if len(matches) < limit:
                    v = value_lists[name][pos]
                    matches.append({
                        "rowIndex": eff_idx,
                        "colIndex": ci,  # 在有效 columns 中的序号(与 schema 顺序一致)
                        "colName": col_names[ci] if ci < len(col_names) else name,
                        "value": _to_jsonable(v) if v is not None else "",
                    })

    return matches, total
