import { create } from "zustand";
import type { VcsSource, BlameLine } from "@/api/blame";

export type BlameMode = "none" | "blame";
export type BlameStyle = "gutter" | "grouped" | "hover";

interface BlameViewerState {
  selectedSource: VcsSource | null; // 数据源即文件：选中的就是当前要查看的文件
  fileIsBinary: boolean;
  fileTruncated: boolean;
  fileTooLargeForBlame: boolean; // 文件超过 blame 上限（>10MB），与显示截断独立
  fileLoading: boolean; // 元信息（file-content）加载中
  fileError: boolean; // 读取文件内容失败

  // 分页内容（纯内容视图）
  pageLines: string[]; // 当前页的行
  page: number;
  pageSize: number;
  totalLines: number; // 文件总行数（纯内容）
  pageLoading: boolean;

  // blame（分页）
  blameLines: BlameLine[] | null; // 当前页的 blame 行
  blameTotalLines: number; // blame 总行数
  blameLoading: boolean;
  blameMode: BlameMode;
  blameStyle: BlameStyle;

  searchQuery: string;

  setSelectedSource: (source: VcsSource | null) => void;
  setFileMeta: (meta: {
    isBinary: boolean;
    truncated: boolean;
    tooLargeForBlame: boolean;
  }) => void;
  setFileLoading: (loading: boolean) => void;
  setFileError: (error: boolean) => void;
  setPageLines: (lines: string[]) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setTotalLines: (total: number) => void;
  setPageLoading: (loading: boolean) => void;
  setBlameLines: (lines: BlameLine[] | null) => void;
  setBlameTotalLines: (total: number) => void;
  setBlameLoading: (loading: boolean) => void;
  setBlameMode: (mode: BlameMode) => void;
  setBlameStyle: (style: BlameStyle) => void;
  setSearchQuery: (query: string) => void;
}

const DEFAULT_PAGE_SIZE = 50;

export const useBlameStore = create<BlameViewerState>((set) => ({
  selectedSource: null,
  fileIsBinary: false,
  fileTruncated: false,
  fileTooLargeForBlame: false,
  fileLoading: false,
  fileError: false,

  pageLines: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  totalLines: 0,
  pageLoading: false,

  blameLines: null,
  blameTotalLines: 0,
  blameLoading: false,
  blameMode: "none",
  blameStyle: "grouped",

  searchQuery: "",

  setSelectedSource: (source) =>
    set({
      selectedSource: source,
      // 切换数据源（文件）时重置全部内容/blame/分页/搜索
      fileIsBinary: false,
      fileTruncated: false,
      fileTooLargeForBlame: false,
      fileLoading: false,
      fileError: false,
      pageLines: [],
      page: 1,
      totalLines: 0,
      pageLoading: false,
      blameLines: null,
      blameTotalLines: 0,
      blameMode: "none",
      blameLoading: false,
      searchQuery: "",
    }),
  setFileMeta: (meta) =>
    set({
      fileIsBinary: meta.isBinary,
      fileTruncated: meta.truncated,
      fileTooLargeForBlame: meta.tooLargeForBlame,
    }),
  setFileLoading: (loading) => set({ fileLoading: loading }),
  setFileError: (error) => set({ fileError: error }),
  setPageLines: (lines) => set({ pageLines: lines }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  setTotalLines: (total) => set({ totalLines: total }),
  setPageLoading: (loading) => set({ pageLoading: loading }),
  setBlameLines: (lines) => set({ blameLines: lines }),
  setBlameTotalLines: (total) => set({ blameTotalLines: total }),
  setBlameLoading: (loading) => set({ blameLoading: loading }),
  setBlameMode: (mode) => set({ blameMode: mode }),
  setBlameStyle: (style) => set({ blameStyle: style }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
