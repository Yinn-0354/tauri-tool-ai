import { create } from "zustand";

export interface Tab {
  key: string;
  label: string;
  closable: boolean;
}

interface TabState {
  tabs: Tab[];
  activeKey: string;
  openTab: (tab: Tab) => void;
  closeTab: (key: string) => void;
  setActiveKey: (key: string) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeKey: "",

  openTab: (tab) => {
    const { tabs } = get();
    const exists = tabs.find((t) => t.key === tab.key);
    if (!exists) {
      set({ tabs: [...tabs, tab] });
    }
    set({ activeKey: tab.key });
  },

  closeTab: (key) => {
    const { tabs, activeKey } = get();
    const idx = tabs.findIndex((t) => t.key === key);
    const newTabs = tabs.filter((t) => t.key !== key);
    if (activeKey === key && newTabs.length > 0) {
      const next = newTabs[Math.min(idx, newTabs.length - 1)];
      set({ tabs: newTabs, activeKey: next.key });
    } else {
      set({ tabs: newTabs });
    }
  },

  setActiveKey: (key) => set({ activeKey: key }),
}));
