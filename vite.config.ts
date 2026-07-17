import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import os from "os";
import type { ProxyOptions } from "vite";

function readBackendTarget() {
  const portFile = path.join(os.tmpdir(), "tauri-tool-ai-port.txt");
  try {
    const port = fs.readFileSync(portFile, "utf-8").trim();
    if (/^\d+$/.test(port)) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // 后端尚未启动时由 proxy.bypass 返回 503
  }
  return null;
}

const apiProxy: ProxyOptions = {
  target: "http://127.0.0.1:1",
  changeOrigin: true,
  configure(proxy, options) {
    proxy.on("proxyReq", (proxyReq) => {
      const target = readBackendTarget();
      if (!target) return;
      options.target = target;
      const url = new URL(target);
      proxyReq.setHeader("host", url.host);
    });
    proxy.on("error", (err) => {
      console.error("[vite] proxy error:", err.message);
    });
  },
  bypass(_req, res, options) {
    const target = readBackendTarget();
    if (!target) {
      if (res) {
        res.statusCode = 503;
        res.end("Python backend is not ready");
      }
      return false;
    }
    options.target = target;
    return undefined;
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": apiProxy,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
