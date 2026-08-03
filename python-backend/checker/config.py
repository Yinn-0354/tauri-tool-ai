"""配置检查器 · 全局设置持久化。

文件:%LOCALAPPDATA%/tauri-tool-ai/checker-config.json
结构:
{
  "env": "prod" | "dev",                 # 当前环境,决定调哪个 MCP
  "appkeyRoots": [                        # PRD 3.1:appkey + 分支 → 本地根路径映射(数组,复合键 appkey|branch 唯一)
    {"appkey": "JX3", "branch": "release", "root": "D:/work/jx3-release"},
    {"appkey": "JX3", "branch": "trunk",    "root": "D:/work/jx3-trunk"}
  ],
  "scriptLibRoot": "<路径>"              # PRD 3.2:全局单一脚本库根目录
}

分支为 SVN 分支名(平台无此维度,用户手填);同一 appkey 不同分支的表内容不同,故复合键唯一。
向后兼容:旧版 appkeyRoots 是 dict[str,str](无分支),加载时迁移成 list(appkey 当 appkey、branch 留空、value 当 root)。

内存加载 + 原子落盘,沿用 table_config.py 的模式。
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

# ───────────────────────── 配置文件路径 ─────────────────────────

_LOCALAPPDATA = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
CONFIG_DIR = Path(_LOCALAPPDATA) / "tauri-tool-ai"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = CONFIG_DIR / "checker-config.json"

# MCP 端点(按环境)。复用全局 ~/.claude.json 注册的 rulecheck / rulecheck-dev,
# 后端用 mcp Python 库 streamablehttp_client 连这两个 HTTP MCP。
MCP_ENDPOINTS: dict[str, str] = {
    "prod": "http://10.11.66.70:7072/mcp",
    "dev": "http://10.11.82.207:7000/mcp",
}

Env = Literal["prod", "dev"]

# 各项目内置 SVN 分支(平台无此维度,后端写死供前端补全)。键=appkey,值=分支名列表。
# 用户在设置里选/填分支;不在内置表里的 appkey 仍允许手填任意分支名(不阻断)。
# 维护:新增项目分支在此追加即可。
BUILTIN_BRANCHES: dict[str, list[str]] = {
    "JX3": ["trunk", "branches-rel/b_jx3_released_zhcn_hd"],
    "mecha": [
        "branches-rel/b_MechaWar_release_hotfix",
        "branches-rel/b_MechaWar_release",
        "trunk",
    ],
}

# ───────────────────────── 内存加载/落盘 ─────────────────────────

_config_cache: dict[str, Any] | None = None


def _load_all() -> dict[str, Any]:
    """全量加载 checker-config.json;不存在或损坏返回空 dict(用默认值填充)。"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    base = _default_config()
    if not CONFIG_PATH.exists():
        _config_cache = base
        return _config_cache
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            # 合并:文件值覆盖默认值,保证新字段有默认
            base.update(data)
            _config_cache = _normalize(base)
        else:
            _config_cache = _normalize(base)
    except (OSError, json.JSONDecodeError):
        _config_cache = _normalize(base)
    return _config_cache


def _save_all(cfg: dict[str, Any]) -> None:
    """原子替换落盘;同时刷新内存缓存。"""
    global _config_cache
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)
    _config_cache = cfg


def _default_config() -> dict[str, Any]:
    return {"env": "prod", "appkeyRoots": [], "scriptLibRoot": ""}


def _normalize_appkey_roots(value: Any) -> list[dict[str, str]]:
    """规范化 appkeyRoots 成 list[{appkey, branch, root}]。

    兼容旧 dict[str,str] 结构(无分支):自动迁移成 list,branch 留空。
    去重:复合键 appkey|branch 重复时后者覆盖前者(防御性,正常路径由 set_config 校验拦截)。
    过滤:root 为空的项丢弃(无根路径的映射无意义)。appkey/branch 去首尾空白。
    """
    if isinstance(value, dict):
        # 旧结构迁移:{appkey: root} → [{appkey, branch:"", root}]
        items: list[dict[str, str]] = []
        for k, v in value.items():
            if not v:
                continue
            items.append({"appkey": str(k).strip(), "branch": "", "root": str(v).strip()})
        return items
    if not isinstance(value, list):
        return []
    out: dict[str, dict[str, str]] = {}  # 复合键 → 项(后者覆盖前者)
    for item in value:
        if not isinstance(item, dict):
            continue
        appkey = str(item.get("appkey", "")).strip()
        root = str(item.get("root", "")).strip()
        if not appkey or not root:
            continue
        branch = str(item.get("branch", "")).strip()
        out[f"{appkey}|{branch}"] = {"appkey": appkey, "branch": branch, "root": root}
    return list(out.values())


def _normalize(value: dict[str, Any]) -> dict[str, Any]:
    """规范化:确保字段齐全且类型正确。"""
    env = value.get("env", "prod")
    if env not in ("prod", "dev"):
        env = "prod"
    appkey_roots = _normalize_appkey_roots(value.get("appkeyRoots", []))
    script_lib_root = value.get("scriptLibRoot", "")
    if not isinstance(script_lib_root, str):
        script_lib_root = ""
    return {
        "env": env,
        "appkeyRoots": appkey_roots,
        "scriptLibRoot": script_lib_root,
    }


# ───────────────────────── 对外 API ─────────────────────────


def get_config() -> dict[str, Any]:
    """返回当前全局设置(规范化后的副本)。"""
    return dict(_load_all())


def get_env() -> Env:
    """返回当前环境('prod' / 'dev')。"""
    return _load_all()["env"]


def get_mcp_endpoint() -> str:
    """返回当前环境对应的 MCP 端点 URL。"""
    env = get_env()
    return MCP_ENDPOINTS[env]


def get_appkey_root(appkey: str, branch: str = "") -> str | None:
    """返回 appkey+branch 对应的本地工作区根路径;无映射返回 None。

    分支匹配:优先精确匹配 (appkey, branch);branch 给了但没精确命中时,
    回退到 branch 为空的"默认分支"映射(兼容未细分分支的配置)。
    """
    roots = _load_all()["appkeyRoots"]
    # 精确匹配 (appkey, branch)
    for item in roots:
        if item["appkey"] == appkey and item["branch"] == branch:
            return item["root"]
    # branch 非空时回退默认分支(branch=="")
    if branch:
        for item in roots:
            if item["appkey"] == appkey and item["branch"] == "":
                return item["root"]
    return None


def get_script_lib_root() -> str:
    """返回全局脚本库根目录;未设置返回空串。"""
    return _load_all()["scriptLibRoot"]


def get_builtin_branches(appkey: str | None = None) -> list[str] | dict[str, list[str]]:
    """返回内置 SVN 分支。

    - appkey=None:返回全量 dict{appkey: [分支...]}(给前端全量补全数据)。
    - appkey 非空:返回该 appkey 的分支列表(无内置则空列表,前端降级允许手填)。
    """
    if appkey is None:
        return {k: list(v) for k, v in BUILTIN_BRANCHES.items()}
    return list(BUILTIN_BRANCHES.get(appkey, []))


def set_config(env: Env | None = None, appkey_roots: list[dict[str, str]] | None = None, script_lib_root: str | None = None) -> dict[str, Any]:
    """更新全局设置(任意字段 None 表示不改动),落盘,返回新配置。

    appkey_roots: list[{appkey, branch, root}]。复合键 appkey|branch 重复时抛 ValueError
    (前端应在校验阶段拦截提示,后端再做一次防御)。
    """
    cfg = _load_all()
    if env is not None:
        if env not in ("prod", "dev"):
            raise ValueError(f"env 必须是 'prod' 或 'dev',收到: {env!r}")
        cfg["env"] = env
    if appkey_roots is not None:
        if not isinstance(appkey_roots, list):
            raise ValueError("appkeyRoots 必须是数组")
        # 规范化前先查重复键(基于原始输入,带定位信息更好排查)
        seen: dict[str, int] = {}
        for idx, item in enumerate(appkey_roots):
            if not isinstance(item, dict):
                raise ValueError(f"appkeyRoots[{idx}] 必须是对象")
            appkey = str(item.get("appkey", "")).strip()
            branch = str(item.get("branch", "")).strip()
            if not appkey or not str(item.get("root", "")).strip():
                continue  # 空行跳过,不参与重复校验
            key = f"{appkey}|{branch}"
            if key in seen:
                raise ValueError(
                    f"appkey 映射重复:appkey={appkey!r} 分支={branch!r} 出现多次(第 {seen[key]+1} 行与第 {idx+1} 行)"
                )
            seen[key] = idx
        cfg["appkeyRoots"] = _normalize_appkey_roots(appkey_roots)
    if script_lib_root is not None:
        cfg["scriptLibRoot"] = str(script_lib_root)
    cfg = _normalize(cfg)
    _save_all(cfg)
    return dict(cfg)
