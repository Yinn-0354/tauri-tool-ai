import { create } from "zustand";

/** 侧边栏模块标识。"table" = 表格查看器;"checker" = 结果核对器(未实现,禁用态)。 */
export type ModuleId = "table" | "checker";

interface NavState {
  /** 当前激活模块。结果核对器未实现,无法激活,默认永远 table。 */
  active: ModuleId;
  setActive: (m: ModuleId) => void;
}

export const useNavStore = create<NavState>((set) => ({
  active: "table",
  setActive: (m) => set({ active: m }),
}));
