"""配置表检查工具 · 表头行/跳过行配置持久化

文件:%LOCALAPPDATA%/tauri-tool-ai/table-config.json(Tauri 侧同目录共享)
结构:JSON object,key = 文件绝对路径(abspath),value = { "headerRow": int|null, "skipRows": [[a,b],...] }
  - headerRow: 1-based,表示「第 N 行是表头」(该行的列名作为 schema);null=自动推断(首行当表头)
  - skipRows: 段列表,每段 [startRow, endRow] 1-based 闭区间,这些行不显示在表格中(也不算入数据行)

内存加载 + 落盘,dict 结构。原子替换,utf-8。
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

# ───────────────────────── 配置文件路径 ─────────────────────────

_LOCALAPPDATA = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
CONFIG_DIR = Path(_LOCALAPPDATA) / "tauri-tool-ai"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = CONFIG_DIR / "table-config.json"


# ───────────────────────── 内存加载/落盘 ─────────────────────────

_config_cache: dict[str, dict[str, Any]] | None = None


def _load_all() -> dict[str, dict[str, Any]]:
    """全量加载 table-config.json 到内存;文件不存在或损坏返回空 dict。"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    if not CONFIG_PATH.exists():
        _config_cache = {}
        return _config_cache
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            _config_cache = data
        else:
            _config_cache = {}
    except (OSError, json.JSONDecodeError):
        _config_cache = {}
    return _config_cache


def _save_all(cfg: dict[str, dict[str, Any]]) -> None:
    """原子替换落盘;同时刷新内存缓存。"""
    global _config_cache
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)
    _config_cache = cfg


# ───────────────────────── 对外 API ─────────────────────────

def _normalize(value: dict[str, Any] | None) -> dict[str, Any]:
    """规范化单条记录,确保字段齐全且类型正确。"""
    if not isinstance(value, dict):
        return {"headerRow": None, "skipRows": []}
    header_row = value.get("headerRow")
    skip_rows = value.get("skipRows")
    # headerRow: int 或 None
    if header_row is not None and not isinstance(header_row, int):
        header_row = None
    if isinstance(header_row, bool):  # bool 是 int 子类,排除
        header_row = None
    # skipRows: [[a,b],...]
    if not isinstance(skip_rows, list):
        skip_rows = []
    norm_skip: list[list[int]] = []
    for seg in skip_rows:
        if isinstance(seg, list) and len(seg) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in seg):
            norm_skip.append([seg[0], seg[1]])
    return {"headerRow": header_row, "skipRows": norm_skip}


def load_config(path: str) -> dict[str, Any]:
    """返回该 path 的 {headerRow, skipRows}(无记录返回 {headerRow: null, skipRows: []})。"""
    abs_path = os.path.abspath(path)
    cfg = _load_all()
    return _normalize(cfg.get(abs_path))


def save_config(path: str, header_row: int | None, skip_rows: list[list[int]]) -> None:
    """写入/更新 table-config.json 中该 path 的配置(原子替换,utf-8)。"""
    abs_path = os.path.abspath(path)
    cfg = _load_all()
    cfg[abs_path] = _normalize({"headerRow": header_row, "skipRows": skip_rows})
    _save_all(cfg)
