import { create } from "zustand";
import type { BlameLineInfo } from "../grid/blame";

/** /api/table/open 返回的列元信息。dtype 为 polars dtype 字符串,仅用于显示,前端不强约束。 */
export interface TableColumnMeta {
  name: string;
  dtype: string;
}

/** AG Grid 列状态(dump/恢复用)。只取需要复原的字段。 */
export interface AgColumnState {
  colId: string;
  width?: number;
  hide?: boolean;
  pinned?: string | boolean | null;
  sort?: string | null;
}

/** 滚动位置(dump/恢复用)。infinite 下 topRowIndex 可能未加载,ensureIndexVisible 会触发拉取。 */
export interface ScrollPos {
  topRowIndex: number;
  leftPx: number;
}

/**
 * 单个标签页的完整状态(元信息 + UI 状态 + TableView local 态 dump)。
 * - 元信息(tableId/rowCount/columns/...):open 成功后填;stale 时 tableId=null 需重新打开。
 * - UI 状态(blame/filters/...):切 tab dump 到此,切回复原。
 * - dump 态(blameByLine/sortCol/sortAsc/hits/pinnedTopRows/frozenColCount/columnState/scroll):
 *   TableView 卸载前写入,挂载时作 useState 初值恢复。blameByLine/hits 序列化为数组存内存。
 */
export interface TabState {
  id: string;
  filePath: string;
  tableId: string | null;
  rowCount: number | null;
  columns: TableColumnMeta[];
  headerRow: number | null;
  skipRows: number[][];
  /** 文件编码(.tab/.txt/.tsv);null=自动探测。进 tableId,换编码需重新 open。 */
  encoding: string | null;
  /** 文件可能已变(重启后未校验),需重新打开拿新 tableId。重启恢复的 tab 初值 true。 */
  stale: boolean;

  // ── UI 状态 ──
  status: string;
  error: string | null;
  loading: boolean;
  blameLoaded: boolean;
  blameCount: number;
  blameError: string | null;
  blameLoading: boolean;
  filterEnabled: boolean;
  filters: Record<string, string[]>;
  hasFrozen: boolean;

  // ── TableView local 态 dump(切 tab 保留,重启不持久化) ──
  blameByLine: [number, BlameLineInfo][] | null;
  sortCol: string | null;
  sortAsc: boolean;
  hits: [number, number[]][] | null;
  pinnedTopRows: Record<string, unknown>[] | null;
  frozenColCount: number;
  columnState: AgColumnState[] | null;
  scroll: ScrollPos | null;
}

/** 新建 tab 的初始状态(除 id/filePath/headerRow/skipRows 外的默认值)。 */
function makeTabState(partial: Pick<TabState, "id" | "filePath"> & Partial<TabState>): TabState {
  return {
    tableId: null,
    rowCount: null,
    columns: [],
    headerRow: null,
    skipRows: [],
    encoding: null,
    stale: false,
    status: "",
    error: null,
    loading: false,
    blameLoaded: false,
    blameCount: 0,
    blameError: null,
    blameLoading: false,
    filterEnabled: true,
    filters: {},
    hasFrozen: false,
    blameByLine: null,
    sortCol: null,
    sortAsc: true,
    hits: null,
    pinnedTopRows: null,
    frozenColCount: 0,
    columnState: null,
    scroll: null,
    ...partial,
  };
}

/** localStorage 持久化的单 tab 数据(仅配置类字段,不含运行态/dump 态)。 */
interface PersistedTab {
  id: string;
  filePath: string;
  headerRow: number | null;
  skipRows: number[][];
  encoding: string | null;
  filters: Record<string, string[]>;
  filterEnabled: boolean;
  sortCol: string | null;
  sortAsc: boolean;
  columnState: AgColumnState[] | null;
}

const STORAGE_KEY = "tauri-tool-ai-tabs";

interface TableStore {
  /** 后端 base URL,全局握手一次,所有 tab 共享。 */
  backendUrl: string | null;
  tabs: Record<string, TabState>;
  tabOrder: string[];
  activeTabId: string | null;

  setBackendUrl: (url: string) => void;

  /** 打开/激活表格。若已有同 filePath 的 tab 则激活之并返回其 id;否则新建并激活。返回 tabId。 */
  openTab: (info: {
    filePath: string;
    tableId: string;
    rowCount: number;
    columns: TableColumnMeta[];
    headerRow: number | null;
    skipRows: number[][];
    encoding: string | null;
  }) => string;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;

  /** 通用 patch:更新指定 tab 的部分字段(TableView/Toolbar 写 UI 态用)。 */
  setTabState: (id: string, patch: Partial<TabState>) => void;
  /** TableView 卸载前 dump 其 local 态 + ag-grid 列宽/滚动到对应 tab。 */
  dumpTableViewState: (
    id: string,
    dump: Pick<
      TabState,
      | "blameByLine"
      | "sortCol"
      | "sortAsc"
      | "hits"
      | "pinnedTopRows"
      | "frozenColCount"
      | "columnState"
      | "scroll"
    >
  ) => void;

  // ── 作用于活动 tab 的便捷 setter(Toolbar/TableView 调,store 内部路由到 activeTabId) ──
  setBlame: (info: { loaded: boolean; count: number; error?: string | null }) => void;
  setBlameLoading: (b: boolean) => void;
  setFilterEnabled: (b: boolean) => void;
  setFilter: (col: string, values: string[]) => void;
  clearFilter: (col: string) => void;
  clearAllFilters: () => void;
  setHasFrozen: (b: boolean) => void;
  setStatus: (s: string) => void;
  setError: (e: string | null) => void;
  setLoading: (b: boolean) => void;

  /** 写 localStorage(只持久化 tab 列表 + 各 tab 配置类字段)。 */
  persist: () => void;
  /** 读 localStorage 恢复 tab 列表(均标 stale:true,切到时重新 open)。 */
  hydrate: () => void;
}

function persistToStorage(tabOrder: string[], tabs: Record<string, TabState>) {
  try {
    const persisted: PersistedTab[] = tabOrder
      .map((id) => tabs[id])
      .filter((t): t is TabState => !!t)
      .map((t) => ({
        id: t.id,
        filePath: t.filePath,
        headerRow: t.headerRow,
        skipRows: t.skipRows,
        encoding: t.encoding,
        filters: t.filters,
        filterEnabled: t.filterEnabled,
        sortCol: t.sortCol,
        sortAsc: t.sortAsc,
        columnState: t.columnState,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabOrder, tabs: persisted }));
  } catch {
    // 配额满/隐私模式,静默忽略
  }
}

function readFromStorage(): { tabOrder: string[]; tabs: TabState[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { tabOrder: string[]; tabs: PersistedTab[] };
    if (!data || !Array.isArray(data.tabOrder) || !Array.isArray(data.tabs)) return null;
    const tabs = data.tabs.map((p) =>
      makeTabState({
        id: p.id,
        filePath: p.filePath,
        headerRow: p.headerRow,
        skipRows: p.skipRows,
        encoding: p.encoding ?? null,
        filters: p.filters || {},
        filterEnabled: p.filterEnabled ?? true,
        sortCol: p.sortCol ?? null,
        sortAsc: p.sortAsc ?? true,
        columnState: p.columnState ?? null,
        stale: true, // 重启恢复的 tab 未校验文件,切到时重新 open
      })
    );
    return { tabOrder: data.tabOrder, tabs };
  } catch {
    return null;
  }
}

export const useTableStore = create<TableStore>((set, get) => {
  // 启动即 hydrate(模块加载时执行一次),恢复的 tab 全标 stale
  const restored = readFromStorage();

  return {
    backendUrl: null,
    tabs: restored
      ? Object.fromEntries(restored.tabs.map((t) => [t.id, t]))
      : {},
    tabOrder: restored ? restored.tabOrder.filter((id) => restored.tabs.some((t) => t.id === id)) : [],
    activeTabId: restored && restored.tabOrder.length > 0 ? restored.tabOrder[0] : null,

    setBackendUrl: (url) => set({ backendUrl: url }),

    openTab: (info) => {
      const { tabs } = get();
      // 同 filePath 已有 tab → 激活并更新元信息(重新 open 后 tableId/rowCount/columns 可能变)
      const existing = Object.values(tabs).find((t) => t.filePath === info.filePath);
      if (existing) {
        set((s) => ({
          activeTabId: existing.id,
          tabs: {
            ...s.tabs,
            [existing.id]: {
              ...s.tabs[existing.id],
              tableId: info.tableId,
              rowCount: info.rowCount,
              columns: info.columns,
              headerRow: info.headerRow,
              skipRows: info.skipRows,
              encoding: info.encoding,
              stale: false,
              error: null,
            },
          },
        }));
        get().persist();
        return existing.id;
      }
      // 新建 tab
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tab = makeTabState({
        id,
        filePath: info.filePath,
        tableId: info.tableId,
        rowCount: info.rowCount,
        columns: info.columns,
        headerRow: info.headerRow,
        skipRows: info.skipRows,
        encoding: info.encoding,
        stale: false,
      });
      set((s) => ({
        tabs: { ...s.tabs, [id]: tab },
        tabOrder: [...s.tabOrder, id],
        activeTabId: id,
      }));
      get().persist();
      return id;
    },

    closeTab: (id) => {
      set((s) => {
        const order = s.tabOrder.filter((tid) => tid !== id);
        const tabs = { ...s.tabs };
        delete tabs[id];
        // 关活动 tab → 激活相邻(右优先,无则左,全关 → null)
        let activeTabId = s.activeTabId;
        if (s.activeTabId === id) {
          const closedIdx = s.tabOrder.indexOf(id);
          activeTabId = order[closedIdx] ?? order[closedIdx - 1] ?? null;
        }
        return { tabs, tabOrder: order, activeTabId };
      });
      get().persist();
    },

    switchTab: (id) => {
      if (get().tabs[id]) set({ activeTabId: id });
    },

    setTabState: (id, patch) =>
      set((s) => {
        const t = s.tabs[id];
        if (!t) return s;
        return { tabs: { ...s.tabs, [id]: { ...t, ...patch } } };
      }),

    dumpTableViewState: (id, dump) =>
      set((s) => {
        const t = s.tabs[id];
        if (!t) return s;
        return { tabs: { ...s.tabs, [id]: { ...t, ...dump } } };
      }),

    // ── 便捷 setter:转发到活动 tab ──
    setBlame: (info) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id) return s;
        const t = s.tabs[id];
        if (!t) return s;
        return {
          tabs: {
            ...s.tabs,
            [id]: { ...t, blameLoaded: info.loaded, blameCount: info.count, blameError: info.error ?? null },
          },
        };
      }),
    setBlameLoading: (b) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], blameLoading: b } } };
      }),
    setFilterEnabled: (b) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return {
          tabs: {
            ...s.tabs,
            [id]: b ? { ...s.tabs[id], filterEnabled: true } : { ...s.tabs[id], filterEnabled: false, filters: {} },
          },
        };
      }),
    setFilter: (col, values) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        const t = s.tabs[id];
        const next = { ...t.filters };
        if (!values || values.length === 0) delete next[col];
        else next[col] = values;
        return { tabs: { ...s.tabs, [id]: { ...t, filters: next } } };
      }),
    clearFilter: (col) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id] || !(col in s.tabs[id].filters)) return s;
        const t = s.tabs[id];
        const next = { ...t.filters };
        delete next[col];
        return { tabs: { ...s.tabs, [id]: { ...t, filters: next } } };
      }),
    clearAllFilters: () =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], filters: {} } } };
      }),
    setHasFrozen: (b) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], hasFrozen: b } } };
      }),
    setStatus: (st) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], status: st } } };
      }),
    setError: (e) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], error: e, loading: false } } };
      }),
    setLoading: (b) =>
      set((s) => {
        const id = s.activeTabId;
        if (!id || !s.tabs[id]) return s;
        return { tabs: { ...s.tabs, [id]: { ...s.tabs[id], loading: b } } };
      }),

    persist: () => {
      const { tabOrder, tabs } = get();
      persistToStorage(tabOrder, tabs);
    },

    hydrate: () => {
      const r = readFromStorage();
      if (!r) return;
      set({
        tabs: Object.fromEntries(r.tabs.map((t) => [t.id, t])),
        tabOrder: r.tabOrder.filter((id) => r.tabs.some((t) => t.id === id)),
        activeTabId: r.tabOrder.length > 0 ? r.tabOrder[0] : null,
      });
    },
  };
});

/** 便捷 hook:取活动 tab(Toolbar/App 读取活动 tab 字段用)。 */
export function useActiveTab(): TabState | null {
  return useTableStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] ?? null : null));
}
