"""Excel 读取器 — 使用 pandas + openpyxl"""

import pandas as pd


def read_excel_df(
    path: str,
    sheet: str | None = None,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> pd.DataFrame:
    """读取 Excel 文件，返回 DataFrame

    header_row: 表头行号（1-indexed）
    skip_rows: 需要跳过的行号列表（1-indexed）
    """
    # pandas 的 header 是 0-indexed
    header_idx = header_row - 1

    # skiprows: pandas 接受 0-indexed 行号列表
    pandas_skip: list[int] = []
    if skip_rows:
        pandas_skip = [r - 1 for r in skip_rows]
        # 确保不跳过表头行
        if header_idx in pandas_skip:
            pandas_skip.remove(header_idx)

    df = pd.read_excel(
        path,
        sheet_name=sheet or 0,
        header=header_idx,
        skiprows=pandas_skip or None,
        engine="openpyxl",
        dtype=str,       # 全部读为字符串，避免类型推断问题
        na_filter=False,  # 空值读为空字符串而非 NaN
    )

    # 列名去空，统一为字符串
    df.columns = [str(c) if c else f"Col{i}" for i, c in enumerate(df.columns, 1)]

    return df
