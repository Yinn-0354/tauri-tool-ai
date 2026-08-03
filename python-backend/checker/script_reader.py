"""配置检查器 · 检查脚本读取器(read_check_script 的纯逻辑)。

PRD §4.3-B:Claude 审核时**按需**调本地函数工具 read_check_script(scriptRelPath),
用 [全局脚本库根 + scriptRelPath] 拼完整路径读检查脚本逻辑,供 Claude 理解规则
(不需要时不调省 IO)。

本模块只做"读文件"的纯逻辑,不绑 Claude Agent SDK 的工具定义方式 —— audit.py
再用 SDK 的本地函数工具机制把本函数包成 agent 可调的工具。返回 dict 签名稳定
({content, notFound, truncated}),无论上层 SDK 怎么包装都不变。

健壮性(PRD §10 待办):
- 相对路径拼接防越界(../ 逃逸):解析后必须仍在脚本库根下。
- 编码探测:脚本可能非 utf8,用 chardet 探测,回退 utf-8-lossy。
- 大文件截断:超过上限截断 + 标记,避免喂爆 Claude 上下文。
- 文件不存在/读不到 → content="" + notFound=true,不阻断审核。
"""
from __future__ import annotations

from pathlib import Path

import chardet

from checker import config

# 单次返回的脚本内容上限(字节)。检查脚本通常几百行,超此截断 + 标记。
_MAX_SCRIPT_BYTES = 200_000


def read_check_script(script_rel_path: str) -> dict[str, object]:
    """读检查脚本内容。

    入参:
        script_rel_path:相对全局脚本库根的路径(如 "jx3/.../check_xxx.py")。

    返回 {content: str, notFound: bool, truncated: bool}:
        - 脚本库根未设置 / 相对路径非法(越界) / 文件不存在 / 读失败
          → notFound=True, content="", truncated=False。
        - 文件超过 _MAX_SCRIPT_BYTES → 截断, truncated=True,
          content 末尾附截断提示。
    """
    root = config.get_script_lib_root()
    if not root or not script_rel_path or not script_rel_path.strip():
        return {"content": "", "notFound": True, "truncated": False}

    root_path = Path(root).resolve()
    try:
        full = (root_path / script_rel_path.strip()).resolve()
    except (OSError, ValueError):
        return {"content": "", "notFound": True, "truncated": False}

    # 越界防护:解析后的完整路径必须在脚本库根下(防 ../ 逃逸)。
    try:
        full.relative_to(root_path)
    except ValueError:
        return {"content": "", "notFound": True, "truncated": False}

    if not full.is_file():
        return {"content": "", "notFound": True, "truncated": False}

    try:
        raw = full.read_bytes()
    except OSError:
        return {"content": "", "notFound": True, "truncated": False}

    truncated = False
    if len(raw) > _MAX_SCRIPT_BYTES:
        raw = raw[:_MAX_SCRIPT_BYTES]
        truncated = True

    # 编码探测:脚本可能非 utf8(chardet),回退 utf-8-lossy(errors=replace)。
    try:
        enc = chardet.detect(raw).get("encoding") or "utf-8"
        text = raw.decode(enc, errors="replace")
    except (LookupError, UnicodeDecodeError):
        text = raw.decode("utf-8", errors="replace")

    if truncated:
        text += "\n\n[... 脚本过长已截断 ...]"

    return {"content": text, "notFound": False, "truncated": truncated}
