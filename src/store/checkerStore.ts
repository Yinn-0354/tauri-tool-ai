import { create } from "zustand";

/**
 * 配置检查器状态(第一层:汇总)。
 *
 * 数据契约对齐 PRD 2.1/2.2 节真实结构(阶段0 stub 的 {id,table,field,row,message,severity} 全作废)。
 * 后端 POST /api/checker/report 返回 {reportId, appkey, rules: RuleSummary[]}。
 */

/** 单条 errorObj(PRD 2.2)。 */
export interface ErrorObj {
  /** 配置表名,可能纯文件名或带相对路径(RecipeBelong.txt / client/ui/.../X.txt)。 */
  table_path: string;
  /** 行号,脚本不规范:可能 ["291"] / [291] / [-1],字符串与数字混用。-1=某 ID 在表里找不到对应行。 */
  rowID: (string | number)[];
  /** 被检查的列名/字段名。截图目标列;可能为空(结合 value 判断)。 */
  name: string;
  /** 大段多行自然语言:含业务字段值、问题陈述、根因。Claude 理解 + 口语对话生成的唯一输入源。 */
  value: string;
  /** 行级负责人(多为 null)。 */
  author: { name: string; email: string } | null;
  /** 行级测试负责人(多为 [])。 */
  testLead: { name: string; email: string }[];
  /** 去重哈希。 */
  desc_hash: string;
}

/** 规则负责人。 */
export interface RuleAssignee {
  id: number;
  name: string;
  email: string;
}

/** 单条规则结果(PRD 2.1,后端补了 ruleDesc + scriptPath)。 */
export interface RuleSummary {
  rule_name: string;
  rule_id: number;
  rule_is_deleted: boolean;
  module: string[];
  owner: string;
  status: "fail" | "success" | "exception";
  note: { fails: number; message: string } | null;
  result: {
    error_count: number;
    /** 表名 → errorObj[]。error_count==0 时为空对象 {}。 */
    content: Record<string, ErrorObj[]>;
    run_time: number;
    first_detected_time: string;
    author: unknown[];
    testLead: unknown[];
    rule_assigness: RuleAssignee[];
  };
  /** 规则需求描述(后端 get_rule_by_rule_id 补,直返字段)。 */
  ruleDesc: string;
  /** 脚本相对路径(后端 get_rule_by_rule_id 补,如 "jx3/.../check_xxx.py")。 */
  scriptPath: string;
}

/** 后端 /api/checker/report 返回结构。 */
interface CheckerReportResponse {
  reportId: number;
  appkey: string | null;
  rules: RuleSummary[];
}

interface CheckerState {
  /** 平台报告链接(用户粘贴,含 ?reportId=N)。 */
  reportUrl: string;
  /** 规则名(可选,精确匹配;空=返回全部)。 */
  ruleName: string;
  /** 后端返回的规则汇总列表。 */
  rules: RuleSummary[];
  /** 后端返回的 reportId(链接解析得来)。 */
  reportId: number | null;
  /** 后端返回的 appkey(链接 path 段抠取)。 */
  appkey: string | null;
  /** 拉取中。 */
  loading: boolean;
  /** 错误信息(拉取失败 / 输入校验)。 */
  error: string | null;

  setReportUrl: (v: string) => void;
  setRuleName: (v: string) => void;
  /** 调后端拉取报告全量规则结果。backendUrl 为 sidecar 基址。 */
  fetchReport: (backendUrl: string) => Promise<void>;
  /** 重置全部状态。 */
  reset: () => void;
}

export const useCheckerStore = create<CheckerState>((set, get) => ({
  reportUrl: "",
  ruleName: "",
  rules: [],
  reportId: null,
  appkey: null,
  loading: false,
  error: null,

  setReportUrl: (v) => set({ reportUrl: v }),
  setRuleName: (v) => set({ ruleName: v }),

  fetchReport: async (backendUrl) => {
    const { reportUrl } = get();
    if (!reportUrl.trim()) {
      set({ error: "请填写报告链接" });
      return;
    }
    set({ loading: true, error: null, rules: [], reportId: null, appkey: null });
    try {
      const base = backendUrl.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/checker/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportUrl: reportUrl.trim(),
          ruleName: get().ruleName.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${detail ? `: ${detail}` : ""}`);
      }
      const data = (await resp.json()) as CheckerReportResponse;
      set({
        rules: data.rules,
        reportId: data.reportId,
        appkey: data.appkey,
        loading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      });
    }
  },

  reset: () =>
    set({
      reportUrl: "",
      ruleName: "",
      rules: [],
      reportId: null,
      appkey: null,
      error: null,
      loading: false,
    }),
}));
