import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import { CheckCircleFilled, LoadingOutlined } from "@ant-design/icons";
import {
  useCheckerStore,
  type ErrorObj,
  type RuleSummary,
} from "../store/checkerStore";

/**
 * 审核面板(第三层,阶段 1 MVP)。
 *
 * 嵌在 ErrorObjRow 行内,外层【开始审核】点击展开即挂载本面板:
 * - 有本地缓存(sessionStorage)→ 直接还原上次审核结果,不重新审核;
 * - 无缓存 → 自动开始审核:fetch POST /api/checker/audit(SSE)→ 边读边解析 →
 *   渲染 6 步进度 + 结论 + 截图位,完成后写缓存。
 *
 * 阶段 1 后端返回 mock 事件流(不接真 Claude),screenshot 恒 null。
 * 阶段 2/3 后端接真 Claude + 截图 MCP,本组件不改(协议不变)。
 *
 * 缓存语义:sessionStorage key=audit-result:<desc_hash>,运行期间再次展开直接显示,
 * 关闭应用时 WebView 销毁 sessionStorage 自动清(满足"关闭应用时才会删除")。
 * "重新审核"清该条缓存后重新发起。
 *
 * 串行由后端全局锁保证:同时只跑一个审核;第二个面板先收到 queued 事件显示排队。
 * 卸载/收起 → AbortController.abort(),防后端空跑 + 防泄漏。
 */
interface AuditPanelProps {
  errorObj: ErrorObj;
  rule: RuleSummary;
  backendUrl: string;
}

/** 工具名 → 中文短标签(动态步渲染用)。真审核的工具名由后端 step 事件带来,
 * 阶段 2.1 主要是 read_check_script;阶段 2.2 加截图 MCP 7 工具。未命中表则原样显示工具名。 */
const STEP_LABELS: Record<string, string> = {
  "mcp__script__read_check_script": "读脚本",
  "mcp__screenshot__open_table": "开表",
  "mcp__screenshot__get_columns": "读列",
  "mcp__screenshot__search_cell": "搜索",
  "mcp__screenshot__freeze_column": "冻结ID列",
  "mcp__screenshot__goto_cell": "跳转",
  "mcp__screenshot__get_viewport_info": "核验",
  "mcp__screenshot__screenshot": "截图",
};

type StepStatus = "pending" | "running" | "done";
interface AuditStep {
  tool: string;
  status: StepStatus;
}

type Phase = "idle" | "queued" | "running" | "done" | "error";

// ───────────────────────── 审核结果本地缓存 ─────────────────────────
// sessionStorage:运行期间保留,关闭应用时 WebView 销毁自动清(满足"关闭应用时才会删除")。
// key = audit-result:<desc_hash>(desc_hash 是 errorObj 去重哈希,唯一标识一条错误)。
// 截图 base64 可能很大,写时 try/catch:超限降级只存文本不存截图,再失败放弃缓存。

const CACHE_PREFIX = "audit-result:";

interface CachedAudit {
  conclusion: string | null;
  screenshot: string | null;
  screenshotReason: string | null;
  steps: AuditStep[];
}

function readAuditCache(descHash: string): CachedAudit | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${descHash}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as CachedAudit;
    if (!data || !Array.isArray(data.steps)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeAuditCache(descHash: string, data: CachedAudit): void {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${descHash}`, JSON.stringify(data));
  } catch {
    // 超限(截图 base64 太大)降级:只存文本不存截图。
    try {
      sessionStorage.setItem(
        `${CACHE_PREFIX}${descHash}`,
        JSON.stringify({ ...data, screenshot: null }),
      );
    } catch {
      // 仍失败:放弃缓存,不影响审核本身。
    }
  }
}

function clearAuditCache(descHash: string): void {
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${descHash}`);
  } catch {
    // 静默
  }
}

/** 组装审核请求体(PRD §7:errorObj 5 字段 + rule 6 字段 + ruleDesc + scriptPath + appkey)。 */
function buildAuditPayload(errorObj: ErrorObj, rule: RuleSummary, appkey: string | null) {
  return {
    errorObj: {
      table_path: errorObj.table_path,
      rowID: errorObj.rowID,
      name: errorObj.name,
      value: errorObj.value,
      desc_hash: errorObj.desc_hash,
    },
    rule: {
      rule_name: rule.rule_name,
      rule_id: rule.rule_id,
      module: rule.module,
      owner: rule.owner,
      note: rule.note,
      status: rule.status,
    },
    ruleDesc: rule.ruleDesc,
    scriptPath: rule.scriptPath,
    appkey,
  };
}

/** 解析一个 SSE 帧(多行文本)为 {event, data}。帧内行以 `event:`/`data:` 开头。 */
function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export default function AuditPanel({ errorObj, rule, backendUrl }: AuditPanelProps) {
  const appkey = useCheckerStore((s) => s.appkey);
  const [phase, setPhase] = useState<Phase>("idle");
  // 动态步:从后端 step 事件累积,真实反映 Claude 调了哪些工具(阶段 2.1 可能只有读脚本,
  // 阶段 2.2 是开表/冻结/跳转/核验/截图)。空数组=还没收到任何 step(result 到达时若仍空,
  // 说明 Claude 未调工具直接出对话,也属正常)。
  const [steps, setSteps] = useState<AuditStep[]>([]);
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotReason, setScreenshotReason] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // steps 最新值 ref:result 缓存里要读当前已累积的 steps,但 handleEvent 闭包里读 state 是旧值,
  // 用 ref 拿最新(随 steps state 同步更新)。
  const stepsRef = useRef<AuditStep[]>([]);
  stepsRef.current = steps;

  const start = async () => {
    const base = backendUrl.replace(/\/$/, "");
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("queued"); // 先 queued,收到 start 转 running
    setSteps([]); // 动态步:每次审核从空开始,由 step 事件累积
    setConclusion(null);
    setScreenshot(null);
    setScreenshotReason(null);
    setErrorMsg(null);
    setPosition(null);

    try {
      const resp = await fetch(`${base}/api/checker/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(buildAuditPayload(errorObj, rule, appkey)),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${t ? `: ${t}` : ""}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("响应无 body 流");
      const decoder = new TextDecoder();
      let buffer = "";
      // 逐块读、按 \n\n 分帧、解析 event/data、更新状态。
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseFrame(frame);
          if (!parsed) continue;
          handleEvent(parsed.event, parsed.data as Record<string, unknown>);
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return; // 主动中断,不显示错误
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
    }
  };

  const handleEvent = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "queued":
        setPhase("queued");
        setPosition(typeof data.position === "number" ? data.position : null);
        break;
      case "start":
        setPhase("running");
        setPosition(null);
        break;
      case "step":
        if (typeof data.tool === "string") {
          // 动态步:新工具追加(running),已存在的标 running(去重,防重复追加)。
          // 在 updater 内同步 stepsRef,消除"同 chunk 内 step+result 紧邻时 ref 取到旧值"的 stale 风险。
          setSteps((prev) => {
            const exists = prev.some((s) => s.tool === data.tool);
            const next = exists
              ? prev.map((s) =>
                  s.tool === data.tool ? { ...s, status: "running" as StepStatus } : s,
                )
              : [...prev, { tool: data.tool as string, status: "running" as StepStatus }];
            stepsRef.current = next;
            return next;
          });
        }
        break;
      case "step_done":
        if (typeof data.tool === "string") {
          // step_done 可能先于 step 到达(理论上不会,但防御):工具不存在则追加为 done。
          setSteps((prev) => {
            const exists = prev.some((s) => s.tool === data.tool);
            const next = exists
              ? prev.map((s) =>
                  s.tool === data.tool ? { ...s, status: "done" as StepStatus } : s,
                )
              : [...prev, { tool: data.tool as string, status: "done" as StepStatus }];
            stepsRef.current = next;
            return next;
          });
        }
        break;
      case "result": {
        setPhase("done");
        const c = typeof data.conclusion === "string" ? data.conclusion : null;
        const s = typeof data.screenshot === "string" ? data.screenshot : null;
        const r =
          typeof data.screenshotReason === "string" ? data.screenshotReason : null;
        setConclusion(c);
        setScreenshot(s);
        setScreenshotReason(r);
        // 写本地缓存:result=全部完成。steps 用当前已累积的(全标 done),运行期间再次展开直接还原。
        const doneSteps = stepsRef.current.map((s) => ({
          ...s,
          status: "done" as StepStatus,
        }));
        stepsRef.current = doneSteps;
        setSteps(doneSteps);
        writeAuditCache(errorObj.desc_hash, {
          conclusion: c,
          screenshot: s,
          screenshotReason: r,
          steps: doneSteps,
        });
        break;
      }
      case "error":
        setPhase("error");
        setErrorMsg(typeof data.message === "string" ? data.message : "未知错误");
        break;
      default:
        break;
    }
  };

  // 挂载:有缓存直接还原结果(不重新审核);无缓存自动开始审核。
  // 卸载:中断在途请求,防后端空跑 + 防泄漏。
  useEffect(() => {
    const cached = readAuditCache(errorObj.desc_hash);
    if (cached) {
      setPhase("done");
      setSteps(cached.steps);
      setConclusion(cached.conclusion);
      setScreenshot(cached.screenshot);
      setScreenshotReason(cached.screenshotReason);
      return;
    }
    void start();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = phase === "queued" || phase === "running";

  return (
    <div
      style={{
        marginTop: 6,
        padding: "10px 12px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderLeft: "2px solid var(--accent)",
        borderRadius: 4,
      }}
    >
      {/* 顶部:排队提示 / 状态(挂载即自动开始,无手动按钮) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        {phase === "queued" && position != null && (
          <span
            style={{
              color: "var(--warn)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            排队中(前面还有 {position} 个)…
          </span>
        )}
        {running && (
          <span
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            审核中…
          </span>
        )}
      </div>

      {/* 进度条:动态步,从后端 step 事件累积(阶段 2.1 可能只有读脚本,2.2 加截图 7 工具) */}
      {phase !== "idle" && steps.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {steps.map((s) => (
            <span
              key={s.tool}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                borderRadius: 3,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color:
                  s.status === "done"
                    ? "var(--accent)"
                    : s.status === "running"
                      ? "var(--text)"
                      : "var(--text-dim)",
                background:
                  s.status === "done"
                    ? "var(--accent-soft)"
                    : "transparent",
                border: `1px solid ${
                  s.status === "done"
                    ? "var(--accent-dim)"
                    : "var(--border)"
                }`,
              }}
            >
              {s.status === "done" ? (
                <CheckCircleFilled style={{ fontSize: 11 }} />
              ) : s.status === "running" ? (
                <LoadingOutlined style={{ fontSize: 11 }} />
              ) : (
                <span style={{ opacity: 0.5 }}>○</span>
              )}
              {STEP_LABELS[s.tool] ?? s.tool}
            </span>
          ))}
        </div>
      )}

      {/* 结论 */}
      {phase === "done" && conclusion && (
        <div
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
            lineHeight: 1.5,
            padding: "8px 10px",
            background: "var(--bg)",
            borderRadius: 3,
            border: "1px solid var(--border)",
            marginBottom: 6,
          }}
        >
          {conclusion}
        </div>
      )}

      {/* 截图缩略图位(阶段 2.1 恒 null,2.2 接截图 MCP 后有图) */}
      {phase === "done" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          {screenshot ? (
            <Tooltip title="点击放大">
              <img
                src={`data:image/png;base64,${screenshot}`}
                alt="审核截图"
                style={{
                  maxWidth: 240,
                  maxHeight: 140,
                  border: "1px solid var(--border-strong)",
                  borderRadius: 3,
                  cursor: "zoom-in",
                }}
              />
            </Tooltip>
          ) : (
            <span
              style={{
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "4px 8px",
                background: "var(--bg)",
                border: "1px dashed var(--border-strong)",
                borderRadius: 3,
              }}
            >
              无截图{screenshotReason ? `(原因:${screenshotReason})` : ""}
            </span>
          )}
        </div>
      )}

      {/* 错误 */}
      {phase === "error" && errorMsg && (
        <div
          style={{
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            wordBreak: "break-word",
          }}
        >
          审核失败:{errorMsg}
        </div>
      )}

      {/* 完成后允许重新审核(清缓存再发) */}
      {phase === "done" && (
        <Button
          size="small"
          onClick={() => {
            clearAuditCache(errorObj.desc_hash);
            void start();
          }}
          style={{
            color: "var(--text-muted)",
            borderColor: "var(--border)",
            background: "transparent",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          重新审核
        </Button>
      )}
    </div>
  );
}
