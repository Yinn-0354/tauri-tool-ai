"""CSV / TSV 读取器"""

import csv
from pathlib import Path

ENCODINGS = ["utf-8", "gbk", "gb2312", "utf-16"]


def _read_delimited(path: str, delimiter: str) -> dict:
    """读取分隔符文本文件，自动尝试多种编码"""
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
    columns = [str(c) if c else f"Col{i}" for i, c in enumerate(next(reader, []), 1)]
    rows = [row for row in reader]
    return {"columns": columns, "rows": rows}


def read_csv(path: str) -> dict:
    """读取 CSV 文件（逗号分隔）"""
    return _read_delimited(path, ",")


def read_tab(path: str) -> dict:
    """读取 TAB / TSV 文件（Tab 分隔）"""
    return _read_delimited(path, "\t")
