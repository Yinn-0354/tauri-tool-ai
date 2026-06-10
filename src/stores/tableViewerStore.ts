import { create } from "zustand";
import type { TableMeta, TableSource } from "@/api/table";

type ViewMode = "table" | "card" | "template";

interface TableViewerState {
  viewMode: ViewMode;
  currentTable: TableMeta | null;
  selectedSource: TableSource | null;
  groupByColumn: string | null;
  templateString: string;
  setViewMode: (mode: ViewMode) => void;
  setCurrentTable: (table: TableMeta | null) => void;
  setSelectedSource: (source: TableSource | null) => void;
  setGroupByColumn: (col: string | null) => void;
  setTemplateString: (tpl: string) => void;
}

export const useTableViewerStore = create<TableViewerState>((set) => ({
  viewMode: "table",
  currentTable: null,
  selectedSource: null,
  groupByColumn: null,
  templateString: "{*}",
  setViewMode: (mode) => set({ viewMode: mode }),
  setCurrentTable: (table) => set({ currentTable: table }),
  setSelectedSource: (source) => set({ selectedSource: source }),
  setGroupByColumn: (col) => set({ groupByColumn: col }),
  setTemplateString: (tpl) => set({ templateString: tpl }),
}));
