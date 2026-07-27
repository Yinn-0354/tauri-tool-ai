import "./agGridSetup"; // 注册 ag-Grid 模块 + 引入样式 + theme.css + 字体

import { useEffect, useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ConfigProvider, theme as antdTheme, App as AntApp } from "antd";
import { useTableStore, type TableColumnMeta } from "./store/tableStore";
import { useThemeStore } from "./store/themeStore";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import EmptyState from "./components/EmptyState";
import TableView, { type TableViewHandle } from "./grid/TableView";
import OpenConfigModal, { type TableOpenConfig } from "./components/OpenConfigModal";

/**
 * Carbon Terminal 主题根布局。
 *
 * 结构:Sidebar(56px) + 右侧内容区(flex 列:Toolbar 44px + 主区 flex 1)。
 * 铁律(需求7):根容器 100vh + overflow:hidden,所有外层 overflow:hidden + min-height:0,
 * 仅 ag-Grid 内部滚动。
 *
 * 打开文件流程:openDialog → GET /api/table/config 预填 → OpenConfigModal →
 * POST /api/table/open(带 headerRow/skipRows)+ POST /api/table/config(记忆)→ setTable + setHeaderSkip。
 */
export default function App() {
  const backendUrl = useTableStore((s) => s.backendUrl);
  const tableId = useTableStore((s) => s.tableId);
  const rowCount = useTableStore((s) => s.rowCount);
  const columns = useTableStore((s) => s.columns);
  const filePath = useTableStore((s) => s.filePath);
  const headerRow = useTableStore((s) => s.headerRow);
  const skipRows = useTableStore((s) => s.skipRows);
  const loading = useTableStore((s) => s.loading);
  const error = useTableStore((s) => s.error);
  const blameLoaded = useTableStore((s) => s.blameLoaded);

  const setBackendUrl = useTableStore((s) => s.setBackendUrl);
  const setTable = useTableStore((s) => s.setTable);
  const setStatus = useTableStore((s) => s.setStatus);
  const setError = useTableStore((s) => s.setError);
  const setLoading = useTableStore((s) => s.setLoading);

  const tableViewRef = useRef<TableViewHandle>(null);

  // OpenConfigModal 状态
  const [configOpen, setConfigOpen] = useState(false);
  const [configPath, setConfigPath] = useState<string>("");
  const [configInitial, setConfigInitial] = useState<TableOpenConfig | null>(null);

  // 握手:取 sidecar 后端地址。
  useEffect(() => {
    invoke<string>("get_backend_url")
      .then((u) => {
        setBackendUrl(u);
        setStatus(`后端: ${u}`);
      })
      .catch((e) => setError(String(e)));
  }, [setBackendUrl, setStatus, setError]);

  // 真正执行打开:带 headerRow/skipRows 调 POST /api/table/open,再 POST /api/table/config 记忆。
  const doOpen = useCallback(
    async (path: string, cfg: TableOpenConfig) => {
      if (!backendUrl) {
        setError("后端地址尚未就绪");
        return;
      }
      const base = backendUrl.replace(/\/$/, "");
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${base}/api/table/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path,
            headerRow: cfg.headerRow,
            skipRows: cfg.skipRows,
          }),
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
          headerRow: cfg.headerRow,
          skipRows: cfg.skipRows,
        });
        setStatus(
          `已打开 ${path} · ${data.rowCount.toLocaleString()} 行 · ${data.columns.length} 列`,
        );
        // 记忆配置(失败不阻断打开)。
        try {
          await fetch(`${base}/api/table/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path,
              headerRow: cfg.headerRow,
              skipRows: cfg.skipRows,
            }),
          });
        } catch {
          // 记忆失败不影响打开,忽略。
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [backendUrl, setTable, setStatus, setError, setLoading]
  );

  // 打开本地文件:openDialog → GET /api/table/config 预填 → 弹 OpenConfigModal。
  const handleOpen = useCallback(async () => {
    if (!backendUrl) {
      setError("后端地址尚未就绪");
      return;
    }
    setError(null);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
      });
      // openDialog 在用户取消时返回 null(单选)。
      if (selected === null) {
        return;
      }
      const path = selected;
      // 拉取已记忆配置预填(失败按无记录处理,不阻断)。
      const base = backendUrl.replace(/\/$/, "");
      let initial: TableOpenConfig | null = null;
      try {
        const resp = await fetch(
          `${base}/api/table/config?path=${encodeURIComponent(path)}`
        );
        if (resp.ok) {
          const cfg = (await resp.json()) as {
            headerRow: number | null;
            skipRows: number[][];
          };
          initial = { headerRow: cfg.headerRow, skipRows: cfg.skipRows };
        }
      } catch {
        // 忽略,用默认 null/[]。
      }
      setConfigPath(path);
      setConfigInitial(initial);
      setConfigOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }, [backendUrl, setError]);

  // OpenConfigModal 提交(用户配置好后真正打开)。
  const onConfigSubmit = useCallback(
    (cfg: TableOpenConfig) => {
      setConfigOpen(false);
      void doOpen(configPath, cfg);
    },
    [doOpen, configPath]
  );

  // OpenConfigModal 跳过配置直接打开(用 initial 或默认 null/[])。
  const onConfigSkip = useCallback(() => {
    setConfigOpen(false);
    const cfg: TableOpenConfig = {
      headerRow: configInitial?.headerRow ?? null,
      skipRows: configInitial?.skipRows ?? [],
    };
    void doOpen(configPath, cfg);
  }, [doOpen, configPath, configInitial]);

  const onConfigCancel = useCallback(() => {
    setConfigOpen(false);
  }, []);

  const handleFetchBlame = useCallback(() => {
    tableViewRef.current?.loadBlame();
  }, []);

  const handleExportCsv = useCallback(() => {
    tableViewRef.current?.exportCsv();
  }, []);

  // 查找:调 tableViewRef.current.search(query)。
  const handleSearch = useCallback(
    async (query: string) => {
      return tableViewRef.current?.search(query) ?? { matches: [], total: 0 };
    },
    []
  );

  // 跳转:调 tableViewRef.current.jumpTo(rowIndex, colIndex)。
  const handleJumpTo = useCallback((rowIndex: number, colIndex: number) => {
    tableViewRef.current?.jumpTo(rowIndex, colIndex);
  }, []);

  // 一键清空冻结(列+行):调 tableViewRef.current.clearAllFrozen()。
  const handleClearFrozen = useCallback(() => {
    tableViewRef.current?.clearAllFrozen();
  }, []);

  const ready = backendUrl !== null && tableId !== null && rowCount !== null;

  // 主题:驱动 antd ConfigProvider 的 algorithm + token(CSS 变量由 themeStore 模块副作用应用到 <html>)。
  const theme = useThemeStore((s) => s.theme);
  // antd token 不吃 CSS 变量字符串,需在 JS 维护两套与 theme.css 对齐。字体/圆角跨主题不变。
  const antdToken =
    theme === "light"
      ? { colorPrimary: "#7da630", colorBgBase: "#ffffff", colorTextBase: "#1a1f23" }
      : { colorPrimary: "#c8e663", colorBgBase: "#0e1113", colorTextBase: "#e7eaec" };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme === "light" ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
        token: {
          ...antdToken,
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
              onSearch={handleSearch}
              onJumpTo={handleJumpTo}
              onClearFrozen={handleClearFrozen}
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
                  headerRow={headerRow}
                  skipRows={skipRows}
                  blameLoaded={blameLoaded}
                />
              ) : (
                <EmptyState onOpen={handleOpen} loading={loading} />
              )}
            </div>
          </div>
        </div>

        {/* 打开文件前的表格配置弹窗 */}
        <OpenConfigModal
          open={configOpen}
          path={configPath}
          initial={configInitial}
          onSubmit={onConfigSubmit}
          onSkip={onConfigSkip}
          onCancel={onConfigCancel}
        />
      </AntApp>
    </ConfigProvider>
  );
}
