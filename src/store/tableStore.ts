import { create } from "zustand";

/** /api/table/open 返回的列元信息。dtype 为 polars dtype 字符串,仅用于显示,前端不强约束。 */
export interface TableColumnMeta {
  name: string;
  dtype: string;
}

/** 表格打开后的状态:只存元信息,绝不存全表数据。 */
export interface TableState {
  /** 后端 base URL,形如 http://127.0.0.1:{port},由 Rust get_backend_url 提供。 */
  backendUrl: string | null;
  /** sha1(path|mtime|size) 十六进制,作为 /api/table/data 的缓存键。 */
  tableId: string | null;
  /** 总行数,用于 infinite datasource 的滚动条尺寸与 lastRow。 */
  rowCount: number | null;
  /** 列元信息,用于动态生成 columnDefs。 */
  columns: TableColumnMeta[];
  /** 最近一次打开的本地文件绝对路径,仅用于 UI 提示与 blame 请求。 */
  filePath: string | null;
  /** 表头行(1-based)。null=自动(首行当表头)。由打开时配置弹窗决定,透传给 datasource/search。 */
  headerRow: number | null;
  /** 跳过行段列表,每段 [startRow, endRow] 1-based 闭区间。这些行不显示也不搜索。 */
  skipRows: number[][];
  /** 顶部状态条文案。 */
  status: string;
  /** 错误信息(若有)。 */
  error: string | null;
  /** 打开文件 / 解析中。 */
  loading: boolean;

  /** blame 是否已加载完成(开关语义已移除,改为按钮触发一次性加载)。 */
  blameLoaded: boolean;
  /** blame 行数(= 文件总行数,显示在工具栏按钮 "Blame ✓ N")。 */
  blameCount: number;
  /** blame 加载错误(仅工具栏 tooltip/小字呈现)。 */
  blameError: string | null;
  /** blame 请求进行中(按钮 loading 态)。 */
  blameLoading: boolean;

  setBackendUrl: (url: string) => void;
  setTable: (info: {
    tableId: string;
    rowCount: number;
    columns: TableColumnMeta[];
    filePath: string;
    headerRow: number | null;
    skipRows: number[][];
  }) => void;
  /** 单独更新 headerRow/skipRows(切换配置时用,不改其它元信息)。 */
  setHeaderSkip: (info: { headerRow: number | null; skipRows: number[][] }) => void;
  setStatus: (s: string) => void;
  setError: (e: string | null) => void;
  setLoading: (b: boolean) => void;
  setBlame: (info: {
    loaded: boolean;
    count: number;
    error?: string | null;
  }) => void;
  setBlameLoading: (b: boolean) => void;
  reset: () => void;
}

export const useTableStore = create<TableState>((set) => ({
  backendUrl: null,
  tableId: null,
  rowCount: null,
  columns: [],
  filePath: null,
  headerRow: null,
  skipRows: [],
  status: "",
  error: null,
  loading: false,

  blameLoaded: false,
  blameCount: 0,
  blameError: null,
  blameLoading: false,

  setBackendUrl: (url) => set({ backendUrl: url }),
  setTable: (info) =>
    set({
      tableId: info.tableId,
      rowCount: info.rowCount,
      columns: info.columns,
      filePath: info.filePath,
      headerRow: info.headerRow,
      skipRows: info.skipRows,
      error: null,
      // 切换文件时清空 blame(新文件的 blame 尚未加载)
      blameLoaded: false,
      blameCount: 0,
      blameError: null,
      blameLoading: false,
    }),
  setHeaderSkip: (info) =>
    set({ headerRow: info.headerRow, skipRows: info.skipRows }),
  setStatus: (s) => set({ status: s }),
  setError: (e) => set({ error: e, loading: false }),
  setLoading: (b) => set({ loading: b }),
  setBlame: (info) =>
    set({
      blameLoaded: info.loaded,
      blameCount: info.count,
      blameError: info.error ?? null,
    }),
  setBlameLoading: (b) => set({ blameLoading: b }),
  reset: () =>
    set({
      tableId: null,
      rowCount: null,
      columns: [],
      filePath: null,
      headerRow: null,
      skipRows: [],
      status: "",
      error: null,
      loading: false,
      blameLoaded: false,
      blameCount: 0,
      blameError: null,
      blameLoading: false,
    }),
}));
