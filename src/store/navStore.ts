import { create } from "zustand";

/** 侧边栏模块标识。"table" = 表格查看器;"checker" = 结果核对器(未实现,禁用态)。 */
export type ModuleId = "table" | "checker";

interface NavState {
  /** 当前激活模块。结果核对器未实现,无法激活,默认永远 table。 */
  active: ModuleId;
  setActive: (m: ModuleId) => void;
  /** 配置检查器全局设置弹窗开关(Sidebar 齿轮触发,App 层挂弹窗)。 */
  checkerSettingsOpen: boolean;
  setCheckerSettingsOpen: (v: boolean) => void;
  /** 环境变更版本号:每次设置保存后自增,CheckerView 监听它重拉 envBadge。 */
  envVersion: number;
  bumpEnvVersion: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  active: "table",
  setActive: (m) => set({ active: m }),
  checkerSettingsOpen: false,
  setCheckerSettingsOpen: (v) => set({ checkerSettingsOpen: v }),
  envVersion: 0,
  bumpEnvVersion: () => set((s) => ({ envVersion: s.envVersion + 1 })),
}));
