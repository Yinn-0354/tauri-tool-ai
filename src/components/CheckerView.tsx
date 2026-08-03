import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Tooltip } from "antd";
import {
  LinkOutlined,
  ThunderboltOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import {
  useCheckerStore,
  type RuleSummary,
  type ErrorObj,
} from "../store/checkerStore";
import { useNavStore } from "../store/navStore";
import AuditPanel from "./AuditPanel";

interface CheckerViewProps {
  /** sidecar 基址(非空,由 App.tsx 保证)。 */
  backendUrl: string;
}

/**
 * 配置检查器视图(第一层:汇总 + 第二层:详情弹窗)。
 *
 * 形态:独立全屏视图(占主区),与表格视图互斥切换。
 * 第一层:输入报告链接(+ 可选规则名)→ 点【拉取结果】→ 后端调 rulecheck MCP 取全量规则结果
 *       → 列表只展示不通过 + 异常规则(status !== 'success'),通过规则不进列表。
 *       汇总栏按 status 三分:不通过(fail) / 异常(exception) / 通过(success),口径与列表一致。
 *       每行:状态标签(失败=红 / 异常=黄) + 规则名 + 错误数 chip(仅 fail 规则),整行点击打开详情弹窗。
 * 第二层:大弹窗显示规则元信息 + errorObj 列表(fail 规则,按表分组) / 异常堆栈(exception 规则,note.message)。
 *
 * - 规则名可选:填了精确匹配返回对应规则;不填返回全部(再前端过滤出不通过/异常)。
 * - status 字段权威:success=通过 / fail=不通过(有 errorObj) / exception=异常(脚本崩溃,note.message 存堆栈)。
 *
 * 后续:
 * - 第三层:errorObj 行【开始审核】按钮 → 展开即自动审核(有缓存直接显示),行内进度流水 + 口语对话 + 截图,结果本地缓存(关闭应用清)。
 *
 * 布局铁律对齐 App.tsx:根容器 100% 高 + overflow:hidden,仅结果区内滚动。
 */
export default function CheckerView({ backendUrl }: CheckerViewProps) {
  const reportUrl = useCheckerStore((s) => s.reportUrl);
  const ruleName = useCheckerStore((s) => s.ruleName);
  const rules = useCheckerStore((s) => s.rules);
  const reportId = useCheckerStore((s) => s.reportId);
  const appkey = useCheckerStore((s) => s.appkey);
  const loading = useCheckerStore((s) => s.loading);
  const error = useCheckerStore((s) => s.error);
  const setReportUrl = useCheckerStore((s) => s.setReportUrl);
  const setRuleName = useCheckerStore((s) => s.setRuleName);
  const fetchReport = useCheckerStore((s) => s.fetchReport);

  // 当前打开详情弹窗的规则(null=弹窗关闭)。
  const [openedRule, setOpenedRule] = useState<RuleSummary | null>(null);

  // 当前环境徽标(prod/dev),挂载时拉取显示(设置入口已挪到 Sidebar 左下角齿轮)。
  const [envBadge, setEnvBadge] = useState<"prod" | "dev" | null>(null);
  // 环境变更版本号:设置弹窗保存后自增,触发重拉徽标。
  const envVersion = useNavStore((s) => s.envVersion);

  const refreshEnvBadge = () => {
    if (!backendUrl) return;
    const base = backendUrl.replace(/\/$/, "");
    fetch(`${base}/api/checker/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && (cfg.env === "prod" || cfg.env === "dev")) {
          setEnvBadge(cfg.env);
        }
      })
      .catch(() => {
        // 静默:徽标非关键,失败时不显示。
      });
  };

  useEffect(() => {
    refreshEnvBadge();
  }, [backendUrl, envVersion]);

  const onFetch = () => {
    void fetchReport(backendUrl);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onFetch();
    }
  };

  // 列表展示不通过 + 异常规则(status !== 'success')。通过规则不进列表。
  // 按 status 三分:fail=不通过 / exception=异常 / success=通过,汇总栏同口径。
  const failRules = rules.filter((r) => r.status !== "success");
  const failCount = rules.filter((r) => r.status === "fail").length;
  const exceptionCount = rules.filter((r) => r.status === "exception").length;
  const passCount = rules.filter((r) => r.status === "success").length;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* 顶部小标题栏(44px,对齐 Toolbar 高度):左标题 + 环境徽标 */}
      <div
        style={{
          height: 44,
          flex: "0 0 44px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            fontSize: 12,
            letterSpacing: ".04em",
          }}
        >
          CONFIG CHECKER
        </span>

        {/* 环境徽标:显示当前后端连的 MCP 环境(设置入口在左下角齿轮) */}
        {envBadge && (
          <Tooltip title={`当前环境:${envBadge === "prod" ? "正式" : "开发"}(左下角齿轮改)`}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: envBadge === "prod" ? "var(--accent)" : "var(--warn)",
                border: `1px solid ${envBadge === "prod" ? "var(--accent)" : "var(--warn)"}`,
                borderRadius: 3,
                padding: "1px 6px",
              }}
            >
              {envBadge}
            </span>
          </Tooltip>
        )}
      </div>

      {/* 输入区 */}
      <div
        style={{
          flex: "0 0 auto",
          padding: 12,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "var(--bg-panel)",
        }}
      >
        <Input
          value={reportUrl}
          onChange={(e) => setReportUrl(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="平台报告链接(含 ?reportId=N)"
          prefix={<LinkOutlined style={{ color: "var(--text-dim)" }} />}
          suffix={<PasteButton onPaste={setReportUrl} />}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            background: "var(--bg)",
            borderColor: "var(--border-strong)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        />
        <Input
          value={ruleName}
          onChange={(e) => setRuleName(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="规则名(可选,精确匹配)"
          suffix={<PasteButton onPaste={setRuleName} />}
          style={{
            flex: "0 0 220px",
            background: "var(--bg)",
            borderColor: "var(--border-strong)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        />
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={loading}
          onClick={onFetch}
          style={{
            flex: "0 0 auto",
            background: "var(--accent)",
            borderColor: "var(--accent)",
            color: "#0e1113",
            fontWeight: 500,
          }}
        >
          拉取结果
        </Button>
      </div>

      {/* error 横幅 */}
      {error && (
        <div
          style={{
            flex: "0 0 auto",
            background: "rgba(255,107,107,.12)",
            color: "var(--danger)",
            borderBottom: "1px solid var(--border)",
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {error}
          </span>
          <button
            onClick={() => useCheckerStore.setState({ error: null })}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--danger)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            关闭
          </button>
        </div>
      )}

      {/* 结果区:仅此区滚动 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {rules.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {loading
              ? "拉取中…"
              : '填写报告链接后点"拉取结果"(规则名可选,不填返回全部规则)'}
          </div>
        ) : failRules.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: "var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            全部规则通过,无不通过/异常规则
          </div>
        ) : (
          <>
            {/* 汇总统计栏:按 status 三分(不通过/异常/通过),口径与列表一致 */}
            <div
              style={{
                padding: "8px 12px",
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                background: "var(--bg-panel)",
              }}
            >
              <span>
                报告 <span style={{ color: "var(--accent)" }}>#{reportId}</span>
              </span>
              {appkey && <span>项目 {appkey}</span>}
              <span>共 {rules.length} 条规则</span>
              <span style={{ color: "var(--danger)" }}>
                不通过 {failCount}
              </span>
              <span style={{ color: "var(--warn)" }}>
                异常 {exceptionCount}
              </span>
              <span style={{ color: "var(--accent)" }}>通过 {passCount}</span>
            </div>
            {failRules.map((r) => (
              <RuleRow
                key={r.rule_id}
                rule={r}
                onOpen={() => setOpenedRule(r)}
              />
            ))}
          </>
        )}
      </div>

      {/* 规则详情大弹窗(第二层) */}
      <RuleDetailModal
        rule={openedRule}
        backendUrl={backendUrl}
        onClose={() => setOpenedRule(null)}
      />
    </div>
  );
}

/** 列表里的不通过/异常规则行。整行点击打开详情弹窗。 */
function RuleRow({ rule, onOpen }: { rule: RuleSummary; onOpen: () => void }) {
  const errorCount = rule.result.error_count;
  const isException = rule.status === "exception";
  const statusColor = isException ? "var(--warn)" : "var(--danger)";
  const statusText = isException ? "异常" : "失败";

  return (
    <div
      onClick={onOpen}
      style={{
        padding: "10px 12px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        cursor: "pointer",
        borderBottom: "1px solid var(--border)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* 状态标签:失败=红 / 异常=黄 */}
      <span
        style={{
          color: statusColor,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          flex: "0 0 auto",
          padding: "1px 6px",
          border: `1px solid ${statusColor}`,
          borderRadius: 3,
        }}
      >
        {statusText}
      </span>

      {/* 规则名 */}
      <span
        style={{
          color: "var(--text)",
          fontSize: 13,
          flex: "1 1 auto",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
        title={rule.rule_name}
      >
        {rule.rule_name}
      </span>

      {/* 错误数 chip:仅 fail 规则(ec>0)显示;异常规则 ec=0 不显示(状态标签已表明) */}
      {errorCount > 0 && (
        <span
          style={{
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            flex: "0 0 auto",
            padding: "1px 6px",
            background: "rgba(255,107,107,.12)",
            borderRadius: 3,
          }}
        >
          {errorCount} 错误
        </span>
      )}

      {/* 点击提示 */}
      <span
        style={{
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          flex: "0 0 auto",
        }}
      >
        点击查看详情
      </span>
    </div>
  );
}

/** 规则详情大弹窗(第二层):规则元信息 + errorObj 列表。rule=null 时关闭。 */
function RuleDetailModal({
  rule,
  backendUrl,
  onClose,
}: {
  rule: RuleSummary | null;
  backendUrl: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!rule}
      onCancel={onClose}
      footer={null}
      width="80vw"
      destroyOnClose
      title={rule ? rule.rule_name : null}
      className="tt-modal"
      styles={{ body: { maxHeight: "72vh", overflow: "auto" } }}
    >
      {rule && <RuleDetailBody rule={rule} backendUrl={backendUrl} />}
    </Modal>
  );
}

/** 弹窗主体:元信息 + errorObj 列表 + 异常堆栈(异常规则)。 */
function RuleDetailBody({
  rule,
  backendUrl,
}: {
  rule: RuleSummary;
  backendUrl: string;
}) {
  const totalErrs = Object.values(rule.result.content).reduce(
    (sum, arr) => sum + (arr?.length ?? 0),
    0,
  );
  const isException = rule.status === "exception";
  const traceback = isException ? rule.note?.message || "" : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 规则元信息 */}
      <RuleMeta rule={rule} />

      {/* errorObj 列表(按表分组);仅 fail 规则有,异常规则 content 为空跳过 */}
      {totalErrs > 0 && (
        <div>
          <div
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginBottom: 6,
            }}
          >
            errorObj({totalErrs} 条):
          </div>
          {Object.entries(rule.result.content).map(([table, errs]) => (
            <ErrorObjGroup
              key={table}
              table={table}
              errs={errs}
              rule={rule}
              backendUrl={backendUrl}
            />
          ))}
        </div>
      )}

      {/* 异常堆栈:仅 exception 规则显示(note.message 是完整 Python traceback) */}
      {traceback && (
        <div>
          <div
            style={{
              color: "var(--warn)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginBottom: 6,
            }}
          >
            异常堆栈(规则执行崩溃):
          </div>
          <pre
            style={{
              margin: 0,
              padding: 10,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderLeft: "2px solid var(--warn)",
              borderRadius: 3,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {traceback}
          </pre>
        </div>
      )}
    </div>
  );
}

/** 规则元信息(弹窗内显示规则详情字段)。 */
function RuleMeta({ rule }: { rule: RuleSummary }) {
  const { run_time, first_detected_time, rule_assigness } = rule.result;
  const assigneeNames = rule_assigness.map((a) => a.name || a.email).join(", ");
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-muted)",
      }}
    >
      <MetaItem label="模块" value={rule.module.join(", ") || "无"} />
      <MetaItem label="创建人" value={rule.owner || "暂无"} />
      <MetaItem label="测试负责人" value={assigneeNames || "无"} />
      <MetaItem label="执行时间" value={run_time ? `${run_time}s` : "-"} />
      <MetaItem label="首次报错" value={first_detected_time || "-"} />
      <MetaItem label="脚本路径" value={rule.scriptPath || "无"} />
      {rule.ruleDesc && (
        <div
          style={{
            flex: "1 1 100%",
            color: "var(--text-dim)",
            marginTop: 4,
            whiteSpace: "pre-wrap",
            maxHeight: 120,
            overflow: "auto",
            padding: 6,
            background: "var(--bg-panel)",
            borderRadius: 3,
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>规则描述:</span>
          {"\n"}
          {rule.ruleDesc}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ flex: "0 0 auto" }}>
      <span style={{ color: "var(--text-dim)" }}>{label}:</span>{" "}
      <span>{value}</span>
    </span>
  );
}

/** 单个表的 errorObj 组(弹窗内第二层 errorObj 列表)。 */
function ErrorObjGroup({
  table,
  errs,
  rule,
  backendUrl,
}: {
  table: string;
  errs: ErrorObj[];
  rule: RuleSummary;
  backendUrl: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          color: "var(--accent)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        {table}({errs.length} 条)
      </div>
      {errs.map((e, i) => (
        <ErrorObjRow key={i} err={e} rule={rule} backendUrl={backendUrl} />
      ))}
    </div>
  );
}

/** 单条 errorObj 行(弹窗内;第三层【开始审核】按钮 + 行内审核面板)。 */
function ErrorObjRow({
  err,
  rule,
  backendUrl,
}: {
  err: ErrorObj;
  rule: RuleSummary;
  backendUrl: string;
}) {
  const rowDisplay = err.rowID.join(",");
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        padding: "6px 8px",
        marginBottom: 4,
        background: "var(--bg-panel)",
        borderRadius: 3,
        borderLeft: "2px solid var(--danger)",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 4,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {err.name && (
          <span
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            列:{err.name}
          </span>
        )}
        <span
          style={{
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          行:{rowDisplay}
        </span>
        {/* 开始审核:点击展开并自动开始审核(有缓存直接显示结果),展开后可收起 */}
        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          style={{
            color: expanded ? "var(--accent)" : "var(--text-muted)",
            borderColor: expanded ? "var(--accent-dim)" : "var(--border)",
            background: expanded ? "var(--accent-soft)" : "transparent",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            marginLeft: "auto",
            flex: "0 0 auto",
          }}
        >
          {expanded ? "收起" : "开始审核"}
        </Button>
      </div>
      <div
        style={{
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.5,
        }}
      >
        {err.value}
      </div>
      {/* 行内审核面板:展开时挂载,卸载时 AuditPanel 自身 abort 在途 SSE */}
      {expanded && (
        <AuditPanel errorObj={err} rule={rule} backendUrl={backendUrl} />
      )}
    </div>
  );
}

/** 剪切板粘贴按钮:作为 Input suffix,点击读取剪切板首行非空文本注入输入框。 */
function PasteButton({ onPaste }: { onPaste: (text: string) => void }) {
  const [tip, setTip] = useState<string>("粘贴剪切板首行");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const flashTip = (msg: string) => {
    setTip(msg);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => setTip("粘贴剪切板首行"),
      1500,
    );
  };

  const handleClick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        flashTip("剪切板为空");
        return;
      }
      const firstLine =
        text.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
      if (!firstLine) {
        flashTip("剪切板无非空行");
        return;
      }
      onPaste(firstLine);
      flashTip("已粘贴 ✓");
    } catch {
      flashTip("读取剪切板失败(未授权?)");
    }
  };

  return (
    <Tooltip title={tip} mouseEnterDelay={0.4}>
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-dim)";
        }}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          fontSize: 13,
        }}
      >
        <SnippetsOutlined />
      </button>
    </Tooltip>
  );
}
