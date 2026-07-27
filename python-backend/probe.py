"""配置表检查工具 · 表格数据层计时探针

独立运行(python probe.py),不依赖 Tauri:
1. 生成合成大表:~1M 行 .tab(\t 分隔,~10 列)写到 tempfile;再写对应 .xlsx。
2. 对 .tab 与 .xlsx 各测:首次解析耗时、write_parquet 耗时、二次(scan_parquet mmap)读耗时、
   再 open_table 一次(命中缓存)耗时。
3. 用 FastAPI TestClient 对 /api/table/open 与 /api/table/data 做端点冒烟。
4. 打印清晰计时表格,判定是否达成「首次 <10s,缓存后 <1s」。

合成表路径用 tempfile,probe 结束清理。
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import polars as pl

# 让 probe 直接 import 同目录 table_io / main
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import table_io  # noqa: E402
from main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# ───────────────────────── 合成大表 ─────────────────────────

ROW_COUNT = 1_000_000  # ~1M 行
COLS = 10


def _build_dataframe(n: int, cols: int) -> pl.DataFrame:
    """构造 n 行 cols 列合成数据:混合 Int/Float/String,有少量空值。"""
    data: dict[str, pl.Series] = {}
    for i in range(cols):
        if i == 0:
            data["id"] = pl.Series(range(n), dtype=pl.Int64)
        elif i % 3 == 1:
            # 浮点列
            data[f"val_{i}"] = pl.Series([round((r * 0.001) % 1000, 3) for r in range(n)], dtype=pl.Float64)
        elif i % 3 == 2:
            # 字符串列,带中文 + 偶尔空值
            vals = [f"行{r}-c{i}" if r % 7 != 0 else None for r in range(n)]
            data[f"str_{i}"] = pl.Series(vals, dtype=pl.String)
        else:
            data[f"int_{i}"] = pl.Series([(r * 13 + i) % 100000 for r in range(n)], dtype=pl.Int64)
    return pl.DataFrame(data)


def make_synthetic_files(work_dir: Path) -> tuple[Path, Path]:
    """在 work_dir 生成 .tab 与 .xlsx,返回两路径。"""
    df = _build_dataframe(ROW_COUNT, COLS)

    tab_path = work_dir / "synthetic_big.tab"
    t0 = time.perf_counter()
    # 直接 polars write_csv(\t 分隔,utf8)
    df.write_csv(str(tab_path), separator="\t")
    t_tab_write = time.perf_counter() - t0
    tab_size = tab_path.stat().st_size
    print(f"  生成 .tab: {tab_size / 1024 / 1024:.1f} MB,写盘 {t_tab_write:.2f}s")

    xlsx_path = work_dir / "synthetic_big.xlsx"
    t0 = time.perf_counter()
    # write_excel 用 xlsxwriter;1M 行 xlsx 较慢,但只测一次
    df.write_excel(str(xlsx_path))
    t_xlsx_write = time.perf_counter() - t0
    xlsx_size = xlsx_path.stat().st_size
    print(f"  生成 .xlsx: {xlsx_size / 1024 / 1024:.1f} MB,写盘 {t_xlsx_write:.2f}s")

    return tab_path, xlsx_path


# ───────────────────────── 单文件计时 ─────────────────────────

def _timed(label: str, fn):
    t0 = time.perf_counter()
    res = fn()
    return res, time.perf_counter() - t0


def bench_file(path: Path) -> dict[str, float]:
    """对一个文件测四个阶段,返回计时 dict(秒)。"""
    result: dict[str, float] = {}

    # 清掉旧缓存,确保首次解析
    mtime, size, table_id = table_io._file_signature(str(path))
    pq, meta = table_io._cache_paths(table_id)
    if pq.exists():
        pq.unlink()
    if meta.exists():
        meta.unlink()

    ext = path.suffix.lower()

    # 1a) 仅解析(不落盘),计时
    def _parse() -> pl.DataFrame:
        if ext in table_io._XLSX_EXT:
            return pl.read_excel(str(path), engine="calamine")
        return table_io._read_tab(str(path))

    df, t_parse = _timed("parse", _parse)
    result["parse_only"] = t_parse

    # 1b) write_parquet 计时(写到临时文件,不污染正式缓存)
    tmp_pq = pq.with_suffix(".probe.tmp.parquet")
    t0 = time.perf_counter()
    df.write_parquet(str(tmp_pq))
    result["write_parquet"] = time.perf_counter() - t0
    if tmp_pq.exists():
        tmp_pq.unlink()

    # 1c) open_table 首次(解析 + 落盘 + meta)
    (_, columns, row_count, _), t_first = _timed("first open", lambda: table_io.open_table(str(path)))
    result["first_open_total"] = t_first

    # 2) 二次:scan_parquet mmap 读首块(模拟前端拉首屏)
    t0 = time.perf_counter()
    rows, rc = table_io.read_rows(table_id, 0, 100)
    result["scan_first100"] = time.perf_counter() - t0
    assert rc == row_count, f"行数不一致 {rc} vs {row_count}"
    assert len(rows) == 100

    # 3) 再 open_table 一次(命中缓存,应 <1s)
    (_, _, rc2, _), t_cache_hit = _timed("cache hit open", lambda: table_io.open_table(str(path)))
    result["cache_hit_open"] = t_cache_hit
    assert rc2 == row_count

    result["row_count"] = row_count
    result["col_count"] = len(columns)
    return result


# ───────────────────────── 端点冒烟 ─────────────────────────

def endpoint_smoke(tab_path: Path) -> dict[str, str]:
    """用 TestClient 跑 /api/table/open + /api/table/data 冒烟。"""
    c = TestClient(app)
    out: dict[str, str] = {}

    r = c.post("/api/table/open", json={"path": str(tab_path)})
    out["open_status"] = str(r.status_code)
    body = r.json()
    out["open_tableId"] = str(body.get("tableId", ""))[:12]
    out["open_rowCount"] = str(body.get("rowCount", ""))
    out["open_col_count"] = str(len(body.get("columns", [])))

    tid = body["tableId"]
    r2 = c.post("/api/table/data", json={"tableId": tid, "startRow": 0, "endRow": 5})
    out["data_status"] = str(r2.status_code)
    b2 = r2.json()
    out["data_rowCount"] = str(b2.get("rowCount", ""))
    out["data_rows_len"] = str(len(b2.get("rows", [])))

    # 带排序的 data
    r3 = c.post("/api/table/data", json={"tableId": tid, "startRow": 0, "endRow": 3, "sortCol": "id", "sortAsc": True})
    out["data_sorted_status"] = str(r3.status_code)
    b3 = r3.json()
    out["data_sorted_rows_len"] = str(len(b3.get("rows", [])))
    return out


# ───────────────────────── 主流程 ─────────────────────────

def _print_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    sep = " | "
    line = sep.join(h.ljust(w) for h, w in zip(headers, widths))
    print("  " + line)
    print("  " + "-+-".join("-" * w for w in widths))
    for r in rows:
        print("  " + sep.join(c.ljust(w) for c, w in zip(r, widths)))


def main() -> int:
    work_dir = Path(tempfile.mkdtemp(prefix="probe_tables_"))
    print(f"[probe] 工作目录: {work_dir}")
    print(f"[probe] polars {pl.__version__}")
    try:
        print("\n[1] 生成合成大表...")
        tab_path, xlsx_path = make_synthetic_files(work_dir)

        print("\n[2] 计时:.tab")
        tab_res = bench_file(tab_path)
        print("\n[3] 计时:.xlsx")
        xlsx_res = bench_file(xlsx_path)

        print("\n========== 计时结果 ==========")
        headers = ["阶段", ".tab (s)", ".xlsx (s)", "目标"]
        rows = [
            ["首次 open_table(解析+落盘)", f"{tab_res['first_open_total']:.3f}", f"{xlsx_res['first_open_total']:.3f}", "<10s"],
            ["  ├─ 仅解析", f"{tab_res['parse_only']:.3f}", f"{xlsx_res['parse_only']:.3f}", "-"],
            ["  └─ write_parquet", f"{tab_res['write_parquet']:.3f}", f"{xlsx_res['write_parquet']:.3f}", "-"],
            ["二次 scan 首100行(mmap)", f"{tab_res['scan_first100']:.3f}", f"{xlsx_res['scan_first100']:.3f}", "<1s"],
            ["缓存命中再 open", f"{tab_res['cache_hit_open']:.3f}", f"{xlsx_res['cache_hit_open']:.3f}", "<1s"],
            ["行数", f"{tab_res['row_count']}", f"{xlsx_res['row_count']}", ""],
            ["列数", f"{tab_res['col_count']}", f"{xlsx_res['col_count']}", ""],
        ]
        _print_table(headers, rows)

        # 达标判定
        tab_ok = tab_res["first_open_total"] < 10 and tab_res["scan_first100"] < 1 and tab_res["cache_hit_open"] < 1
        xlsx_ok = xlsx_res["first_open_total"] < 10 and xlsx_res["scan_first100"] < 1 and xlsx_res["cache_hit_open"] < 1
        print()
        print(f"[判定] .tab  首次<10s & 缓存后<1s: {'PASS' if tab_ok else 'FAIL'}")
        print(f"[判定] .xlsx 首次<10s & 缓存后<1s: {'PASS' if xlsx_ok else 'FAIL'}")

        print("\n[4] 端点冒烟(TestClient,.tab)")
        smoke = endpoint_smoke(tab_path)
        for k, v in smoke.items():
            print(f"  {k}: {v}")
        smoke_ok = (
            smoke["open_status"] == "200"
            and smoke["data_status"] == "200"
            and smoke["data_sorted_status"] == "200"
            and int(smoke["data_rows_len"]) == 5
            and int(smoke["data_sorted_rows_len"]) == 3
        )
        print(f"[判定] 端点冒烟: {'PASS' if smoke_ok else 'FAIL'}")

        print()
        all_ok = tab_ok and xlsx_ok and smoke_ok
        print(f"[总判定] {'ALL PASS' if all_ok else 'SOME FAIL'}")
        return 0 if all_ok else 1
    finally:
        print(f"\n[probe] 清理工作目录: {work_dir}")
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
