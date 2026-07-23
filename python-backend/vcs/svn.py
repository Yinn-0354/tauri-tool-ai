"""SVN blame 封装(模块1 · 表格查看器的 blame 可开关)

设计要点(选型 plan / 设计文档 2.1):
- 命令:`svn blame --xml --non-interactive <path>`,list-form 参数(禁 shell=True,防注入)
- 异步:用 asyncio + asyncio.subprocess,避免阻塞 FastAPI 事件循环
- 缓存:按 path+revision LRU 缓存 blame 结果;同一文件重复打开不重跑
- 按需触发:前端点某行才查该行作者,打开表不自动全量 blame
- 超时:60s,大文件 blame 可能分钟级;超时取消 + 返回明确错误
- 编码:svn --xml 恒 UTF-8;stderr 用 gbk 兜底(中文 Windows 控制台)
- 只返回元信息(lineNumber/revision/author/date),行内容由调用方自行对齐工作副本
"""
from __future__ import annotations

import asyncio
import functools
import os
import re
import xml.etree.ElementTree as ET
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

# 可配置常量
SVN_BLAME_TIMEOUT = 60.0  # 秒
_SVN_BIN = os.environ.get("SVN_BIN", "svn")

# LRU 缓存:key=(abspath, revision_marker),value=blame 结果列表
# revision_marker 用 "BASE" 或具体 revision 字符串;"working" 表示工作副本
_LRU_MAX = 16
_blame_cache: "OrderedDict[tuple[str, str], list[dict[str, Any]]]" = OrderedDict()


@dataclass
class BlameLine:
    line_number: int  # 1-based
    revision: str
    author: str
    date: str


def _decode_stderr(b: bytes) -> str:
    """svn stderr 在中文 Windows 常是 gbk。utf-8 失败则 gbk 兜底。"""
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("gbk", errors="replace")


def _parse_blame_xml(xml_text: str) -> list[dict[str, Any]]:
    """解析 svn blame --xml 输出为 [{lineNumber, revision, author, date}, ...]。"""
    root = ET.fromstring(xml_text)
    out: list[dict[str, Any]] = []
    for idx, entry in enumerate(root.findall(".//entry"), start=1):
        commit = entry.find("commit")
        rev = entry.attrib.get("revision", "")
        if commit is not None:
            author_el = commit.find("author")
            date_el = commit.find("date")
            author = author_el.text if author_el is not None and author_el.text else ""
            date = date_el.text if date_el is not None and date_el.text else ""
        else:
            author, date = "", ""
        out.append(
            {
                "lineNumber": idx,
                "revision": rev,
                "author": author,
                "date": date,
            }
        )
    return out


def _is_auth_or_access_error(stderr: str) -> tuple[bool, str]:
    """识别 svn 认证/权限错误,返回 (是否, 友好提示)。"""
    if not stderr:
        return False, ""
    # E155007: 不是工作副本; E215004: 需要认证; E175013: 无访问权限
    if "E155007" in stderr:
        return True, "该路径不在 SVN 工作副本内"
    if "E215004" in stderr:
        return True, "SVN 需要认证,请在命令行先 svn 登录或缓存凭证"
    if "E175013" in stderr:
        return True, "SVN 仓库访问被拒绝(无权限)"
    return False, ""


async def svn_blame(path: str, revision: str = "BASE") -> list[dict[str, Any]]:
    """对 path 执行 svn blame,返回行级元信息列表。

    revision: "BASE"(默认,工作副本的 pristine 版本)或具体 revision 号或 "HEAD"。
    结果按 (abspath, revision) 做 LRU 缓存。
    """
    abspath = os.path.abspath(path)
    key = (abspath, revision)
    if key in _blame_cache:
        _blame_cache.move_to_end(key)
        return _blame_cache[key]

    # list-form 参数,禁 shell=True
    args = [_SVN_BIN, "blame", "--xml", "--non-interactive", "-r", revision, abspath]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise RuntimeError(f"找不到 svn 可执行文件({_SVN_BIN}),请确认 SVN 已安装且在 PATH")

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=SVN_BLAME_TIMEOUT
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise TimeoutError(f"svn blame 超时({SVN_BLAME_TIMEOUT:.0f}s),文件可能过大")

    if proc.returncode != 0:
        stderr = _decode_stderr(stderr_b)
        is_auth, hint = _is_auth_or_access_error(stderr)
        if is_auth:
            raise PermissionError(hint)
        # 去掉控制字符与多余空白,给可读错误
        msg = " ".join(stderr.split()) or f"svn blame 退出码 {proc.returncode}"
        raise RuntimeError(msg)

    xml_text = stdout_b.decode("utf-8", errors="replace")
    result = _parse_blame_xml(xml_text)
    _blame_cache[key] = result
    if len(_blame_cache) > _LRU_MAX:
        _blame_cache.popitem(last=False)
    return result


async def svn_blame_lines(
    path: str, line_numbers: list[int], revision: str = "BASE"
) -> dict[int, dict[str, Any]]:
    """按需查询:只返回指定行号的 blame 元信息(按需触发,不全量暴露)。

    内部仍跑一次 blame 并缓存(大文件建议后续加单行 blame 能力),
    但返回只含请求的行。line_number 为 1-based。
    """
    if not line_numbers:
        return {}
    all_rows = await svn_blame(path, revision)
    by_line = {r["lineNumber"]: r for r in all_rows}
    return {ln: by_line[ln] for ln in line_numbers if ln in by_line}


def clear_blame_cache(path: str | None = None) -> int:
    """清空缓存(或只清某 path)。返回清掉的条目数。"""
    if path is None:
        n = len(_blame_cache)
        _blame_cache.clear()
        return n
    abspath = os.path.abspath(path)
    keys = [k for k in _blame_cache if k[0] == abspath]
    for k in keys:
        _blame_cache.pop(k, None)
    return len(keys)
