import { create } from "zustand";
import type { VcsSource, BlameLine } from "@/api/blame";

export type BlameMode = "none" | "blame";
export type BlameStyle = "gutter" | "grouped" | "hover";

interface BlameViewerState {
  selectedSource: VcsSource | null; // 数据源即文件：选中的就是当前要查看的文件
  fileContent: string;
  fileIsBinary: boolean;
  fileLoading: boolean;
  fileError: boolean; // 读取文件内容失败

  blameLines: BlameLine[] | null; // 全量 blame 行
  blameLoading: boolean;
  blameMode: BlameMode;
  blameStyle: BlameStyle;

  searchQuery: string;

  setSelectedSource: (source: VcsSource | null) => void;
  setFileContent: (content: string) => void;
  setFileMeta: (meta: { isBinary: boolean }) => void;
  setFileLoading: (loading: boolean) => void;
  setFileError: (error: boolean) => void;
  setBlameLines: (lines: BlameLine[] | null) => void;
  setBlameLoading: (loading: boolean) => void;
  setBlameMode: (mode: BlameMode) => void;
  setBlameStyle: (style: BlameStyle) => void;
  setSearchQuery: (query: string) => void;
}

export const useBlameStore = create<BlameViewerState>((set) => ({
  selectedSource: null,
  fileContent: "",
  fileIsBinary: false,
  fileLoading: false,
  fileError: false,

  blameLines: null,
  blameLoading: false,
  blameMode: "none",
  blameStyle: "grouped",

  searchQuery: "",

  setSelectedSource: (source) =>
    set({
      selectedSource: source,
      // 切换数据源（文件）时重置内容/blame/搜索
      fileContent: "",
      fileIsBinary: false,
      fileLoading: false,
      fileError: false,
      blameLines: null,
      blameMode: "none",
      blameLoading: false,
      searchQuery: "",
    }),
  setFileContent: (content) => set({ fileContent: content }),
  setFileMeta: (meta) => set({ fileIsBinary: meta.isBinary }),
  setFileLoading: (loading) => set({ fileLoading: loading }),
  setFileError: (error) => set({ fileError: error }),
  setBlameLines: (lines) => set({ blameLines: lines }),
  setBlameLoading: (loading) => set({ blameLoading: loading }),
  setBlameMode: (mode) => set({ blameMode: mode }),
  setBlameStyle: (style) => set({ blameStyle: style }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
