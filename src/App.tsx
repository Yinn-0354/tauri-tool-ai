import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import AppLayout from "./layouts/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import Loading from "./components/Loading";
import TableViewerModule from "./modules/table-viewer";
import BlameViewerModule from "./modules/blame-viewer";
import AiAgentModule from "./modules/ai-agent";
import { setBaseUrl } from "./api/client";

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (!isTauri) {
      setReady(true);
      return;
    }

    let cancelled = false;
    let attempt = 0;

    async function connect() {
      const { invoke } = await import("@tauri-apps/api/core");
      while (!cancelled && attempt < 60) {
        try {
          const url = await invoke<string>("get_backend_url");
          setBaseUrl(url);
          if (!cancelled) setReady(true);
          return;
        } catch {
          attempt++;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!cancelled) setReady(true); // 超时也继续渲染，让用户看到错误
    }

    connect();
    return () => { cancelled = true; };
  }, []);

  if (!ready) return <Loading />;

  return (
    <ConfigProvider locale={zhCN}>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/table-viewer" element={<TableViewerModule />} />
              <Route path="/blame-viewer" element={<BlameViewerModule />} />
              <Route path="/ai-agent" element={<AiAgentModule />} />
              <Route path="*" element={<Navigate to="/table-viewer" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </ConfigProvider>
  );
}

export default App;
