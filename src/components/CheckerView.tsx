import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Modal, Tooltip } from "antd";
import {
  LinkOutlined,
  ThunderboltOutlined,
  SnippetsOutlined,
  SearchOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import {
  useCheckerStore,
  PROJECT_COLORS,
  PROJECT_COLORS_LIGHT,
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
 * 多报告标签页(PRD §12.2 决策36):单行报告标签 —— 每个标签 = 项目前缀 + 报告ID + 分支别名,
 * 项目归属靠标签项目前缀 + 项目色双重标识(无独立项目统计行)。
 * 每个报告标签状态独立(拉取结果/展开/审核缓存),切换不丢。
 *
 * 第一层:输入报告链接(+ 可选规则名)→ 点【拉取结果】→ 后端调 rulecheck MCP 取全量规则结果
 *       → 该报告成为一个标签。列表只展示不通过 + 异常规则(status !== 'success')。
 *       汇总栏按 status 三分;每行:状态标签 + 规则名 + 错误数 chip,整行点击打开详情弹窗。
 *       搜索框(结果区顶部):前端本地即时过滤(debounce 200ms),全字段聚合,
 *       纯数字额外做 error_count 精确匹配。
 *       分支识别(PRD §12.1):报告标签旁显示 branch_alia。
 * 第二层:大弹窗显示规则元信息 + errorObj 列表 / 异常堆栈。
 */
export default function CheckerView({ backendUrl }: CheckerViewProps) {
  const activeReportId = useCheckerStore((s) => s.activeReportId);
  const tabs = useCheckerStore((s) => s.tabs);
  const reportUrlInput = useCheckerStore((s) => s.reportUrlInput);
  const ruleNameInput = useCheckerStore((s) => s.ruleNameInput);
  const setReportUrlInput = useCheckerStore((s) => s.setReportUrlInput);
  const setRuleNameInput = useCheckerStore((s) => s.setRuleNameInput);
  const fetchReport = useCheckerStore((s) => s.fetchReport);
  const setActiveReport = useCheckerStore((s) => s.setActiveReport);
  const refetchReport = useCheckerStore((s) => s.refetchReport);
  const closeReport = useCheckerStore((s) => s.closeReport);
  const getProjectColorIndex = useCheckerStore((s) => s.getProjectColorIndex);

  // 激活标签(可能 null=还没拉任何报告)。
  const activeTab = activeReportId != null ? tabs[activeReportId] ?? null : null;

  // 当前打开详情弹窗的规则(null=弹窗关闭)。
  const [openedRule, setOpenedRule] = useState<RuleSummary | null>(null);

  // 结果区搜索框(PRD §1.1):searchInput 即时输入,searchQuery debounce 后实际过滤。
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput), 200);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // 切换标签时清搜索。
  useEffect(() => {
    setSearchInput("");
    setSearchQuery("");
  }, [activeReportId]);

  // 当前环境徽标(prod/dev)。
  const [envBadge, setEnvBadge] = useState<"prod" | "dev" | null>(null);
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

  const rules = activeTab?.rules ?? [];
  const reportId = activeTab?.reportId ?? null;
  const appkey = activeTab?.appkey ?? null;
  const loading = activeTab?.loading ?? false;
  const error = activeTab?.error ?? null;
  const branchAlia = activeTab?.branchAlia ?? null;
  // 分支显示:优先别名(平台配了显示别名如"正式分支"),为空回退完整分支路径
  // (如 branches-rel/b_MechaWar_release——机甲等项目的 branch_alia 常为空)。
  const branchDisplay = (branchAlia || activeTab?.branch) ?? null;

  // 列表展示不通过 + 异常规则。
  const failRules = rules.filter((r) => r.status !== "success");
  const failCount = rules.filter((r) => r.status === "fail").length;
  const exceptionCount = rules.filter((r) => r.status === "exception").length;
  const passCount = rules.filter((r) => r.status === "success").length;

  // 搜索过滤。
  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return failRules;
    const numeric = /^\d+$/.test(q) ? Number(q) : null;
    return failRules.filter((r) => {
      const haystack = [
        r.rule_name,
        r.owner,
        r.ruleDesc,
        ...(r.module ?? []),
        ...(r.result.testLead ?? []).map((t) =>
          String((t as { name?: string; email?: string })?.name ?? t),
        ),
      ]
        .filter((s): s is string => typeof s === "string")
        .join("\n")
        .toLowerCase();
      if (haystack.includes(q)) return true;
      if (numeric !== null && r.result.error_count === numeric) return true;
      return false;
    });
  }, [failRules, searchQuery]);
  const hitCount = filteredRules.length;

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
      {/* 顶部小标题栏(44px):左标题 + 环境徽标 */}
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
          value={reportUrlInput}
          onChange={(e) => setReportUrlInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="平台报告链接(含 ?reportId=N)"
          prefix={<LinkOutlined style={{ color: "var(--text-dim)" }} />}
          suffix={<PasteButton onPaste={setReportUrlInput} />}
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
          value={ruleNameInput}
          onChange={(e) => setRuleNameInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="规则名(可选,精确匹配)"
          suffix={<PasteButton onPaste={setRuleNameInput} />}
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

      {/* 单行报告标签(PRD §12.2 决策36):标签 = 项目前缀 + 报告ID + 分支别名 + 项目色。
          不再有独立项目统计行,项目归属靠标签项目前缀 + 项目色双重标识。 */}
      {Object.keys(tabs).length > 0 && (
        <div
          style={{
            flex: "0 0 auto",
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            padding: "6px 12px",
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {Object.entries(tabs)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([id, t]) => {
              const isActive = Number(id) === activeReportId;
              const isError = Number(id) === -1;
              const project = t.appkey ?? "";
              const idx = getProjectColorIndex(project);
              const pc = projectColor(project, idx);
              // 边框/文字/底色:选中=项目色实底深字;未选中=项目色文字 + 12%透明底
              const borderC = isError
                ? "var(--danger)"
                : isActive
                  ? pc?.hex ?? "var(--accent)"
                  : pc?.hex ?? "var(--border-strong)";
              const textC = isError
                ? "var(--danger)"
                : isActive
                  ? pc?.activeText ?? "#0e1113"
                  : pc?.hex ?? "var(--text)";
              const bgC = isActive
                ? pc?.hex ?? "var(--accent)"
                : pc?.tint ?? "transparent";
              return (
                <span
                  key={id}
                  onClick={() => {
                    // 恢复的标签(rules 空)→ 点它重新拉取
                    if (t.rules.length === 0 && !isError) {
                      void refetchReport(Number(id), backendUrl);
                    } else {
                      setActiveReport(Number(id));
                    }
                  }}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    cursor: "pointer",
                    color: textC,
                    background: bgC,
                    border: `1px solid ${borderC}`,
                    borderRadius: 3,
                    padding: "1px 8px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {isError ? (
                    "无 reportId"
                  ) : (
                    <>
                      {/* 项目前缀 + 报告 ID + 分支别名(PRD 决策42) */}
                      <span>{t.appkey ? `${t.appkey} · ` : ""}#{id}</span>
                      {(t.branchAlia || t.branch) && (
                        <span style={{ opacity: 0.7, marginLeft: 2 }}>
                          ({t.branchAlia || t.branch})
                        </span>
                      )}
                    </>
                  )}
                  <CloseOutlined
                    onClick={(e) => {
                      e.stopPropagation();
                      closeReport(Number(id));
                    }}
                    style={{ fontSize: 9, opacity: 0.6 }}
                  />
                </span>
              );
            })}
        </div>
      )}

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
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {error}
          </span>
          <button
            onClick={() => closeReport(activeReportId!)}
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
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {!activeTab ? (
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
        ) : rules.length === 0 && !loading && !error ? (
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
            {/* 汇总统计栏 */}
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
              {branchDisplay && <span>分支 {branchDisplay}</span>}
              <span>共 {rules.length} 条规则</span>
              <span style={{ color: "var(--danger)" }}>不通过 {failCount}</span>
              <span style={{ color: "var(--warn)" }}>异常 {exceptionCount}</span>
              <span style={{ color: "var(--accent)" }}>通过 {passCount}</span>
            </div>

            {/* 搜索框 */}
            <div
              style={{
                padding: "8px 12px",
                display: "flex",
                gap: 8,
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索规则(名称/模块/负责人/描述;纯数字按错误数)"
                allowClear
                prefix={<SearchOutlined style={{ color: "var(--text-dim)" }} />}
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
              <span
                style={{
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  flex: "0 0 auto",
                }}
              >
                命中{" "}
                <span
                  style={{ color: searchQuery.trim() ? "var(--accent)" : "var(--text-muted)" }}
                >
                  {hitCount}
                </span>{" "}
                / {failRules.length}
              </span>
            </div>

            {filteredRules.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                无匹配规则
              </div>
            ) : (
              filteredRules.map((r) => (
                <RuleRow key={r.rule_id} rule={r} onOpen={() => setOpenedRule(r)} />
              ))
            )}
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

/** 项目颜色分组:取某 appkey 的项目色 + 12% 透明底色(PRD §12.2)。
 *  色号=首见顺序(store 分配),超 8 循环灰;无项目(appkey 空)→ 返回 null(用默认色)。
 *  按主题选色板:dark 用暗饱和色(深底亮显),light 用加深色(浅底可读)。
 *  选中态实底文字色 light 用白、dark 用深石墨 #0e1113(由调用方取 pc.activeText)。 */
function projectColor(appkey: string | null, index: number): { hex: string; tint: string; activeText: string } | null {
  if (!appkey || index < 0) return null;
  const palette = isLightTheme() ? PROJECT_COLORS_LIGHT : PROJECT_COLORS;
  const hex = palette[index % palette.length];
  // 12% 透明底:hex → rgba(hex, 0.12),同 --accent-soft 手法
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { hex, tint: `rgba(${r},${g},${b},0.12)`, activeText: isLightTheme() ? "#ffffff" : "#0e1113" };
}

/** 是否 light 主题:<html data-theme="light">(theme.css 据此切 CSS 变量)。默认 dark。 */
function isLightTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "light";
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

/** 规则详情大弹窗(第二层)。 */
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

/** 弹窗主体:元信息 + errorObj 列表 + 异常堆栈。 */
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

  // 规则详情懒加载(PRD §5 2026-08 改稿):弹窗打开时实时拉 rule-detail,
  // 描述区 loading→展示;失败提示+重试,不阻断弹窗(errorObj 列表照常显示)。
  const appkey = useCheckerStore(
    (s) => (s.activeReportId != null ? s.tabs[s.activeReportId]?.appkey ?? null : null),
  );
  const [detail, setDetail] = useState<{ ruleDesc: string; scriptPath: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!appkey) {
      setDetailLoading(false);
      setDetailError("无 appkey,无法加载规则详情");
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    const base = backendUrl.replace(/\/$/, "");
    try {
      const resp = await fetch(
        `${base}/api/checker/rule-detail?appkey=${encodeURIComponent(appkey)}&ruleId=${rule.rule_id}`,
      );
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${t ? ` ${t}` : ""}`);
      }
      const d = (await resp.json()) as { ruleDesc: string; scriptPath: string };
      setDetail(d);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, [appkey, backendUrl, rule.rule_id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <RuleMeta rule={rule} detail={detail} detailLoading={detailLoading} detailError={detailError} onRetry={loadDetail} />

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
              maxHeight: "45vh",
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

/** 规则元信息。detail 为懒加载的规则详情(PRD §5),覆盖 rule 里为空的 ruleDesc/scriptPath。 */
function RuleMeta({
  rule,
  detail,
  detailLoading,
  detailError,
  onRetry,
}: {
  rule: RuleSummary;
  detail: { ruleDesc: string; scriptPath: string } | null;
  detailLoading: boolean;
  detailError: string | null;
  onRetry: () => void;
}) {
  const { run_time, first_detected_time, rule_assigness } = rule.result;
  const assigneeNames = rule_assigness.map((a) => a.name || a.email).join(", ");
  const scriptPath = detail?.scriptPath ?? rule.scriptPath;
  const ruleDesc = detail?.ruleDesc ?? rule.ruleDesc;
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
      <MetaItem label="脚本路径" value={scriptPath || "无"} />

      {/* 规则描述:懒加载区(PRD §5)。loading → 展示;失败提示+重试,不阻断弹窗。 */}
      <div style={{ flex: "1 1 100%" }}>
        {detailLoading ? (
          <span style={{ color: "var(--text-dim)" }}>规则详情加载中…</span>
        ) : detailError ? (
          <span style={{ color: "var(--danger)" }}>
            规则详情加载失败:{detailError}{" "}
            <button
              onClick={onRetry}
              style={{
                background: "transparent",
                border: "1px solid var(--border-strong)",
                color: "var(--warn)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "0 6px",
                borderRadius: 3,
              }}
            >
              重试
            </button>
          </span>
        ) : ruleDesc ? (
          <div
            style={{
              color: "var(--text-dim)",
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
            {ruleDesc}
          </div>
        ) : (
          <span style={{ color: "var(--text-dim)" }}>无规则描述</span>
        )}
      </div>
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

/** 单个表的 errorObj 组。 */
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

/** 单条 errorObj 行(第三层【开始审核】按钮 + 行内审核面板)。 */
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
      {expanded && <AuditPanel errorObj={err} rule={rule} backendUrl={backendUrl} />}
    </div>
  );
}

/** 剪切板粘贴按钮。 */
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
    timerRef.current = window.setTimeout(() => setTip("粘贴剪切板首行"), 1500);
  };

  const handleClick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        flashTip("剪切板为空");
        return;
      }
      const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
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
