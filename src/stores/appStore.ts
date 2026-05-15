import { create } from "zustand";

interface AppState {
  backendPort: number | null;
  backendUrl: string | null;
  isConnected: boolean;
  setBackendPort: (port: number) => void;
  setBackendUrl: (url: string) => void;
  setConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  backendPort: null,
  backendUrl: null,
  isConnected: false,
  setBackendPort: (port) =>
    set({ backendPort: port, backendUrl: `http://127.0.0.1:${port}` }),
  setBackendUrl: (url) => set({ backendUrl: url }),
  setConnected: (connected) => set({ isConnected: connected }),
}));
