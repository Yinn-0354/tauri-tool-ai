"""Excel 读取器 — 使用 openpyxl"""

from pathlib import Path
from openpyxl import load_workbook


def read_excel(path: str, sheet: str | None = None) -> dict:
    """读取 Excel 文件，返回 { sheet_name: { columns: [...], rows: [[], ...] } }"""
    wb = load_workbook(path, read_only=True, data_only=True)
    result = {}

    sheets = [sheet] if sheet else wb.sheetnames
    for name in sheets:
        ws = wb[name]
        rows_iter = ws.iter_rows(values_only=True)
        columns = [str(c) if c else f"Col{i}" for i, c in enumerate(next(rows_iter, []), 1)]
        rows = [[v for v in row] for row in rows_iter]
        result[name] = {"columns": columns, "rows": rows}

    wb.close()
    return result


def read_excel_preview(path: str, sheet: str | None = None) -> dict:
    """读取 Excel 并汇总成一个表格（单 sheet 模式）"""
    data = read_excel(path, sheet)
    first_sheet = list(data.values())[0] if data else {"columns": [], "rows": []}
    return first_sheet
