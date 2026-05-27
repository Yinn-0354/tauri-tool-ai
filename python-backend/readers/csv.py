"""CSV / TSV 读取器"""

import csv
from pathlib import Path

ENCODINGS = ["utf-8", "gbk", "gb2312", "utf-16"]


def _read_delimited(
    path: str,
    delimiter: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> dict:
    """读取分隔符文本文件，自动尝试多种编码

    header_row: 表头行号（1-indexed）
    skip_rows: 需要跳过的行号列表（1-indexed）
    """
    if skip_rows is None:
        skip_rows = []

    skip_set = {r - 1 for r in skip_rows}
    header_idx = header_row - 1

    raw = Path(path).read_bytes()
    for enc in ENCODINGS:
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        content = raw.decode("utf-8", errors="replace")

    reader = csv.reader(content.splitlines(), delimiter=delimiter)
    all_rows = [row for row in reader]

    if header_idx < len(all_rows):
        columns = [
            str(c) if c else f"Col{i}"
            for i, c in enumerate(all_rows[header_idx], 1)
        ]
    else:
        columns = []

    rows = [
        row for i, row in enumerate(all_rows)
        if i != header_idx and i not in skip_set and i > header_idx
    ]

    return {"columns": columns, "rows": rows}


def read_csv(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> dict:
    """读取 CSV 文件（逗号分隔）"""
    return _read_delimited(path, ",", header_row, skip_rows)


def read_tab(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> dict:
    """读取 TAB / TSV 文件（Tab 分隔）"""
    return _read_delimited(path, "\t", header_row, skip_rows)
