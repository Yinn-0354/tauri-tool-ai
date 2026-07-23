// 模块顶层注册 ag-Grid 社区版模块 + 引入样式。import 副作用在本文件被引入时执行一次。
import "./agGridSetup";

import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, Layout, Space, Typography, Alert, Spin } from "antd";
import { useTableStore, type TableColumnMeta } from "./store/tableStore";
import TableView from "./grid/TableView";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function App() {
  const backendUrl = useTableStore((s) => s.backendUrl);
  const tableId = useTableStore((s) => s.tableId);
  const rowCount = useTableStore((s) => s.rowCount);
  const columns = useTableStore((s) => s.columns);
  const filePath = useTableStore((s) => s.filePath);
  const status = useTableStore((s) => s.status);
  const error = useTableStore((s) => s.error);
  const loading = useTableStore((s) => s.loading);

  const setBackendUrl = useTableStore((s) => s.setBackendUrl);
  const setTable = useTableStore((s) => s.setTable);
  const setStatus = useTableStore((s) => s.setStatus);
  const setError = useTableStore((s) => s.setError);
  const setLoading = useTableStore((s) => s.setLoading);

  // 握手:取 sidecar 后端地址。沿用现有 App.tsx 的 get_backend_url 写法。
  useEffect(() => {
    invoke<string>("get_backend_url")
      .then((u) => {
        setBackendUrl(u);
        setStatus(`后端: ${u}`);
      })
      .catch((e) => setError(String(e)));
  }, [setBackendUrl, setStatus, setError]);

  // 打开本地文件 -> POST /api/table/open -> 拿 {tableId, rowCount, columns}。
  // 只存元信息到 store,绝不在前端拉全表数据。
  const handleOpen = useCallback(async () => {
    if (!backendUrl) {
      setError("后端地址尚未就绪");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
      });
      // openDialog 在用户取消时返回 null(单选)。
      if (selected === null) {
        setLoading(false);
        return;
      }
      const path = selected;
      const base = backendUrl.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/table/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as {
        tableId: string;
        rowCount: number;
        columns: TableColumnMeta[];
      };
      setTable({
        tableId: data.tableId,
        rowCount: data.rowCount,
        columns: data.columns,
        filePath: path,
      });
      setStatus(
        `已打开 ${path} · ${data.rowCount.toLocaleString()} 行 · ${data.columns.length} 列`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [backendUrl, setTable, setStatus, setError, setLoading]);

  const ready = backendUrl !== null && tableId !== null && rowCount !== null;

  return (
    <Layout style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 16,
        }}
      >
        <Title level={4} style={{ color: "#fff", margin: 0 }}>
          配置表检查工具 · 表格查看器
        </Title>
        <Space>
          <Button type="primary" onClick={handleOpen} loading={loading}>
            打开表格
          </Button>
        </Space>
        <div style={{ marginLeft: "auto", overflow: "hidden" }}>
          <Text
            style={{
              color: "#eee",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              display: "inline-block",
              maxWidth: "60vw",
            }}
            title={filePath ?? status}
          >
            {status || (backendUrl ? "就绪" : "正在连接后端…")}
          </Text>
        </div>
      </Header>

      {error && (
        <Alert
          type="error"
          message={error}
          banner
          closable
          onClose={() => setError(null)}
        />
      )}

      <Content
        style={{
          flex: 1,
          minHeight: 0,
          padding: 8,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!ready ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Spin
              tip={backendUrl ? "点击「打开表格」选择本地文件" : "等待后端…"}
              size="large"
            />
          </div>
        ) : (
          <TableView
            backendUrl={backendUrl!}
            tableId={tableId!}
            rowCount={rowCount!}
            columns={columns}
          />
        )}
      </Content>
    </Layout>
  );
}
