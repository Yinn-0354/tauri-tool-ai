"""VCS — 版本控制操作（SVN / Git）。

通过 subprocess 调用 svn/git 命令行（与同级 custom-rule 仓库 BaseToolFunc_Official.py
的 svn_get_log 风格一致：list-form 参数、--xml 结构化输出、显式超时、--non-interactive）。

说明：
- `svn blame --xml` 只返回每行的 revision/author/date/line-number，**不包含行内容**。
  行内容由调用方从工作副本磁盘读取后按行号对齐（见 main.py 的 /api/vcs/blame）。
- blame / list 需要联网（取历史），cat / info 对本地工作副本可离线读取 pristine。
- 所有 subprocess 调用使用 list-form 参数（禁止 shell=True，避免路径注入）。
"""

import subprocess
import xml.etree.ElementTree as ET


class VcsError(Exception):
    """VCS 操作失败（命令缺失、超时、svn 返回非零、XML 解析失败等）。"""


# svn blame / list 需要联系服务器取历史，给较宽松的超时
_SVN_BLAME_TIMEOUT = 60
# svn cat 对本地工作副本读 pristine（BASE），离线免网络，通常很快
_SVN_CAT_TIMEOUT = 20
_SVN_LOG_TIMEOUT = 30


def _decode_stdout(data: bytes) -> str:
    """svn --xml 输出恒为 UTF-8（已实测：头部 `<?xml version="1.0" encoding="UTF-8"?>`）。"""
    return data.decode("utf-8", errors="replace")


def _decode_stderr(data: bytes) -> str:
    """svn stderr 在中文 Windows 上使用控制台代码页（实测为 gbk），用 gbk 解码避免乱码。"""
    try:
        return data.decode("gbk", errors="replace")
    except Exception:
        return data.decode("utf-8", errors="replace")


def _svn_run(args: list[str], timeout: int) -> str:
    """运行 svn 命令并返回 UTF-8 解码后的 stdout；非零返回码/缺失/超时抛 VcsError。"""
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise VcsError("未找到 svn 命令，请确认已安装 TortoiseSVN 并加入 PATH")
    except subprocess.TimeoutExpired:
        raise VcsError(f"svn 命令超时（>{timeout}s）")
    if result.returncode != 0:
        msg = _decode_stderr(result.stderr).strip() or f"svn 返回码 {result.returncode}"
        raise VcsError(msg)
    return _decode_stdout(result.stdout)


def svn_commit_info(path: str, revision: str) -> dict:
    """获取某 revision 的完整提交详情：作者/时间/提交信息/改动文件列表。

    用 `svn log --xml -v -r REV <path>` 针对**工作副本文件**取（不联网不行，
    svn log 必须联系服务器取历史），而**不**用仓库根 URL——因为账号对仓库根
    可能无权限（实测 E175013 Access forbidden），但对具体工作副本文件有权限。
    -v 仍会列出该 commit 的全部改动文件（含非当前文件），与 repo_root 目标一致。

    返回 {revision, author, date, message, changedFiles: [{path, action, kind}]}。
    """
    if not revision:
        raise VcsError("缺少 revision")
    out = _svn_run(
        ["svn", "log", "--xml", "-v", "--non-interactive", "-r", str(revision), path],
        _SVN_LOG_TIMEOUT,
    )
    root = ET.fromstring(out)
    entry = root.find("logentry")
    if entry is None:
        raise VcsError(f"未找到 revision {revision} 的日志")

    author_el = entry.find("author")
    date_el = entry.find("date")
    msg_el = entry.find("msg")

    changed: list[dict] = []
    paths_el = entry.find("paths")
    if paths_el is not None:
        for p in paths_el.findall("path"):
            changed.append({
                "path": (p.text or "").strip(),
                "action": (p.get("action") or "").strip(),
                "kind": (p.get("kind") or "").strip(),
            })

    return {
        "revision": (entry.get("revision") or "").strip(),
        "author": (author_el.text or "") if author_el is not None else "",
        "date": (date_el.text or "") if date_el is not None else "",
        "message": (msg_el.text or "") if msg_el is not None else "",
        "changedFiles": changed,
    }


def is_svn_auth_or_access_error(msg: str) -> bool:
    """识别 SVN 凭证/权限类失败（区别于网络不通、非工作副本等）。

    - E215004 / "No more credentials" / "Authentication failed"：凭证未缓存或失效
    - E175013 / "Access to '...' forbidden"：账号对该路径无权限
    命中时给用户明确的"登录/权限"指引，而非笼统的"服务器不可达"。
    stderr 经 gbk 解码，ASCII 的 SVN 错误码 E215004/E175013 完整保留。
    """
    m = msg.lower()
    if "e215004" in m or "no more credentials" in m or "authentication failed" in m:
        return True
    if "e175013" in m or "access to" in m and "forbidden" in m:
        return True
    return False


def svn_blame(path: str) -> list[dict]:
    """获取文件的逐行 blame 元信息。

    通过 `svn blame --xml --non-interactive <path>` 获取，返回按行号升序的列表：
    [{lineNumber, revision, author, date}, ...]（不含行内容）。

    需要联网（blame 需取服务器端历史）。失败时抛出 VcsError，由端点映射为 HTTPException。
    """
    args = ["svn", "blame", "--xml", "--non-interactive", path]
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            timeout=_SVN_BLAME_TIMEOUT,
        )
    except FileNotFoundError:
        raise VcsError("未找到 svn 命令，请确认已安装 TortoiseSVN 并加入 PATH")
    except subprocess.TimeoutExpired:
        raise VcsError(
            f"获取 blame 超时（>{_SVN_BLAME_TIMEOUT}s），可能文件过大或 SVN 服务器不可达"
        )

    if result.returncode != 0:
        msg = _decode_stderr(result.stderr).strip() or f"svn 返回码 {result.returncode}"
        raise VcsError(msg)

    try:
        root = ET.fromstring(_decode_stdout(result.stdout))
    except ET.ParseError as e:
        raise VcsError(f"解析 blame 输出失败: {e}")

    # svn blame --xml 结构：
    # <blame>
    #   <target path="...">
    #     <entry line-number="N">
    #       <commit revision="R">
    #         <author>A</author>
    #         <date>ISO8601Z</date>
    #       </commit>
    #     </entry>
    #     ...
    #   </target>
    # </blame>
    entries: list[dict] = []
    for entry in root.iter("entry"):
        line_number = entry.get("line-number")
        commit = entry.find("commit")
        revision = commit.get("revision") if commit is not None else None
        author_el = commit.find("author") if commit is not None else None
        date_el = commit.find("date") if commit is not None else None
        entries.append({
            "lineNumber": int(line_number) if line_number and line_number.isdigit() else len(entries) + 1,
            "revision": revision or "",
            "author": (author_el.text or "") if author_el is not None else "",
            "date": (date_el.text or "") if date_el is not None else "",
        })

    entries.sort(key=lambda x: x["lineNumber"])
    return entries


def svn_cat(path: str) -> bytes:
    """读取工作副本文件的 pristine（BASE）内容（本地 .svn pristine 存储，离线免网络）。

    用于与 `svn blame`（默认 BASE 版本）的行号对齐：blame 标注的是 BASE 版本，
    若用磁盘工作副本（含未提交修改）对齐会产生错位。返回原始字节，由调用方解码。
    """
    args = ["svn", "cat", "--non-interactive", path]
    try:
        result = subprocess.run(args, capture_output=True, timeout=_SVN_CAT_TIMEOUT)
    except FileNotFoundError:
        raise VcsError("未找到 svn 命令，请确认已安装 TortoiseSVN 并加入 PATH")
    except subprocess.TimeoutExpired:
        raise VcsError(f"读取文件超时（>{_SVN_CAT_TIMEOUT}s）")
    if result.returncode != 0:
        msg = _decode_stderr(result.stderr).strip() or f"svn 返回码 {result.returncode}"
        raise VcsError(msg)
    return result.stdout
