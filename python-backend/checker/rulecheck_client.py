"""配置检查器 · rulecheck MCP 客户端封装。

按当前环境(config.get_env())选 MCP 端点,用 mcp Python 库 streamablehttp_client 连 HTTP MCP,
调两个工具:
- get_all_check_results_in_report(reportId) → 全量规则结果 data[](PRD 2.1)
- get_rule_by_rule_id(ruleId) → 规则详情(含 desc 规则需求描述 + script_path 脚本相对路径)

第一层取数流程(fetch_report):
1. 从报告链接抠 reportId(URL query 段)
2. MCP get_all_check_results_in_report(reportId) 拿全量 data[]
3. (可选)后端本地按 rule_name 精确匹配过滤
4. 每条规则调 get_rule_by_rule_id(rule_id) 拿 desc + script_path,塞进规则结果
5. 返回 {rules: [...]}(每条含 PRD 2.1 全字段 + ruleDesc + scriptPath)

MCP 会话短生命周期:每次调用开新 session,跑完关。免鉴权(MCP server 自处理)。
"""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlparse, parse_qs

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from checker import config

log = logging.getLogger(__name__)

# MCP 调用超时(秒)。报告可能很大(实测 9322 返 107KB),给宽点。
_MCP_TIMEOUT = 60.0

# 分支识别时间范围(PRD §12.1):今天-7天 ~ 今天。
_REPORT_LOOKBACK_DAYS = 7


# ───────────────────────── 链接解析 ─────────────────────────


def parse_report_id(report_url: str) -> int:
    """从报告链接抠 reportId。

    链接样例:https://rulecheck.testplus.cn/project/JX3/summary?reportId=9322
    报告链接 ?reportId=N 里的 N 是真 reportId(聚合报告 id)。
    返回 int;解析失败抛 ValueError。
    """
    if not report_url or not report_url.strip():
        raise ValueError("报告链接为空")
    url = report_url.strip()
    try:
        parsed = urlparse(url)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"报告链接格式非法: {e}") from e
    qs = parse_qs(parsed.query)
    raw = qs.get("reportId", [None])[0]
    if raw is None:
        raise ValueError(f"链接里找不到 reportId 参数: {url}")
    try:
        return int(raw)
    except ValueError as e:
        raise ValueError(f"reportId 不是整数: {raw!r}") from e


def parse_appkey(report_url: str) -> str | None:
    """从报告链接 path 段抠 appkey(项目 id)。

    链接样例:https://rulecheck.testplus.cn/project/JX3/summary?reportId=9322 → 'JX3'
    路径段 /project/<appkey>/... 的第二段即 appkey。解析失败返回 None(不阻断,审核时再报)。
    """
    if not report_url or not report_url.strip():
        return None
    try:
        parsed = urlparse(report_url.strip())
    except Exception:  # noqa: BLE001
        return None
    parts = [p for p in parsed.path.split("/") if p]
    # 期望 ['project', '<appkey>', ...]
    if len(parts) >= 2 and parts[0] == "project":
        return parts[1]
    return None


# ───────────────────────── MCP 调用 ─────────────────────────


async def _call_mcp_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """连当前环境的 MCP,调一个工具,返回其结构化结果(dict)。

    MCP 工具返回的是 CallToolResult,内容在 .data(结构化 JSON)里。
    本函数已验证可用(streamablehttp_client + ClientSession,见已删的 probe_mcp.py)。
    """
    endpoint = config.get_mcp_endpoint()
    log.info("MCP 调用 %s args=%s endpoint=%s", tool_name, arguments, endpoint)
    try:
        async with streamablehttp_client(endpoint, timeout=_MCP_TIMEOUT) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                # CallToolResult.content 是 list of TextContent(带 .text 属性),MCP 返回 JSON 文本
                # 本版 mcp 库 CallToolResult 无 .data 属性,直接从 content[0].text 解析 JSON
                if result.content and hasattr(result.content[0], "text"):
                    import json
                    return json.loads(result.content[0].text)
                raise RuntimeError(f"MCP 工具 {tool_name} 返回空结果(无 content)")
    except Exception as e:  # noqa: BLE001
        # mcp 库用 anyio TaskGroup,异常被包成 ExceptionGroup,展开拿真实原因
        msg = _flatten_exception(e)
        log.error("MCP 调用失败 %s: %s", tool_name, msg)
        raise RuntimeError(f"MCP 调用 {tool_name} 失败: {msg}") from e


def _flatten_exception(e: BaseException) -> str:
    """展开 ExceptionGroup / BaseExceptionGroup,拿最内层真实异常信息。"""
    # Python 3.11+ 内置 ExceptionGroup / BaseExceptionGroup
    if isinstance(e, BaseExceptionGroup):
        parts: list[str] = []
        for sub in e.exceptions:
            parts.append(_flatten_exception(sub))
        return "; ".join(p for p in parts if p)
    return f"{type(e).__name__}: {e}"


# ───────────────────────── 对外 API ─────────────────────────


async def fetch_report(report_url: str, rule_name_filter: str | None = None) -> dict[str, Any]:
    """第一层:取报告全量规则结果 + 每条补规则详情 + 分支识别。

    入参:
- report_url:平台报告链接(含 ?reportId=N)
- rule_name_filter:可选,精确匹配 rule_name;空/None 返回全部

    返回:
{
  "reportId": int,
  "appkey": str | None,
  "branch": str | None,       # PRD §12.1:识别出的 SVN 分支(无则 None,回退默认分支)
  "branchAlia": str | None,   # 分支别名(UI 显示用)
  "rules": [
    {
      ...PRD 2.1 全字段(rule_name/rule_id/module/owner/status/note/result.*...),
      "ruleDesc": str,        # 规则需求描述(从 get_rule_by_rule_id 补)
      "scriptPath": str,       # 脚本相对路径(从 get_rule_by_rule_id 补)
    }
  ]
}

    异常:链接非法 / MCP 不可达 / 报告不存在 → 抛 RuntimeError(ValueError 链接问题)。
    """
    report_id = parse_report_id(report_url)
    appkey = parse_appkey(report_url)

    # 0. 分支识别(PRD §12.1):调 getReports 按 reportId 匹配,失败/不匹配 → None(软降级)
    branch_info: dict[str, Any] | None = None
    if appkey:
        branch_info = await identify_report_branch_safe(appkey, report_id)

    # 1. 拿全量规则结果
    raw = await _call_mcp_tool("get_all_check_results_in_report", {"reportId": report_id})
    if not isinstance(raw, dict) or raw.get("code") != 0:
        raise RuntimeError(f"MCP 取报告失败: {raw.get('msg', raw) if isinstance(raw, dict) else raw}")
    rules: list[dict[str, Any]] = raw.get("data", []) or []
    if not isinstance(rules, list):
        raise RuntimeError(f"MCP 返回 data 不是数组: {type(rules)}")

    # 2. 后端本地按 rule_name 精确过滤(可选)
    if rule_name_filter and rule_name_filter.strip():
        wanted = rule_name_filter.strip()
        rules = [r for r in rules if r.get("rule_name") == wanted]

    # 3. 每条规则补规则详情(desc + script_path)
    # 并发调 get_rule_by_rule_id 会开多个 MCP session,序列化避免连接爆炸。
    # 规则数通常 <100,串行可接受;后续要并发可改 asyncio.gather。
    enriched: list[dict[str, Any]] = []
    for r in rules:
        rule_id = r.get("rule_id")
        rule_desc = ""
        script_path = ""
        if isinstance(rule_id, int):
            try:
                detail = await _call_mcp_tool("get_rule_by_rule_id", {"ruleId": rule_id})
                if isinstance(detail, dict) and detail.get("code") == 0:
                    data = detail.get("data") or {}
                    rule_desc = str(data.get("desc", "") or "")
                    script_path = str(data.get("script_path", "") or "")
                else:
                    log.warning("取规则详情失败 rule_id=%s: %s", rule_id, detail)
            except RuntimeError as e:
                # 单条规则详情失败不阻断整体,降级空 desc/script_path
                log.warning("取规则详情异常 rule_id=%s: %s", rule_id, e)
        # 浅拷贝 + 补字段(不污染原始)
        enriched.append({**r, "ruleDesc": rule_desc, "scriptPath": script_path})

    return {
        "reportId": report_id,
        "appkey": appkey,
        "branch": branch_info["branch"] if branch_info else None,
        "branchAlia": branch_info["branchAlia"] if branch_info else None,
        "rules": enriched,
    }


async def get_project_infos() -> list[dict[str, Any]]:
    """取所有项目信息(给全局设置 UI 选 appkey 用)。"""
    raw = await _call_mcp_tool("get_all_project_infos", {})
    if not isinstance(raw, dict) or raw.get("code") != 0:
        raise RuntimeError(f"MCP 取项目列表失败: {raw}")
    return raw.get("data", []) or []


# ───────────────────────── 分支识别(PRD §12.1) ─────────────────────────


async def get_reports(project_id: str) -> list[dict[str, Any]]:
    """调 MCP get_reports 取该项目的近期报告列表(用于分支识别)。

    入参 {projectId, start_time, end_time},时间范围 今天-7天 ~ 今天(PRD 决策 32)。
    返回数组每项含 id/project_id/branch/branch_alia/version/error_count 等。
    MCP 调用失败 → 抛 RuntimeError(调用方降级,不阻断审核)。
    """
    end_d = date.today()
    start_d = end_d - timedelta(days=_REPORT_LOOKBACK_DAYS)
    raw = await _call_mcp_tool(
        "get_reports",
        {
            "projectId": project_id,
            "start_time": start_d.isoformat(),
            "end_time": end_d.isoformat(),
        },
    )
    if not isinstance(raw, dict) or raw.get("code") != 0:
        raise RuntimeError(f"MCP get_reports 失败: {raw.get('msg', raw) if isinstance(raw, dict) else raw}")
    data = raw.get("data", []) or []
    if not isinstance(data, list):
        raise RuntimeError(f"MCP get_reports 返回 data 不是数组: {type(data)}")
    return data


def identify_report_branch(reports: list[dict[str, Any]], report_id: int) -> dict[str, Any] | None:
    """在 get_reports 返回数组里按 id == report_id 匹配,取该报告的分支信息。

    返回 {branch, branch_alia} 或 None(没匹配到 → 调用方回退默认分支)。
    """
    for r in reports:
        if r.get("id") == report_id:
            return {
                "branch": str(r.get("branch", "") or ""),
                "branchAlia": str(r.get("branch_alia", "") or ""),
            }
    return None


async def identify_report_branch_safe(project_id: str, report_id: int) -> dict[str, Any] | None:
    """安全的分支识别:调 get_reports 并匹配,任何失败/不匹配返回 None(软降级)。

    PRD §12.1:拉取报告时顺带调 getReports,按 reportId 匹配取 branch。
    调用失败或匹配不到 → 返回 None,调用方回退 get_appkey_root(appkey, "") 默认分支。
    """
    try:
        reports = await get_reports(project_id)
        return identify_report_branch(reports, report_id)
    except RuntimeError as e:
        log.warning("get_reports 调用失败,分支识别降级: %s", e)
        return None
