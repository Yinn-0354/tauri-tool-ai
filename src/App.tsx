import "./agGridSetup"; // 注册 ag-Grid 模块 + 引入样式 + theme.css + 字体

import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ConfigProvider, theme as antdTheme, App as AntApp } from "antd";
import { useTableStore, type TableColumnMeta } from "./store/tableStore";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import EmptyState from "./components/EmptyState";
import TableView, { type TableViewHandle } from "./grid/TableView";

/**
 * Carbon Terminal 主题根布局。
 *
 * 结构:Sidebar(56px) + 右侧内容区(flex 列:Toolbar 44px + 主区 flex 1)。
 * 铁律(需求7):根容器 100vh + overflow:hidden,所有外层 overflow:hidden + min-height:0,
 * 仅 ag-Grid 内部滚动。
 */
export default function App() {
  const backendUrl = useTableStore((s) => s.backendUrl);
  const tableId = useTableStore((s) => s.tableId);
  const rowCount = useTableStore((s) => s.rowCount);
  const columns = useTableStore((s) => s.columns);
  const filePath = useTableStore((s) => s.filePath);
  const loading = useTableStore((s) => s.loading);
  const error = useTableStore((s) => s.error);
  const blameLoaded = useTableStore((s) => s.blameLoaded);

  const setBackendUrl = useTableStore((s) => s.setBackendUrl);
  const setTable = useTableStore((s) => s.setTable);
  const setStatus = useTableStore((s) => s.setStatus);
  const setError = useTableStore((s) => s.setError);
  const setLoading = useTableStore((s) => s.setLoading);

  const tableViewRef = useRef<TableViewHandle>(null);

  // 握手:取 sidecar 后端地址。
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

  const handleFetchBlame = useCallback(() => {
    tableViewRef.current?.loadBlame();
  }, []);

  const handleExportCsv = useCallback(() => {
    tableViewRef.current?.exportCsv();
  }, []);

  const ready = backendUrl !== null && tableId !== null && rowCount !== null;

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: "#c8e663",
          colorBgBase: "#0e1113",
          colorTextBase: "#e7eaec",
          fontFamily:
            '"IBM Plex Sans","PingFang SC","Microsoft YaHei",sans-serif',
          borderRadius: 6,
        },
      }}
    >
      <AntApp style={{ height: "100%" }}>
        <div
          style={{
            height: "100vh",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <Sidebar />

          {/* 右侧内容区 */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Toolbar
              onOpen={handleOpen}
              onFetchBlame={handleFetchBlame}
              onExportCsv={handleExportCsv}
              opening={loading}
            />

            {/* 顶部 2px 进度条:仅在打开解析中(loading)显示,不阻断布局,不产生额外滚动条 */}
            {loading && (
              <div
                style={{
                  height: 2,
                  flex: "0 0 2px",
                  background: "var(--accent)",
                  boxShadow: "0 0 8px var(--accent)",
                }}
              />
            )}

            {/* error 横幅:固定高度,不撑高 */}
            {error && (
              <div
                style={{
                  flex: "0 0 auto",
                  background: "rgba(255,107,107,.12)",
                  color: "var(--danger)",
                  borderBottom: "1px solid var(--border)",
                  padding: "6px 12px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {error}
                </span>
                <button
                  onClick={() => setError(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--danger)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  关闭
                </button>
              </div>
            )}

            {/* 主区:flex 1 + min-height:0 + overflow:hidden,仅 ag-Grid 内部滚动 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                background: "var(--bg)",
              }}
            >
              {ready ? (
                <TableView
                  ref={tableViewRef}
                  backendUrl={backendUrl!}
                  tableId={tableId!}
                  rowCount={rowCount!}
                  columns={columns}
                  filePath={filePath!}
                  blameLoaded={blameLoaded}
                />
              ) : (
                <EmptyState onOpen={handleOpen} loading={loading} />
              )}
            </div>
          </div>
        </div>
      </AntApp>
    </ConfigProvider>
  );
}
