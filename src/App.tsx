import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, Typography, Spin, Alert } from "antd";

const { Title } = Typography;

// 最小闭环:调 Rust 的 get_backend_url 拿 sidecar 地址 → 调 /api/health 显示 hello
export default function App() {
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    invoke<string>("get_backend_url")
      .then((u) => {
        setBackendUrl(u);
        return fetch(`${u}/api/health`);
      })
      .then((r) => r.text())
      .then((t) => setHealth(t))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>配置表检查工具</Title>
      <Card>
        <p>Backend URL: {backendUrl ?? <Spin size="small" />}</p>
        <p>Health: {health || "…"}</p>
        {error && <Alert type="error" message={error} />}
      </Card>
    </div>
  );
}
