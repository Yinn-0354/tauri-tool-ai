"""配置表检查工具 · Python FastAPI sidecar

随机端口启动 → 写入临时文件 tauri-tool-ai-port.txt → Rust 轮询读取传前端。
/api/health 健康检查;模块1 表格数据层:/api/table/open + /api/table/data(见 table_io)。
"""
import os
import socket
import tempfile

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import table_io
import table_config
from vcs import svn as svn_blame_mod
from checker import config as checker_config
from checker import rulecheck_client
from checker import audit as checker_audit

PORT_FILE = os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")

app = FastAPI(title="配置表检查工具 Backend")

# dev:前端 localhost:5173 调后端,放开 CORS;生产收紧
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ───────────────────────── 模块1 表格数据层 ─────────────────────────

class TableOpenRequest(BaseModel):
    path: str
    headerRow: int | None = None  # 1-based;null=自动(首行当表头)
    skipRows: list[list[int]] = []  # [[a,b],...] 1-based 闭区间段
    encoding: str | None = None  # 文件编码(仅 .tab/.txt/.tsv);null=自动探测


@app.post("/api/table/open")
def table_open(req: TableOpenRequest):
    """打开本地表格文件(xlsx/xls/tab/txt/tsv),落盘 Parquet 缓存,返回 schema 与 rowCount。

    - 若 body 不带 headerRow/skipRows/encoding(默认 null/[]/null):读 table-config.json 该 path 的记录
      (有则用,无则 null/[]/null)。
    - 若 body 带:用传入值(打开时配置弹窗提交),且不写 table-config.json(写入由
      /api/table/config 单独管)。
    - parquet 缓存仍为全量原始行;columns/rowCount 按配置算。
    - encoding 进 tableId(换编码各自落 parquet,不共享缓存)。
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    # 判断 body 是否显式带了 headerRow/skipRows/encoding(字段出现在请求体即可,值 null/[]/null 也算
    # 显式提供,不能用「值非 null/非空」判断,否则用户显式传 headerRow=null/encoding=null 想用自动
    # 模式会被误判为没提供而读旧 config)。
    body_provided = (
        "headerRow" in req.model_fields_set
        or "skipRows" in req.model_fields_set
        or "encoding" in req.model_fields_set
    )

    header_row = req.headerRow
    skip_rows = req.skipRows
    encoding = req.encoding
    if not body_provided:
        # body 完全没带 headerRow/skipRows/encoding:读 table-config.json 预填
        cfg = table_config.load_config(req.path)
        header_row = cfg["headerRow"]
        skip_rows = cfg["skipRows"]
        encoding = cfg["encoding"]

    try:
        table_id, columns, row_count, _ = table_io.open_table(
            req.path, headerRow=header_row, skipRows=skip_rows, encoding=encoding
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001 - 把解析异常转 400,避免 500 栈泄漏
        raise HTTPException(status_code=400, detail=f"解析失败: {e}")
    return {
        "tableId": table_id,
        "rowCount": row_count,
        "columns": columns,
        "headerRow": header_row,
        "skipRows": skip_rows,
        "encoding": encoding,
    }


class TableDataRequest(BaseModel):
    tableId: str
    startRow: int = 0
    endRow: int
    sortCol: str | None = None
    sortAsc: bool = True
    headerRow: int | None = None
    skipRows: list[list[int]] = []  # [[a,b],...] 1-based 闭区间段
    filters: dict[str, list[str]] | None = None  # {配置列名: [值,...]},多列 AND


@app.post("/api/table/data")
def table_data(req: TableDataRequest):
    """对缓存 Parquet 做 lazy scan,可选 sort,slice 后取二维行数组。

    应用 headerRow/skipRows 剔除 + 列筛选(filters,多列 AND);返回筛选后 rowCount。
    改 POST:filters 值列表可能很长,GET URL 会超限。
    """
    if req.endRow <= req.startRow:
        raise HTTPException(status_code=400, detail="endRow 必须大于 startRow")
    try:
        rows, row_count, source_rows = table_io.read_rows(
            table_id=req.tableId,
            start_row=req.startRow,
            end_row=req.endRow,
            sort_col=req.sortCol,
            sort_asc=req.sortAsc,
            headerRow=req.headerRow,
            skipRows=req.skipRows,
            filters=req.filters,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"读取失败: {e}")
    return {
        "startRow": req.startRow,
        "endRow": req.endRow,
        "rowCount": row_count,
        "rows": rows,
        "sourceRows": source_rows,
    }


def _parse_skip_rows_query(s: str | None) -> list[list[int]]:
    """已废弃:/api/table/data 改 POST 后无调用方。保留以备 search 等端点需要 query 形式 skipRows。"""
    if not s:
        return []
    out: list[list[int]] = []
    for seg in s.split(","):
        seg = seg.strip()
        if not seg:
            continue
        if "-" in seg:
            parts = seg.split("-")
            if len(parts) != 2:
                continue
            try:
                a, b = int(parts[0]), int(parts[1])
            except ValueError:
                continue
            out.append([a, b])
        else:
            try:
                a = int(seg)
            except ValueError:
                continue
            out.append([a, a])
    return out


class ColumnValuesRequest(BaseModel):
    tableId: str
    column: str
    headerRow: int | None = None
    skipRows: list[list[int]] = []
    filters: dict[str, list[str]] | None = None  # 调用方应排除本列,使计数=按其他列筛选后的值计数
    search: str | None = None  # 大小写不敏感子串过滤(过滤后截断);None=不过滤


@app.post("/api/table/column-values")
def table_column_values(req: ColumnValuesRequest):
    """取某列去重值 + 每个值的重复数目(按数目降序)。

    范围:应用 headerRow/skipRows + filters(其他列)筛选后的可见行集合。filters 应排除本列,
    使本列已选值也能看到它的总数。列值统一按字符串处理。
    search:可选,大小写不敏感子串过滤(过滤后再截断 5000);None=不过滤维持原前 5000 逻辑。
    返回 {values: [{value, count}], truncated}。truncated=True 表示过滤后超过上限被截断。
    """
    try:
        values, truncated = table_io.column_unique(
            table_id=req.tableId,
            column=req.column,
            headerRow=req.headerRow,
            skipRows=req.skipRows,
            filters=req.filters,
            search=req.search,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"取列值失败: {e}")
    return {"values": values, "truncated": truncated}


# ───────────────────────── 模块1 表头/跳过配置 ─────────────────────────

class TableConfigRequest(BaseModel):
    path: str
    headerRow: int | None = None
    skipRows: list[list[int]] = []
    encoding: str | None = None  # 文件编码(仅 .tab/.txt/.tsv);null=自动探测


@app.get("/api/table/config")
def table_config_get(path: str = Query(..., description="文件绝对路径")):
    """返回该 path 的 {headerRow, skipRows, encoding}(无记录返回 {headerRow:null, skipRows:[], encoding:null})。"""
    cfg = table_config.load_config(path)
    return cfg


@app.post("/api/table/config")
def table_config_save(req: TableConfigRequest):
    """写入/更新 table-config.json 中该 path 的配置。"""
    table_config.save_config(req.path, req.headerRow, req.skipRows, req.encoding)
    return {"ok": True}


# ───────────────────────── 模块1 全表查找 ─────────────────────────

class TableSearchRequest(BaseModel):
    tableId: str
    query: str
    skipRows: list[list[int]] = []
    headerRow: int | None = None
    limit: int = Field(default=1000, ge=1, le=10000)


@app.post("/api/table/search")
def table_search(req: TableSearchRequest):
    """全表查找:扫缓存 Parquet 全表(所有列转字符串),子串匹配(大小写不敏感)。

    应用 skipRows(剔除)+ headerRow(剔除表头行)后,返回匹配行的有效行序号 + 命中列。
    limit 截断返回条数;total 为真实匹配数。
    """
    if not req.query:
        return {"matches": [], "total": 0}
    try:
        matches, total = table_io.search_table(
            table_id=req.tableId,
            query=req.query,
            skipRows=req.skipRows,
            headerRow=req.headerRow,
            limit=req.limit,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"查找失败: {e}")
    return {"matches": matches, "total": total}


# ───────────────────────── 模块1 SVN blame(可开关) ─────────────────────────

class BlameRequest(BaseModel):
    path: str
    revision: str = "BASE"
    lineNumbers: list[int] | None = None  # 可选:只返回指定行(按需触发)


@app.post("/api/vcs/blame")
async def vcs_blame(req: BlameRequest):
    """对文件执行 svn blame,返回行级元信息(lineNumber/revision/author/date)。

    - revision 默认 BASE(工作副本 pristine 版本)
    - lineNumbers 非空时只返回这些行(按需触发,但内部仍跑一次 blame 并缓存)
    - 结果按 (abspath, revision) 做 LRU 缓存,重复打开不重跑
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    try:
        if req.lineNumbers:
            rows = await svn_blame_mod.svn_blame_lines(
                req.path, req.lineNumbers, req.revision
            )
            return {"rows": list(rows.values()), "cached": False}
        rows = await svn_blame_mod.svn_blame(req.path, req.revision)
        return {"rows": rows, "cached": False}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/vcs/blame/clear")
def vcs_blame_clear(req: BlameRequest):
    """清空 blame 缓存(或只清某 path)。"""
    n = svn_blame_mod.clear_blame_cache(req.path if req.path else None)
    return {"cleared": n}


# ───────────────────────── 模块1 SVN log(提交详情弹窗) ─────────────────────────

class LogRequest(BaseModel):
    path: str
    revision: str  # 如 "12345" 或 "BASE"/"HEAD"


@app.post("/api/vcs/log")
async def vcs_log(req: LogRequest):
    """查询单个 revision 的提交详情(供前端提交详情弹窗)。

    后端执行 svn log --xml -v -r <revision> <path>,返回第一个 logentry 的
    revision/author/date/message/changedPaths。
    """
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {req.path}")
    try:
        result = await svn_blame_mod.svn_log(req.path, req.revision)
    except FileNotFoundError as e:
        # svn 不可用 → 400;无 logentry → 404。这里按 404 处理路径/版本不存在
        # svn 不可用的提示含"找不到 svn 可执行文件",归 400
        if "找不到 svn 可执行文件" in str(e):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ───────────────────────── 模块2 配置检查器 ─────────────────────────

class CheckerReportRequest(BaseModel):
    reportUrl: str
    ruleName: str | None = None  # 可选,精确匹配 rule_name;None/空=返回全部


@app.post("/api/checker/report")
async def checker_report(req: CheckerReportRequest):
    """配置检查器 · 第一层:取平台报告全量规则结果。

    入参 {reportUrl, ruleName?}:
    - reportUrl:平台报告链接(含 ?reportId=N),如 https://rulecheck.testplus.cn/project/JX3/summary?reportId=9322
    - ruleName:可选,精确匹配 rule_name 过滤;空/None 返回全部规则

    后端按当前环境(checker-config.json 的 env)选 MCP 端点(prod 10.11.66.70 / dev 10.11.82.207),
    调 MCP get_all_check_results_in_report(reportId) 拿全量 data[],后端本地按 ruleName 过滤,
    每条规则补规则详情(get_rule_by_rule_id 拿 ruleDesc + scriptPath)。

    返回 PRD 2.1 结构(每条规则含全字段 + ruleDesc + scriptPath):
    {
      "reportId": int, "appkey": str|null,
      "rules": [{rule_name, rule_id, module, owner, status, note, result:{error_count, content, run_time, first_detected_time, author, testLead, rule_assigness}, ruleDesc, scriptPath}]
    }
    """
    if not req.reportUrl.strip():
        raise HTTPException(status_code=400, detail="reportUrl 不能为空")
    try:
        result = await rulecheck_client.fetch_report(
            report_url=req.reportUrl,
            rule_name_filter=req.ruleName,
        )
    except ValueError as e:
        # 链接解析问题(reportId 缺失/非整数)
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # MCP 不可达 / 报告不存在 / MCP 返回异常
        raise HTTPException(status_code=502, detail=str(e))
    return result


# ───────────────────────── 模块2 全局设置 ─────────────────────────

class CheckerConfigRequest(BaseModel):
    env: str | None = None  # 'prod' / 'dev'
    # appkey + 分支 → 本地根路径映射(数组,复合键 appkey|branch 唯一)
    appkeyRoots: list[dict[str, str]] | None = None
    scriptLibRoot: str | None = None  # 全局脚本库根目录


@app.get("/api/checker/config")
def checker_config_get():
    """返回当前全局设置 {env, appkeyRoots, scriptLibRoot}。"""
    return checker_config.get_config()


@app.post("/api/checker/config")
def checker_config_save(req: CheckerConfigRequest):
    """更新全局设置(任意字段 None 表示不改动),落盘,返回新配置。"""
    try:
        return checker_config.set_config(
            env=req.env,
            appkey_roots=req.appkeyRoots,
            script_lib_root=req.scriptLibRoot,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/checker/projects")
async def checker_projects():
    """取所有项目信息(给全局设置 UI 选 appkey 用)。"""
    try:
        return {"projects": await rulecheck_client.get_project_infos()}
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/checker/builtin-branches")
def checker_builtin_branches(appkey: str | None = Query(default=None)):
    """返回内置 SVN 分支(后端写死,平台无此维度)。

    - 不带 appkey:返回全量 {appkey: [分支...]}。
    - 带 appkey:返回该 appkey 的分支列表(无内置则空数组,前端降级允许手填)。
    """
    return {"branches": checker_config.get_builtin_branches(appkey)}


@app.post("/api/checker/audit")
async def checker_audit_post(req: checker_audit.AuditRequest):
    """配置检查器 · 第三层审核:SSE 流。

    前端点【审核结果】时调用,返回 text/event-stream(queued/start/step/step_done/
    result/error)。阶段 1 mock 事件流(不接真 Claude),阶段 2 替换 _run_audit 内部。
    串行:同时只允许一个审核跑,第二个先收到 queued 事件排队。
    """
    return checker_audit.audit(req)


# ───────────────────────── 模块2 表格路径解析(截图 MCP 用) ─────────────────────────


class ResolveTablePathRequest(BaseModel):
    appkey: str
    table_path: str


@app.post("/api/checker/resolve-table-path")
def checker_resolve_table_path(req: ResolveTablePathRequest):
    """把 table_path(纯文件名或相对路径)按 appkey→根映射解析成绝对路径。

    PRD §3.1:errorObj 的 table_path 可能纯文件名(RecipeBelong.txt)或带相对路径,
    前端 ScreenshotGrid 的 open_table 用此端点解析后调 /api/table/open。
    匹配逻辑:在 appkey 对应的根路径下 glob 递归搜同名文件。
    命中唯一→返回解析后的绝对路径;命中多个→返回第一匹配(并记日志);零命中→404。
    """
    import glob as _glob
    from pathlib import Path as _Path

    root = checker_config.get_appkey_root(req.appkey)
    if not root:
        raise HTTPException(status_code=400, detail=f"appkey '{req.appkey}' 未配置工作区根路径,请在全局设置里添加映射")
    tp = req.table_path.strip()
    if not tp:
        raise HTTPException(status_code=400, detail="table_path 为空")
    root_path = _Path(root)
    if not root_path.is_dir():
        raise HTTPException(status_code=400, detail=f"工作区根路径不存在: {root}")

    # 如果 table_path 本身已是绝对路径且存在,直接返回
    abs_candidate = _Path(tp)
    if abs_candidate.is_absolute() and abs_candidate.is_file():
        return {"resolved": str(abs_candidate)}

    # 在根下用 **/<filename> 递归搜
    pattern = str(root_path / "**" / _Path(tp).name)
    matches = _glob.glob(pattern, recursive=True)
    if not matches:
        raise HTTPException(status_code=404, detail=f"在 {root} 下找不到 {tp} (搜了 {_Path(tp).name})")
    if len(matches) > 1:
        log_msg = f"table_path 命中多个: {tp} → {matches[:5]} (取第一个)"
        app_logger = logging.getLogger("checker_resolve_table_path")
        app_logger.warning(log_msg)
    return {"resolved": matches[0]}


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def write_port_file(port: int) -> None:
    with open(PORT_FILE, "w", encoding="utf-8") as f:
        f.write(str(port))


if __name__ == "__main__":
    port = get_free_port()
    write_port_file(port)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
