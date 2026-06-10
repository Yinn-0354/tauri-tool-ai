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
    remark_rows: list[int] | None = None,
) -> tuple[pd.DataFrame, list[dict]]:
    """读取分隔符文本文件，返回 DataFrame 和备注行数据

    header_row: 表头行号（1-indexed），该行作为列名
    skip_rows: 需要跳过的行号列表（1-indexed）
    remark_rows: 备注行号列表（1-indexed），这些行的内容会单独返回

    表头行之前的行会作为数据内容保留，不会被跳过。
    """
    header_idx = header_row - 1
    encoding = _detect_encoding(path)

    # 先读取所有行（不指定 header），header=None 表示所有行都是数据
    raw_df = pd.read_csv(
        path,
        delimiter=delimiter,
        header=None,  # 不指定表头，所有行都作为数据读取
        encoding=encoding,
        dtype=str,
        na_filter=False,
        engine="python",
    )

    # 检查表头行是否存在
    if header_idx >= len(raw_df):
        raise ValueError(f"表头行 {header_row} 超出文件行数 {len(raw_df)}")

    # 提取表头行作为列名
    header_values = raw_df.iloc[header_idx].tolist()
    # 列名去空，统一为字符串
    columns = [str(c) if c and str(c).strip() else f"Col{i}" for i, c in enumerate(header_values, 1)]

    # 提取备注行数据
    remark_data = []
    if remark_rows:
        for orig_row in remark_rows:
            orig_idx = orig_row - 1  # 转为 0-indexed
            if orig_idx >= 0 and orig_idx < len(raw_df) and orig_idx != header_idx:
                row_values = raw_df.iloc[orig_idx].tolist()
                remark_data.append({
                    "row": orig_row,
                    "values": [str(v) if v else "" for v in row_values]
                })

    # 构建数据：跳过表头行，保留其他所有行（包括表头之前的行）
    # 先移除表头行
    data_df = raw_df.drop(index=header_idx).reset_index(drop=True)

    # 应用 skip_rows（移除需要跳过的行）
    if skip_rows:
        # 转换为 0-indexed 并调整：跳过行是基于原始文件的行号
        # 需要将原始行号映射到当前 DataFrame 的索引
        rows_to_drop = []
        for orig_row in skip_rows:
            orig_idx = orig_row - 1  # 转为 0-indexed
            if orig_idx == header_idx:
                continue  # 不跳过表头行
            if orig_idx < header_idx:
                # 表头之前的行：在 data_df 中的索引就是 orig_idx
                if orig_idx < len(data_df):
                    rows_to_drop.append(orig_idx)
            else:
                # 表头之后的行：在 data_df 中的索引是 orig_idx - 1（因为表头行已移除）
                adjusted_idx = orig_idx - 1
                if 0 <= adjusted_idx < len(data_df):
                    rows_to_drop.append(adjusted_idx)

        if rows_to_drop:
            data_df = data_df.drop(index=rows_to_drop).reset_index(drop=True)

    # 设置列名
    data_df.columns = columns

    return data_df, remark_data


def read_csv_df(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
    remark_rows: list[int] | None = None,
) -> tuple[pd.DataFrame, list[dict]]:
    """读取 CSV 文件（逗号分隔）"""
    return _read_delimited_df(path, ",", header_row, skip_rows, remark_rows)


def read_tab_df(
    path: str,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
    remark_rows: list[int] | None = None,
) -> tuple[pd.DataFrame, list[dict]]:
    """读取 TAB / TSV 文件（Tab 分隔）"""
    return _read_delimited_df(path, "\t", header_row, skip_rows, remark_rows)
