import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2: dev 时由 tauri-cli 拉起本 vite dev server(beforeDevCommand),devUrl 见 tauri.conf.json
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
});
