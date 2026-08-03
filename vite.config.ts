import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2: dev 时由 tauri-cli 拉起本 vite dev server(beforeDevCommand),devUrl 见 tauri.conf.json
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 忽略 Rust 构建产物:target/ 里的 dll/pdb 被 MSVC 链接器锁定,
      // Vite fs.watch 撞 EBUSY 会崩 beforeDevCommand(Win + Tauri 经典坑)
      ignored: ["**/src-tauri/target/**"],
    },
  },
});
