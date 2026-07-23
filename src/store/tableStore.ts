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
  /** 最近一次打开的本地文件绝对路径,仅用于 UI 提示。 */
  filePath: string | null;
  /** 顶部状态条文案。 */
  status: string;
  /** 错误信息(若有)。 */
  error: string | null;
  /** 加载中标志。 */
  loading: boolean;
  /** blame 开关:开启后表格左侧显示 blame gutter,点行查作者。 */
  blameEnabled: boolean;
  /** blame 加载中(某个 blame 请求进行中)。 */
  blameLoading: boolean;

  setBackendUrl: (url: string) => void;
  setTable: (info: {
    tableId: string;
    rowCount: number;
    columns: TableColumnMeta[];
    filePath: string;
  }) => void;
  setStatus: (s: string) => void;
  setError: (e: string | null) => void;
  setLoading: (b: boolean) => void;
  setBlameEnabled: (b: boolean) => void;
  setBlameLoading: (b: boolean) => void;
  reset: () => void;
}

export const useTableStore = create<TableState>((set) => ({
  backendUrl: null,
  tableId: null,
  rowCount: null,
  columns: [],
  filePath: null,
  status: "",
  error: null,
  loading: false,
  blameEnabled: false,
  blameLoading: false,

  setBackendUrl: (url) => set({ backendUrl: url }),
  setTable: (info) =>
    set({
      tableId: info.tableId,
      rowCount: info.rowCount,
      columns: info.columns,
      filePath: info.filePath,
      error: null,
    }),
  setStatus: (s) => set({ status: s }),
  setError: (e) => set({ error: e, loading: false }),
  setLoading: (b) => set({ loading: b }),
  setBlameEnabled: (b) => set({ blameEnabled: b }),
  setBlameLoading: (b) => set({ blameLoading: b }),
  reset: () =>
    set({
      tableId: null,
      rowCount: null,
      columns: [],
      filePath: null,
      status: "",
      error: null,
      loading: false,
      blameEnabled: false,
      blameLoading: false,
    }),
}));
