import { create } from "zustand";

/** 主题:dark(Carbon Terminal 深石墨)/ light。 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "tauri-tool-ai-theme";

/** 读初始主题:localStorage 优先,无记录则跟随系统 prefers-color-scheme(浅色→light,否则 dark)。 */
function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage 不可用(隐私模式等),忽略,走系统判定
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/** 把主题应用到 <html data-theme>:CSS 变量据此切换(theme.css 的 [data-theme="light"] 覆盖)。 */
function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

interface ThemeState {
  theme: Theme;
  /** 设置主题并持久化 + 应用到 DOM。 */
  setTheme: (t: Theme) => void;
  /** 在 dark/light 间切换。 */
  toggle: () => void;
}

const initialTheme = readInitialTheme();
// 模块加载即应用,避免 React 挂载前的首帧闪烁(FOUC)。main.tsx 顶部 import 本模块以尽早执行。
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (t) => {
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // 持久化失败不阻断切换
    }
    set({ theme: t });
  },
  toggle: () => {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));
