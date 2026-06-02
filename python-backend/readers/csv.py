"""CSV / TSV 读取器 — 使用 pandas"""

import pandas as pd

ENCODINGS = ["utf-8", "gbk", "gb2312", "utf-16"]


def _detect_encoding(path: str) -> str:
    """自动检测文件编码"""
    raw = open(path, "rb").read()
    for enc in ENCODINGS:
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "utf-8"


def _read_delimited_df(
    path: str,
    delimiter: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> pd.DataFrame:
    """读取分隔符文本文件，返回 DataFrame

    header_row: 表头行号（1-indexed）
    skip_rows: 需要跳过的行号列表（1-indexed）
    """
    header_idx = header_row - 1

    pandas_skip: list[int] = []
    if skip_rows:
        pandas_skip = [r - 1 for r in skip_rows]
        if header_idx in pandas_skip:
            pandas_skip.remove(header_idx)

    encoding = _detect_encoding(path)

    df = pd.read_csv(
        path,
        delimiter=delimiter,
        header=header_idx,
        skiprows=pandas_skip or None,
        encoding=encoding,
        dtype=str,
        na_filter=False,
        engine="python",
    )

    df.columns = [str(c) if c else f"Col{i}" for i, c in enumerate(df.columns, 1)]

    return df


def read_csv_df(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> pd.DataFrame:
    """读取 CSV 文件（逗号分隔）"""
    return _read_delimited_df(path, ",", header_row, skip_rows)


def read_tab_df(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> pd.DataFrame:
    """读取 TAB / TSV 文件（Tab 分隔）"""
    return _read_delimited_df(path, "\t", header_row, skip_rows)
