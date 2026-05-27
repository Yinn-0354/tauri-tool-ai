"""Excel 读取器 — 使用 openpyxl"""

from pathlib import Path
from openpyxl import load_workbook


def read_excel(
    path: str,
    sheet: str | None = None,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> dict:
    """读取 Excel 文件，返回 { sheet_name: { columns: [...], rows: [[], ...] } }

    header_row: 表头行号（1-indexed）
    skip_rows: 需要跳过的行号列表（1-indexed）
    """
    if skip_rows is None:
        skip_rows = []

    skip_set = {r - 1 for r in skip_rows}
    header_idx = header_row - 1

    wb = load_workbook(path, read_only=True, data_only=True)
    result = {}

    sheets = [sheet] if sheet else wb.sheetnames
    for name in sheets:
        ws = wb[name]
        rows_iter = ws.iter_rows(values_only=True)

        columns: list[str] = []
        data_rows: list[list] = []

        for i, row in enumerate(rows_iter):
            if i in skip_set:
                continue
            if i == header_idx:
                columns = [
                    str(c) if c else f"Col{j}"
                    for j, c in enumerate(row, 1)
                ]
            elif columns:
                data_rows.append([v for v in row])

        result[name] = {"columns": columns, "rows": data_rows}

    wb.close()
    return result


def read_excel_preview(
    path: str,
    sheet: str | None = None,
    header_row: int = 1,
    skip_rows: list[int] | None = None,
) -> dict:
    """读取 Excel 并汇总成一个表格（单 sheet 模式）"""
    data = read_excel(path, sheet, header_row, skip_rows)
    first_sheet = list(data.values())[0] if data else {"columns": [], "rows": []}
    return first_sheet
