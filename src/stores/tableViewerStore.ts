import { create } from "zustand";
import type { TableMeta } from "@/api/table";

type ViewMode = "table" | "card" | "template";

interface TableViewerState {
  viewMode: ViewMode;
  currentTable: TableMeta | null;
  groupByColumn: string | null;
  templateString: string;
  setViewMode: (mode: ViewMode) => void;
  setCurrentTable: (table: TableMeta | null) => void;
  setGroupByColumn: (col: string | null) => void;
  setTemplateString: (tpl: string) => void;
}

export const useTableViewerStore = create<TableViewerState>((set) => ({
  viewMode: "table",
  currentTable: null,
  groupByColumn: null,
  templateString: "{*}",
  setViewMode: (mode) => set({ viewMode: mode }),
  setCurrentTable: (table) => set({ currentTable: table }),
  setGroupByColumn: (col) => set({ groupByColumn: col }),
  setTemplateString: (tpl) => set({ templateString: tpl }),
}));
