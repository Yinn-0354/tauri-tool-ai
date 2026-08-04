"""配置检查器 · 第三层审核(SSE)。

POST /api/checker/audit —— 前端点【审核结果】时调用,返回 text/event-stream。

阶段 2.1:接真 Claude Agent SDK(Python claude-agent-sdk,跑在 sidecar)。
- 读 ~/.claude/settings.json 的 env 段凭证(ANTHROPIC_AUTH_TOKEN/BASE_URL/CUSTOM_HEADERS),
  经 options.env 注入 CLI 子进程(零配置可分发,token 不进源码)。
- setting_sources=[] SDK 隔离:不加载 CLI 的 filesystem settings(避免用户的 hooks/MCP 污染审核)。
- 模型 glm-5.2[1M],系统提示词后端写死常量。
- 本地函数工具 read_check_script:用 @tool + create_sdk_mcp_server(type="sdk" 进程内 MCP),
  Claude 按需调,读检查脚本逻辑(script_reader.py 纯逻辑)。
- 此阶段不连截图 MCP(7 工具待阶段 2.2),screenshot 恒 null + screenshotReason。
- SDK 原生消息(AssistantMessage/UserMessage/ResultMessage)→ 业务 SSE 事件(step/step_done/result)映射。
- 会话日志写 D:\temp\tauri-checker\<errorObjId>_<时间戳>\conversation.jsonl(Rust 退出时清目录)。

SSE 事件类型(PRD §7):
  queued    {position: N}            排队中(前面还有 N 个)
  start     {errorObjId}              审核(Claude)开始
  step      {tool, desc}              某工具调用开始
  step_done {tool, result}            某工具调用返回
  result    {conclusion, screenshot, screenshotReason}  全部完成
  error     {message}                 失败

帧格式:命名事件 `event: <type>\\ndata: <json>\\n\\n`(每个事件两行 + 空行)。

注:SDK 相关 import 全部延迟到 _run_audit 内,main.py 启动不依赖 claude-agent-sdk
(未装也不卡死表格查看器,仅审核端点报"未安装")。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from checker import config as checker_config

log = logging.getLogger(__name__)

# ───────────────────────── 请求模型(PRD §7 审核入参) ─────────────────────────


class ErrorObjIn(BaseModel):
    """单条 errorObj(只传审核所需字段,不传 author/testLead)。"""

    table_path: str
    rowID: list[str | int]
    name: str
    value: str
    desc_hash: str


class RuleIn(BaseModel):
    """规则顶层信息(审核入参里的规则元信息)。"""

    rule_name: str
    rule_id: int
    module: list[str]
    owner: str
    note: dict[str, Any] | None = None
    status: str


class AuditRequest(BaseModel):
    """审核请求体:前端把 errorObj + 规则顶层 + 规则需求描述 + 脚本相对路径 + appkey 一并传。"""

    errorObj: ErrorObjIn
    rule: RuleIn
    ruleDesc: str = ""
    scriptPath: str = ""
    appkey: str | None = None


# ───────────────────────── SSE 小工具 ─────────────────────────


def sse(event: str, data: dict[str, Any]) -> str:
    """组装一个 SSE 帧:`event: <type>\\ndata: <json>\\n\\n`。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ───────────────────────── 串行排队 ─────────────────────────
# 全局串行:同时只允许一个审核跑(阶段 2.2 共享一个隐藏 AG Grid 实例,不支持并发)。
# 模块级 asyncio.Lock + 等待计数;生成器在拿到锁前先发 queued 事件。

_audit_lock = asyncio.Lock()
_waiting = 0  # 当前排队等待数(global,在生成器里读写)


# ───────────────────────── 凭证(读 ~/.claude/settings.json env 段) ─────────────────────────

_SETTINGS_PATH = Path.home() / ".claude" / "settings.json"


def _load_claude_env() -> dict[str, str]:
    """读 ~/.claude/settings.json 的 env 段,返回凭证环境变量 dict。

    PRD §6 决策 16:复用本机 settings.json env 段,零配置可分发。token 只从文件读,
    不写进源码/不进 git。文件不存在/无 env 段 → 返回空 dict(调用方降级报错)。
    """
    try:
        with open(_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    env = data.get("env") or {}
    if not isinstance(env, dict):
        return {}
    return {str(k): str(v) for k, v in env.items() if v is not None}


# ───────────────────────── 系统提示词(后端写死常量) ─────────────────────────
# PRD §6 决策 15 + §10 待办:系统提示词后端写死,开发者维护,不暴露用户配。
# 阶段 2.1:无截图 MCP,提示词只覆盖"理解错误 + 按需读脚本 + 生成口语对话"。

_SYSTEM_PROMPT = """你是配置表检查工具的审核助手。你的任务:理解一条配置表检查错误,必要时读取检查脚本理解规则逻辑,然后现场打开配置表截图核对,最后生成一段发给游戏数值策划的口语对话。

你会收到:规则信息(名称/模块/描述/状态)、错误信息(配置表/字段/行号/错误详情 value)、检查脚本相对路径(可选)。

你有两类工具:
1. read_check_script:读取检查脚本逻辑(按需,不需要时不调)。
2. 截图工具套装(7个):open_table(打开配置表)、get_columns(读列名)、search_cell(全表搜索定位行)、freeze_column(冻结列到左)、goto_cell(跳转到行/列)、get_viewport_info(核验视口中是否 ID列+错误行+错误列同时可见)、screenshot(截 AG Grid 为 PNG base64)。

工作流程(PRD §4.7 定位决策):
1. 定表:调用 open_table(table_path) 打开配置表,拿到 columns/rowCount/idColCandidates。
2. 定唯一ID列:优先从 value 里反推主键列名(平台用主键定位的行,主键列名大概率在 value 的 "列名=值" 里)。找不到则从 idColCandidates 里找 *ID/*id/编号 启发式;都找不到则不冻结。
3. 定行:rowID 正整数 → 候选行号;-1/不可解析 → 弃用行号,用 search_cell 按业务值搜。跳到该行后用 get_viewport_info 读实际值与 value 业务字段比对,确认行号正确。
4. 定列:name 在 columns → 候选列;不在 → 从 value 文本猜;校验该列值是否与 value 自洽。
5. 冻结+跳转:freeze_column(唯一ID列) → goto_cell(错误行,错误列) → get_viewport_info 核验"ID列+错误行+错误列+备注列(如有)同时可见"→ 不全则再调整 → screenshot。
6. 降级:实在定位不了 → 只生成对话,screenshot 返回 null。

输出要求:
- 一段发给策划的口语对话,中文,口语化,简洁。
- 说清:这是什么问题、涉及哪条数据(哪张表/哪个字段/哪一行/什么业务值)、为什么是错的、建议怎么改。
- 让策划能直接看懂并知道下一步做什么。用策划听得懂的话,不要罗列原始字段名。
- 不要用 markdown 标题或列表符号包裹整段,直接写对话本身(可自然换行)。
- 如果成功截了图,在对话末尾提一句"截图已附,可对照查看"。"""


# ───────────────────────── 工具名 → 中文描述(PRD §7 step.desc) ─────────────────────────

_TOOL_DESC: dict[str, str] = {
    "mcp__script__read_check_script": "正在读取检查脚本",
    "mcp__screenshot__open_table": "正在打开配置表",
    "mcp__screenshot__get_columns": "正在读取列信息",
    "mcp__screenshot__search_cell": "正在全表搜索定位",
    "mcp__screenshot__freeze_column": "正在冻结唯一ID列",
    "mcp__screenshot__goto_cell": "正在跳转到错误处",
    "mcp__screenshot__get_viewport_info": "正在核验信息齐全",
    "mcp__screenshot__screenshot": "正在截图",
}


# ───────────────────────── 截图 MCP 端口发现(PRD §4.4) ─────────────────────────

_SCREENSHOT_MCP_PORT_FILE = os.path.join(tempfile.gettempdir(), "tauri-tool-ai-mcp-port.txt")


def _get_screenshot_mcp_url() -> str | None:
    """读截图 MCP 端口文件,返回 http://127.0.0.1:{port}/mcp。

    Rust/Tauri 壳起 axum HTTP MCP server 时写端口文件,Py sidecar 读端口连。
    文件不存在(截图 MCP 未启动)/端口读不到 → 返回 None,审核降级为无截图。
    """
    try:
        with open(_SCREENSHOT_MCP_PORT_FILE, "r", encoding="ascii") as f:
            port_str = f.read().strip()
        port = int(port_str)
        if 1024 <= port <= 65535:
            return f"http://127.0.0.1:{port}/mcp"
    except (OSError, ValueError):
        pass
    return None


# ───────────────────────── 会话日志(PRD §6) ─────────────────────────

_CHECKER_LOG_BASE = Path(r"D:\temp\tauri-checker")


def _safe_name(s: str) -> str:
    """把 errorObjId(desc_hash)规整成安全的目录名段。"""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in s)[:64] or "unknown"


def _make_log_dir(error_obj_id: str) -> Path:
    """建本次审核的日志子目录 D:\\temp\\tauri-checker\\<id>_<时间戳>,返回路径。

    目录建不出(D 盘不存在等)→ 返回 None,调用方跳过写日志不阻断审核。
    """
    ts = time.strftime("%Y%m%d-%H%M%S")
    d = _CHECKER_LOG_BASE / f"{_safe_name(error_obj_id)}_{ts}"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        return Path()  # 空 Path,写日志时 is_absolute() 为 False,跳过
    return d


def _write_log(log_dir: Path, entries: list[dict[str, Any]], final_text: str) -> None:
    """把审核流水写成 conversation.jsonl(每行一个事件 JSON)。失败静默不阻断。"""
    if not log_dir or not log_dir.is_absolute():
        return
    try:
        with open(log_dir / "conversation.jsonl", "w", encoding="utf-8") as f:
            for e in entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
            f.write(
                json.dumps(
                    {"event": "result", "conclusion": final_text}, ensure_ascii=False
                )
                + "\n"
            )
    except OSError:
        pass


async def _svn_update_audit_table(req: AuditRequest) -> dict[str, Any] | None:
    """审核前把被核表 svn update 到最新(PRD §12.3)。

    解析 table_path → 绝对路径(用 appkey→root 映射,与 ScreenshotGrid open_table 同一逻辑)→
    单文件 update。返回 None = 没有可 update 的表(appkey/根未配/解析不到,跳过);
    否则返回 svn_update 的结果。任何异常软降级返回 {updated: False, message},不抛(审核照跑)。
    """
    table_path = (req.errorObj.table_path or "").strip()
    if not table_path:
        return None
    abs_path: str | None = None
    try:
        root = checker_config.get_appkey_root(req.appkey or "")
        if root:
            cand = Path(table_path)
            if cand.is_absolute() and cand.is_file():
                abs_path = str(cand)
            else:
                import glob as _glob

                root_path = Path(root)
                if root_path.is_dir():
                    pattern = str(root_path / "**" / cand.name)
                    matches = _glob.glob(pattern, recursive=True)
                    if matches:
                        abs_path = matches[0]
    except Exception:  # noqa: BLE001 - 解析失败跳过 update
        abs_path = None
    if not abs_path:
        return None

    try:
        from vcs import svn as svn_mod

        return await svn_mod.svn_update(abs_path)
    except Exception as e:  # noqa: BLE001 - svn 不可用/超时等软降级
        log.warning("审核前 svn update 异常 %s: %s", abs_path, e)
        return {"updated": False, "message": f"svn update 失败:{e}"}


def _build_prompt(req: AuditRequest) -> str:
    """把审核入参(errorObj + 规则 + 规则描述 + 脚本路径)拼成给 Claude 的 user prompt。"""
    e = req.errorObj
    r = req.rule
    parts: list[str] = ["请审核以下配置表检查错误,生成发给策划的口语对话。"]

    parts.append("\n## 规则信息")
    parts.append(f"- 规则名:{r.rule_name}")
    parts.append(f"- 模块:{', '.join(r.module) or '无'}")
    parts.append(f"- 规则状态:{r.status}")
    parts.append(f"- 创建人:{r.owner or '未知'}")
    if r.note and isinstance(r.note.get("fails"), (int, float)):
        parts.append(f"- 错误数:{r.note['fails']}")
    if req.ruleDesc:
        parts.append(f"- 规则需求描述:\n{req.ruleDesc}")

    parts.append("\n## 错误信息")
    parts.append(f"- 配置表:{e.table_path}")
    parts.append(f"- 字段/列:{e.name or '未指定'}")
    row_display = ",".join(str(x) for x in e.rowID) or "未指定"
    parts.append(f"- 行号:{row_display}")
    parts.append(f"- 错误详情:\n{e.value}")

    if req.scriptPath:
        parts.append("\n## 检查脚本")
        parts.append(f"- 脚本相对路径:{req.scriptPath}")
        parts.append(
            "(如需理解脚本逻辑,可调用 read_check_script 工具,传入此相对路径)"
        )

    parts.append("\n## 任务")
    parts.append("1. 理解错误详情(value)中的业务字段值、问题陈述和根因。")
    parts.append("2. 如需理解检查规则实现逻辑,调用 read_check_script 读取脚本。")
    parts.append(
        "3. 结合以上信息,生成一段发给策划的口语对话:说明问题、涉及数据、建议修改。"
    )
    return "\n".join(parts)


# ───────────────────────── 工具结果摘要(step_done.result) ─────────────────────────

def _summarize_tool_result(content: object) -> str:
    """把 ToolResultBlock.content(str | list[dict] | None)摘要成短串给前端 step_done。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content[:120]
    if isinstance(content, list):
        texts: list[str] = []
        for c in content:
            if isinstance(c, dict) and "text" in c:
                texts.append(str(c["text"]))
            else:
                texts.append(str(c))
        return (" ".join(texts))[:120]
    return str(content)[:120]


def _extract_screenshot_base64(content: object) -> str | None:
    """从 screenshot 工具的 ToolResultBlock.content 里提取 imageBase64。

    MCP 工具返回 content=[{type:text, text: JSON}],JSON 含 {imageBase64} 或 result 嵌套。
    大结果(截图 base64 超 SDK 阈值)会被 CLI 持久化到文件,content 变成
    `<persisted-output>\\nOutput too large (64KB). Full output saved to: <路径>`,
    此时要从路径读文件再提取。
    解析失败/格式不对 → None(不抛,降级).
    """
    try:
        text = ""
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    text = str(c.get("text", ""))
                    break
        if not text:
            return None

        # 大结果被持久化:content 是指向文件的引用,读文件内容再提取
        if "<persisted-output>" in text:
            import re as _re

            m = _re.search(r"Full output saved to:\s*([^\n]+)", text)
            if m:
                p = m.group(1).strip()
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        text = f.read()
                except OSError as e:
                    log.warning("读 persisted screenshot 结果失败 %s: %s", p, e)
                    return None

        data = json.loads(text)
        # ScreenshotGrid 返回 {imageBase64: "..."} 或 [{type:text, text:"{imageBase64:...}"}]
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("type") == "text":
                    try:
                        inner = json.loads(str(item.get("text", "")))
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if isinstance(inner, dict):
                        data = inner
                        break
            else:
                data = {}
        if not isinstance(data, dict):
            return None
        # ScreenshotGrid 返回 {imageBase64: "..."}
        b64 = data.get("imageBase64")
        if isinstance(b64, str) and b64:
            return b64
        # 也兼容 result 嵌套:{result: {imageBase64: "..."}}
        inner = data.get("result")
        if isinstance(inner, dict):
            b64 = inner.get("imageBase64")
            if isinstance(b64, str) and b64:
                return b64
    except (json.JSONDecodeError, TypeError, AttributeError, OSError):
        pass
    return None


# ───────────────────────── 真 _run_audit(阶段 2.1) ─────────────────────────


async def _run_audit(req: AuditRequest) -> AsyncIterator[str]:
    """真审核:起 Claude Agent,连 read_check_script 本地工具,产 step/step_done + result。

    SDK 延迟导入:未装 claude-agent-sdk → 发 error 事件(不崩 main.py)。
    """
    error_obj_id = req.errorObj.desc_hash or "unknown"
    yield sse("start", {"errorObjId": error_obj_id})

    # 0. 审核前 svn update 被核表(PRD §12.3):硬前置,把配置表更到最新再核。
    #    只更新被核那张表(单文件);不进 Claude 工具集(update 不该由 Claude 决策)。
    #    作为一条 SSE step 事件推前端("正在更新本地表")。失败软降级不阻断。
    update_result = await _svn_update_audit_table(req)
    if update_result is not None:
        yield sse("step", {"tool": "svn_update", "desc": "正在更新本地表"})
        if not update_result["updated"]:
            log.info("审核前 svn update 跳过/失败: %s", update_result["message"])
        yield sse("step_done", {"tool": "svn_update", "result": update_result["message"]})

    # 1. 延迟导入 SDK(主进程启动不依赖它)
    try:
        from claude_agent_sdk import (
            query,
            ClaudeAgentOptions,
            tool,
            create_sdk_mcp_server,
        )
        from claude_agent_sdk.types import (
            AssistantMessage,
            UserMessage,
            ResultMessage,
            TextBlock,
            ToolUseBlock,
            ToolResultBlock,
        )
    except ImportError as e:
        yield sse("error", {"message": f"未安装 claude-agent-sdk,无法审核: {e}"})
        return

    # 2. 读凭证(~/.claude/settings.json env 段)
    settings_env = _load_claude_env()
    if not settings_env.get("ANTHROPIC_AUTH_TOKEN"):
        yield sse(
            "error",
            {
                "message": (
                    "未读到 ~/.claude/settings.json 的 ANTHROPIC_AUTH_TOKEN,无法审核。"
                    "请在本机 ~/.claude/settings.json 的 env 段配置凭证。"
                )
            },
        )
        return

    # 3. 建会话日志目录(提前到此:CLAUDE_CONFIG_DIR 要指向它,把 CLI 自身 transcript
    #    也圈进来,不泄到 ~/.claude;Rust 退出时清整个 D:\temp\tauri-checker)。
    log_dir = _make_log_dir(error_obj_id)
    # env 整体传给 CLI 子进程:先 spread os.environ(保留 PATH/HOME 等),再叠凭证,
    # 再叠 CLAUDE_CONFIG_DIR(隔离 CLI 自身状态目录,不污染用户 ~/.claude)。
    env = {**os.environ, **settings_env}
    if log_dir.is_absolute():
        env["CLAUDE_CONFIG_DIR"] = str(log_dir)

    # 3. 定义 read_check_script 本地函数工具(@tool → 进程内 MCP server)
    @tool(
        "read_check_script",
        "按相对路径读取检查脚本逻辑,用于审核时加强对规则的理解。"
        "入参 scriptRelPath 是规则详情里返回的脚本相对路径。"
        "脚本不存在或读不到时返回提示,不阻断审核。",
        {"scriptRelPath": str},
    )
    async def _read_check_script(args: dict[str, Any]) -> dict[str, Any]:
        from checker import script_reader

        rel = str(args.get("scriptRelPath", ""))
        r = script_reader.read_check_script(rel)
        if r["notFound"]:
            text = f"(脚本不存在或无法读取:{rel})"
        else:
            text = str(r["content"])
            if r["truncated"]:
                text += "\n\n[... 脚本过长已截断 ...]"
        return {"content": [{"type": "text", "text": text}]}

    script_server = create_sdk_mcp_server(name="script", tools=[_read_check_script])

    # 4. 组装 options(含截图 MCP if 端口可读)
    screenshot_mcp: dict[str, object] = {}
    screenshot_url = _get_screenshot_mcp_url()
    if screenshot_url:
        # 从 types.py:McpHttpServerConfig 是 TypedDict(type/http/url/headers)
        from claude_agent_sdk.types import McpHttpServerConfig

        screenshot_mcp = {
            "screenshot": McpHttpServerConfig(
                type="http",
                url=screenshot_url,
                headers={
                    "Content-Type": "application/json",
                },
            ),
        }
        log.info("截图 MCP 已接: %s", screenshot_url)

    def _stderr_cb(line: str) -> None:
        """CLI 子进程 stderr → 后端日志(排查 GLM 网关问题用)。

        脱敏:含凭证特征(ANTHROPIC_AUTH_TOKEN/sk-/Bearer)的行整行遮蔽,
        防止 CLI 崩溃时把 token 回显进 backend.log。
        """
        s = line.rstrip()
        if "ANTHROPIC_AUTH_TOKEN" in s or "sk-" in s or "Bearer " in s:
            s = "[redacted: 含凭证特征,已遮蔽]"
        log.info("[claude-cli stderr] %s", s)

    options = ClaudeAgentOptions(
        model="glm-5.2[1M]",
        system_prompt=_SYSTEM_PROMPT,
        env=env,
        mcp_servers={"script": script_server, **screenshot_mcp},
        tools=[],
        allowed_tools=[
            "mcp__script__read_check_script",
            # 截图 MCP 7 工具(server 名 screenshot):
            "mcp__screenshot__open_table",
            "mcp__screenshot__get_columns",
            "mcp__screenshot__search_cell",
            "mcp__screenshot__freeze_column",
            "mcp__screenshot__goto_cell",
            "mcp__screenshot__get_viewport_info",
            "mcp__screenshot__screenshot",
        ],
        permission_mode="bypassPermissions",
        setting_sources=[],
        strict_mcp_config=True,  # 只用本进程传的 mcp_servers,忽略 cwd 下 .mcp.json 等外部 MCP 配置
        max_turns=30,
        stderr=_stderr_cb,
    )

    prompt = _build_prompt(req)

    final_text = ""
    screenshot_base64: str | None = None  # HIGH #3:跟踪 mcp__screenshot__screenshot 的结果
    screenshot_reason: str | None = None
    pending: dict[str, str] = {}  # tool_use_id → tool name(配对 step/step_done)
    log_entries: list[dict[str, Any]] = []

    # 5. 跑 query,SDK 消息 → 业务 SSE 事件
    try:
        async for msg in query(prompt=prompt, options=options):
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, ToolUseBlock):
                        pending[block.id] = block.name
                        desc = _TOOL_DESC.get(block.name, f"正在调用 {block.name}")
                        yield sse("step", {"tool": block.name, "desc": desc})
                        log_entries.append(
                            {
                                "event": "tool_use",
                                "tool": block.name,
                                "input": block.input,
                            }
                        )
                    elif isinstance(block, TextBlock):
                        log_entries.append({"event": "text", "text": block.text})
            elif isinstance(msg, UserMessage):
                # 工具结果回灌:每个 ToolResultBlock 对应一次 step_done
                content = msg.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            tname = pending.pop(block.tool_use_id, "?")
                            summary = _summarize_tool_result(block.content)
                            yield sse("step_done", {"tool": tname, "result": summary})
                            log_entries.append(
                                {
                                    "event": "tool_result",
                                    "tool": tname,
                                    "result": summary,
                                    "is_error": block.is_error,
                                }
                            )
                            # HIGH #3:从 screenshot 工具结果里提取 base64
                            if tname == "mcp__screenshot__screenshot" and not block.is_error:
                                sc = _extract_screenshot_base64(block.content)
                                if sc:
                                    screenshot_base64 = sc
                                else:
                                    screenshot_reason = "截图工具返回了结果但未能提取 base64(格式异常)"
            elif isinstance(msg, ResultMessage):
                if msg.is_error:
                    errs = "; ".join(msg.errors or []) if msg.errors else ""
                    detail = errs or msg.result or "审核失败"
                    status = msg.api_error_status
                    if status:
                        detail = f"{detail} (HTTP {status})"
                    yield sse("error", {"message": detail})
                    _write_log(log_dir, log_entries, final_text)
                    return
                final_text = msg.result or ""
            # SystemMessage / StreamEvent / RateLimitEvent → 仅记日志,不发业务事件
    except asyncio.CancelledError:
        # 客户端断开(收起面板/关闭弹窗 abort):静默退出,不发事件。
        # 防御:_write_log 内部若抛非 OSError(json.dumps TypeError 等)会吞掉 CancelledError,
        # 用 try 包一层保证 CancelledError 干净 re-raise(让 query() 自己 aclose 清理 CLI 子进程)。
        try:
            _write_log(log_dir, log_entries, final_text)
        except Exception:  # noqa: BLE001
            pass
        raise
    except Exception as e:  # noqa: BLE001 - SSE 通道内兜底
        yield sse("error", {"message": f"Agent 异常: {e}"})
        try:
            _write_log(log_dir, log_entries, final_text)
        except Exception:  # noqa: BLE001
            pass
        return

    # 6. 写会话日志 + 发 result(阶段 2.2:含截图,feat 截图 MCP)
    _write_log(log_dir, log_entries, final_text)
    reason = screenshot_reason
    if screenshot_base64 is None and screenshot_url is None:
        reason = reason or "当前环境无截图 MCP(tauri-tool-ai-mcp-port.txt 不存在,降级为纯对话)"
    yield sse(
        "result",
        {
            "conclusion": final_text or "(审核完成,Claude 未输出对话)",
            "screenshot": screenshot_base64,
            "screenshotReason": reason,
        },
    )


# ───────────────────────── 对外入口 ─────────────────────────


def audit(req: AuditRequest) -> StreamingResponse:
    """POST /api/checker/audit 入口:串行 + SSE 流。

    生成器先判断锁是否被占 → 占则发 queued(带位置)→ 等锁 → 进 _run_audit。
    异常统一转 error 事件(不抛 HTTP,保持 SSE 通道)。
    """
    global _waiting

    async def gen() -> AsyncIterator[str]:
        global _waiting
        queued = False  # 是否已对 _waiting +1(用于 finally 补减,防取消时计数泄漏)
        try:
            if _audit_lock.locked():
                _waiting += 1
                queued = True
                yield sse("queued", {"position": _waiting})
            async with _audit_lock:
                if queued:
                    _waiting -= 1
                    queued = False
                async for chunk in _run_audit(req):
                    yield chunk
        except asyncio.CancelledError:
            # 客户端断开(关闭弹窗/收起面板 abort):静默退出,不发事件。
            raise
        except Exception as e:  # noqa: BLE001 - SSE 通道内兜底,转 error 事件
            yield sse("error", {"message": str(e)})
        finally:
            # 防御:取消发生在"已 +1 但还没进锁"时,补减回去,防 _waiting 计数永久泄漏。
            if queued:
                _waiting -= 1

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
