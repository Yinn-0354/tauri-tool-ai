import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 配置检查器状态(第一层:汇总)。
 *
 * 数据契约对齐 PRD 2.1/2.2 节真实结构。
 *
 * 多报告标签页(PRD §12.2):store 从"全局一份 rules"改成"按 reportId 键控多份"。
 * 每个报告一个 ReportTab,含报告链接、规则名、拉取结果(rules)、appkey、分支信息、
 * loading/error。切换标签独立,互不丢失。
 *
 * 持久化(决策 38):只存标签元信息(id/appkey/branch/branchAlia/链接),不存 rules 全量
 * + 审核结果。重启恢复空标签列表,点标签重新拉取。
 */

/** 单条 errorObj(PRD 2.2)。 */
export interface ErrorObj {
  table_path: string;
  rowID: (string | number)[];
  name: string;
  value: string;
  author: { name: string; email: string } | null;
  testLead: { name: string; email: string }[];
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
    content: Record<string, ErrorObj[]>;
    run_time: number;
    first_detected_time: string;
    author: unknown[];
    testLead: unknown[];
    rule_assigness: RuleAssignee[];
  };
  ruleDesc: string;
  scriptPath: string;
}

/** 单个报告标签(PRD §12.2)。 */
export interface ReportTab {
  /** 报告 id(从链接抠取,键控标识)。 */
  reportId: number;
  /** 项目 id(appkey)。 */
  appkey: string | null;
  /** 分支识别结果(PRD §12.1);null=匹配不到,审核回退默认分支。 */
  branch: string | null;
  branchAlia: string | null;
  /** 报告链接(重启恢复后点标签重新拉取用)。 */
  reportUrl: string;
  /** 该标签的规则名过滤词。 */
  ruleName: string;
  /** 拉取结果。 */
  rules: RuleSummary[];
  /** 拉取中。 */
  loading: boolean;
  /** 错误信息。 */
  error: string | null;
}

/** 后端 /api/checker/report 返回结构(含分支识别字段)。 */
interface CheckerReportResponse {
  reportId: number;
  appkey: string | null;
  branch: string | null;
  branchAlia: string | null;
  rules: RuleSummary[];
}

/** 持久化只存标签元信息(决策 38)。 */
interface PersistedTab {
  reportId: number;
  appkey: string | null;
  branch: string | null;
  branchAlia: string | null;
  reportUrl: string;
  ruleName: string;
}

interface CheckerState {
  /** 当前激活的报告标签 id。 */
  activeReportId: number | null;
  /** 报告标签列表(id → tab),拉取结果/审核状态独立存。 */
  tabs: Record<number, ReportTab>;
  /** 全局输入区(新链接/规则名,拉取时创建一个新标签)。 */
  reportUrlInput: string;
  ruleNameInput: string;
  /** 项目颜色分组(PRD §12.2):appkey → 色号(0-based 首见顺序)。会话内存态,不持久化
   *  (跨会话不强制固定某项目=某色)。新增 appkey 时自动分配。 */
  projectColors: Record<string, number>;

  setReportUrlInput: (v: string) => void;
  setRuleNameInput: (v: string) => void;
  /** 确保某 appkey 已分配项目色号(首见顺序),返回色号(0-based)。在拉取时调用。 */
  ensureProjectColor: (appkey: string) => number;
  /** 纯读取某 appkey 的色号(未分配返回 -1)。渲染用,不 setState。 */
  getProjectColorIndex: (appkey: string) => number;
  /** 拉取输入区链接 → 创建一个新报告标签(或复用同 id 已存在标签)并激活。 */
  fetchReport: (backendUrl: string) => Promise<void>;
  /** 切换激活标签。 */
  setActiveReport: (reportId: number) => void;
  /** 重新拉取某标签(重启恢复元信息后点标签调这个)。 */
  refetchReport: (reportId: number, backendUrl: string) => Promise<void>;
  /** 关闭某标签。 */
  closeReport: (reportId: number) => void;
  /** 重置全部(清空所有标签)。 */
  reset: () => void;
  /** 内部:真正的拉取逻辑(按 reportId 更新 tabs[id])。 */
  _doFetch: (
    reportId: number,
    backendUrl: string,
    url: string,
    ruleName: string,
  ) => Promise<void>;
}

/** 从链接抠 reportId 的纯函数(供 store 内部用,与后端 parse 一致)。 */
export function parseReportIdFromUrl(reportUrl: string): number | null {
  const m = reportUrl.match(/[?&]reportId=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 项目颜色分组 8 色序(PRD §12.2 决策42):首见顺序分配,超 8 循环灰。
 *  深色模式:暗饱和、贴合深石墨底(dark 底亮显)。色号 = 该数组下标。
 *  light 模式用 PROJECT_COLORS_LIGHT(加深色,浅底可读),见 projectColor()。 */
export const PROJECT_COLORS: string[] = [
  "#c8e663", // 1 电石绿(沿用 accent)
  "#6ab7c6", // 2 天青
  "#e8a33d", // 3 琥珀橙(沿用 warn)
  "#e07a7a", // 4 玫瑰红
  "#9a8ecf", // 5 淡紫
  "#5fbf9a", // 6 青绿
  "#7a9bbf", // 7 钢蓝
  "#9aa3aa", // 8+ 灰(沿用 text-muted)
];

/** 项目颜色 · light 模式加深版:与深色版同色相,但压到中深明度,
 *  保证浅底上文字/边框对比度达标(≥4.5:1)。与 PROJECT_COLORS 下标一一对应。 */
export const PROJECT_COLORS_LIGHT: string[] = [
  "#4a7d1f", // 1 电石绿(加深)
  "#1e7a8a", // 2 天青(加深)
  "#a05f00", // 3 琥珀橙(加深)
  "#a83232", // 4 玫瑰红(加深)
  "#5b4da3", // 5 淡紫(加深)
  "#1f7a5c", // 6 青绿(加深)
  "#34567a", // 7 钢蓝(加深)
  "#5a636b", // 8+ 灰(light text-muted)
];

export const useCheckerStore = create<CheckerState>()(
  persist(
    (set, get) => ({
      activeReportId: null,
      tabs: {},
      reportUrlInput: "",
      ruleNameInput: "",
      projectColors: {},

      setReportUrlInput: (v) => set({ reportUrlInput: v }),
      setRuleNameInput: (v) => set({ ruleNameInput: v }),

      ensureProjectColor: (appkey) => {
        if (!appkey) return -1;
        const { projectColors } = get();
        const existing = projectColors[appkey];
        if (existing !== undefined) return existing;
        // 首见顺序分配:下一个未用色号。前 8 个项目用 8 色序,
        // 超 8 个起统一用灰(色号 7 = PROJECT_COLORS 末位,PRD 决策42)。
        const used = new Set(Object.values(projectColors));
        let next = 0;
        while (used.has(next)) next++;
        const idx = next >= PROJECT_COLORS.length ? PROJECT_COLORS.length - 1 : next;
        set({ projectColors: { ...projectColors, [appkey]: idx } });
        return idx;
      },
      getProjectColorIndex: (appkey) => {
        if (!appkey) return -1;
        return get().projectColors[appkey] ?? -1;
      },

      fetchReport: async (backendUrl) => {
        const { reportUrlInput, ruleNameInput } = get();
        const url = reportUrlInput.trim();
        if (!url) return;
        const reportId = parseReportIdFromUrl(url);
        if (reportId === null) {
          set({
            tabs: {
              ...get().tabs,
              [-1]: {
                reportId: -1,
                appkey: null,
                branch: null,
                branchAlia: null,
                reportUrl: url,
                ruleName: ruleNameInput.trim(),
                rules: [],
                loading: false,
                error: "链接里找不到 reportId 参数",
              },
            },
            activeReportId: -1,
          });
          return;
        }
        // 建/复用标签并拉取
        const tabs = get().tabs;
        const tab: ReportTab = {
          reportId,
          appkey: tabs[reportId]?.appkey ?? null,
          branch: tabs[reportId]?.branch ?? null,
          branchAlia: tabs[reportId]?.branchAlia ?? null,
          reportUrl: url,
          ruleName: ruleNameInput.trim(),
          rules: tabs[reportId]?.rules ?? [],
          loading: true,
          error: null,
        };
        set({ tabs: { ...tabs, [reportId]: tab }, activeReportId: reportId });
        await get()._doFetch(reportId, backendUrl, url, ruleNameInput.trim());
      },

      refetchReport: async (reportId, backendUrl) => {
        const tab = get().tabs[reportId];
        if (!tab) return;
        set({
          tabs: {
            ...get().tabs,
            [reportId]: { ...tab, loading: true, error: null },
          },
          activeReportId: reportId,
        });
        await get()._doFetch(reportId, backendUrl, tab.reportUrl, tab.ruleName);
      },

      setActiveReport: (reportId) => set({ activeReportId: reportId }),

      closeReport: (reportId) => {
        const tabs = { ...get().tabs };
        delete tabs[reportId];
        let activeReportId = get().activeReportId;
        if (activeReportId === reportId) {
          const ids = Object.keys(tabs).map(Number);
          activeReportId = ids.length > 0 ? ids[0] : null;
        }
        set({ tabs, activeReportId });
      },

      reset: () =>
        set({ activeReportId: null, tabs: {}, reportUrlInput: "", ruleNameInput: "" }),

      _doFetch: async (reportId, backendUrl, url, ruleName) => {
        const base = backendUrl.replace(/\/$/, "");
        try {
          const resp = await fetch(`${base}/api/checker/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reportUrl: url.trim(),
              ruleName: ruleName.trim() || undefined,
            }),
          });
          if (!resp.ok) {
            const detail = await resp.text().catch(() => "");
            throw new Error(`HTTP ${resp.status}${detail ? `: ${detail}` : ""}`);
          }
          const data = (await resp.json()) as CheckerReportResponse;
          // appkey 确定后分配项目色号(首见顺序,PRD §12.2)。非渲染时机,安全 set。
          if (data.appkey) get().ensureProjectColor(data.appkey);
          set({
            tabs: {
              ...get().tabs,
              [reportId]: {
                ...get().tabs[reportId],
                reportId: data.reportId,
                appkey: data.appkey,
                branch: data.branch,
                branchAlia: data.branchAlia,
                reportUrl: url,
                ruleName,
                rules: data.rules,
                loading: false,
                error: null,
              },
            },
          });
        } catch (e) {
          set({
            tabs: {
              ...get().tabs,
              [reportId]: {
                ...get().tabs[reportId],
                loading: false,
                error: e instanceof Error ? e.message : String(e),
              },
            },
          });
        }
      },
    }),
    {
      name: "tauri-tool-ai-checker",
      // 只持久化标签元信息(决策 38):id/appkey/branch/branchAlia/reportUrl/ruleName。
      partialize: (state) => {
        const tabs: Record<number, PersistedTab> = {};
        for (const [id, t] of Object.entries(state.tabs)) {
          tabs[Number(id)] = {
            reportId: t.reportId,
            appkey: t.appkey,
            branch: t.branch,
            branchAlia: t.branchAlia,
            reportUrl: t.reportUrl,
            ruleName: t.ruleName,
          };
        }
        return {
          activeReportId: state.activeReportId,
          tabs,
        };
      },
      // 恢复:把持久化的元信息还原成空 rules 标签(点标签时 refetch)。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as {
          tabs?: Record<number, PersistedTab>;
          activeReportId?: number | null;
        };
        const restored: Record<number, ReportTab> = {};
        for (const [id, meta] of Object.entries(p.tabs ?? {})) {
          restored[Number(id)] = {
            reportId: meta.reportId,
            appkey: meta.appkey,
            branch: meta.branch,
            branchAlia: meta.branchAlia,
            reportUrl: meta.reportUrl,
            ruleName: meta.ruleName,
            rules: [],
            loading: false,
            error: null,
          };
        }
        return {
          ...current,
          tabs: restored,
          activeReportId: p.activeReportId ?? null,
        };
      },
    },
  ),
);
