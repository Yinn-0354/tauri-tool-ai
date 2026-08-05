/**
 * 截图 MCP 前端桥:渲染隐藏 AG Grid,监听 Tauri event 执行截图 MCP 的 7 个工具。
 *
 * PRD §4.2:检查器激活时需保持一个隐藏存活的 TableView 实例供 html2canvas 截图,
 * z-index 藏后面(排除 display:none,截出来空白)。
 *
 * 本组件在 App.tsx 的检查器视图下并行挂载,与 CheckerView 并存但被其覆盖。
 * 它不依赖 tableStore/tab 系统,而是直接接后端端点,为截图 MCP 提供独立 AG Grid 实例。
 *
 * 事件协议(PRD §4.4):
 *   Rust MCP → emit screenshot-mcp:request → 本组件执行 → emit screenshot-mcp:response
 *
 * 7 工具:
 *   open_table, get_columns, search_cell, freeze_column, goto_cell,
 *   get_viewport_info, screenshot
 */
import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { AgGridReact } from "@ag-grid-community/react";
import type { ColDef } from "@ag-grid-community/core";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import html2canvas from "html2canvas";
import { buildDatasource } from "./datasource";
import type { TableColumnMeta } from "../store/tableStore";
import { useCheckerStore } from "../store/checkerStore";

/** Rust 发来的 MCP 工具请求载荷。 */
interface McpRequest {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
}

/** 前端回传给 Rust 的 MCP 工具响应。 */
interface McpResponse {
  request_id: string;
  result?: unknown;
  error?: string;
}

interface ScreenshotGridProps {
  backendUrl: string;
}

/** 当前已打开的表状态(null=还没 open_table)。 */
interface TableState {
  tableId: string;
  columns: TableColumnMeta[];
  rowCount: number;
  headerRow: number | null;
  skipRows: number[][];
}

export default function ScreenshotGrid({ backendUrl }: ScreenshotGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  // useState 而非 useRef:open_table 后需触发 React re-render 让 datasource 重建、
  // columnDefs 更新、AG Grid 挂载(HIGH #1)。
  const [tableState, setTableState] = useState<TableState | null>(null);

  // ── 列定义(表打开后才建,行号列 + 数据列) ──
  const columns = tableState?.columns ?? [];
  const columnDefs = useMemo<ColDef[]>(() => {
    if (columns.length === 0) return [];
    const rowNoCol: ColDef = {
      headerName: "#",
      field: "__rowNo",
      pinned: "left",
      width: 56,
      minWidth: 40,
      maxWidth: 80,
      sortable: false,
      resizable: false,
      suppressMovable: true,
      filter: false,
      cellRenderer: rowNoCellRenderer,
    };
    const dataCols: ColDef[] = columns.map((c) => ({
      field: c.name,
      headerName: c.name,
      minWidth: 120,
      resizable: true,
      sortable: true,
    }));
    return [rowNoCol, ...dataCols];
  }, [columns]);

  // ── datasource(tableId 变 → 重建,React re-render 后才生效) ──
  const datasource = useMemo(() => {
    if (!tableState) return null;
    return buildDatasource({
      backendUrl,
      tableId: tableState.tableId,
      rowCount: tableState.rowCount,
      columns: tableState.columns,
      headerRow: tableState.headerRow,
      skipRows: tableState.skipRows,
      frozenCount: 0,
    });
  }, [tableState?.tableId, backendUrl]);

  // ── first data:auto-size 列宽 ──
  const onFirstDataRendered = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const dataColIds = columns.map((c) => c.name);
    api.autoSizeColumns(dataColIds, false);
  }, [columns]);

  // ── 工具执行器 ──
  const handleRequest = useCallback(
    async (req: McpRequest) => {
      const send = (resp: McpResponse) => {
        void emit("screenshot-mcp:response", resp);
      };

      const api = gridRef.current?.api;
      const base = backendUrl.replace(/\/$/, "");
      try {
        switch (req.tool) {
          case "open_table": {
            const tp = (req.args?.table_path as string) ?? "";
            if (!tp) {
              send({ request_id: req.request_id, error: "table_path 为空" });
              return;
            }
            // HIGH #2:table_path 可能纯文件名或相对路径,后端 /api/table/open 只收绝对路径。
            // 先调 /api/checker/resolve-table-path 用 appkey→根映射解析成绝对路径。
            // appkey + branch 从激活标签取(多报告标签页,PRD §12.2/§12.1)。
            // 必须传 branch:配置里 appkeyRoots 的 branch 通常非空(如 (JX3,"trunk")),
            // 不传 branch 默认匹配空分支,会 400 找不到根(截图 404 根因)。
            const st = useCheckerStore.getState();
            const act =
              st.activeReportId != null ? st.tabs[st.activeReportId] ?? null : null;
            const appkey = act?.appkey ?? null;
            const branch = act?.branch ?? "";
            let resolvedPath = tp;
            if (appkey) {
              try {
                const rr = await fetch(`${base}/api/checker/resolve-table-path`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ appkey, table_path: tp, branch }),
                });
                if (rr.ok) {
                  const rd = (await rr.json()) as { resolved: string };
                  if (rd.resolved) resolvedPath = rd.resolved;
                } else {
                  const detail = await rr.text().catch(() => "");
                  // resolve 失败(未配根/找不到表)→ 带明确错误回传,让 Claude 知道并降级
                  send({
                    request_id: req.request_id,
                    error: `open_table 路径解析失败: HTTP ${rr.status}${detail ? ` ${detail}` : ""}`,
                  });
                  return;
                }
              } catch {
                // 网络异常,用原值(可能已是绝对路径),后端 open_table 自己判
              }
            }
            const r = await fetch(`${base}/api/table/open`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: resolvedPath }),
            });
            if (!r.ok) {
              const detail = await r.text().catch(() => "");
              send({ request_id: req.request_id, error: `open_table 失败: HTTP ${r.status}${detail ? ` ${detail}` : ""}` });
              return;
            }
            const d = (await r.json()) as {
              tableId: string;
              rowCount: number;
              columns: TableColumnMeta[];
              headerRow: number | null;
              skipRows: number[][];
            };
            // setState 触发 React re-render,datasource 重建,AG Grid 挂载
            setTableState({
              tableId: d.tableId,
              columns: d.columns,
              rowCount: d.rowCount,
              headerRow: d.headerRow ?? null,
              skipRows: d.skipRows ?? [],
            });
            const idCandidates = d.columns
              .filter(
                (c) =>
                  c.name.toUpperCase().endsWith("ID") ||
                  c.name.includes("id") ||
                  c.name === "编号",
              )
              .map((c) => c.name);
            send({
              request_id: req.request_id,
              result: { columns: d.columns.map((c) => c.name), rowCount: d.rowCount, idColCandidates: idCandidates },
            });
            return;
          }

          case "get_columns": {
            const cols = tableState?.columns.map((c) => c.name) ?? [];
            send({ request_id: req.request_id, result: { columns: cols } });
            return;
          }

          case "search_cell": {
            const query = (req.args?.query as string) ?? "";
            if (!tableState) {
              send({ request_id: req.request_id, error: "表尚未打开" });
              return;
            }
            const r = await fetch(`${base}/api/table/search`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tableId: tableState.tableId,
                query,
                headerRow: tableState.headerRow,
                skipRows: tableState.skipRows,
                limit: 500,
              }),
            });
            if (!r.ok) {
              send({ request_id: req.request_id, error: `search 失败: HTTP ${r.status}` });
              return;
            }
            const d = (await r.json()) as {
              matches: { rowIndex: number; colIndex: number; colName: string; value: string }[];
              total: number;
            };
            send({ request_id: req.request_id, result: { matches: d.matches, total: d.total } });
            return;
          }

          case "freeze_column": {
            const colName = (req.args?.col_name as string) ?? "";
            if (!api) {
              send({ request_id: req.request_id, error: "表尚未打开,请先调 open_table" });
              return;
            }
            const cols = columns.map((c) => c.name);
            const idx = cols.indexOf(colName);
            if (idx < 0) {
              send({ request_id: req.request_id, error: `列 '${colName}' 不存在,可用列: ${cols.join(", ")}` });
              return;
            }
            cols.forEach((c, i) => api.setColumnPinned(c, i <= idx ? "left" : null));
            send({ request_id: req.request_id, result: { ok: true } });
            return;
          }

          case "goto_cell": {
            const rowIndex = (req.args?.row_index as number) ?? 0;
            const colName = (req.args?.col_name as string) ?? undefined;
            if (!api) {
              send({ request_id: req.request_id, error: "表尚未打开" });
              return;
            }
            api.ensureIndexVisible(rowIndex);
            if (colName) {
              const col = api.getColumn(colName);
              if (col) {
                api.ensureColumnVisible(col);
                try { api.setFocusedCell(rowIndex, colName, null); } catch { /* 忽略 */ }
              }
            }
            // MEDIUM #5:轮询等行加载(单次 300ms 可能不够大表首块解析)。
            let cellValue: unknown = null;
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              const rowNode = api.getRowNode(rowIndex.toString());
              if (rowNode?.data) {
                // colName 可能不在数据中(如 __rowNo),取 data 里实际存在的键
                const targetCol = colName && rowNode.data[colName] !== undefined ? colName : undefined;
                cellValue = targetCol ? rowNode.data[targetCol] : null;
                break;
              }
            }
            send({ request_id: req.request_id, result: { ok: true, cellValue } });
            return;
          }

          case "get_viewport_info": {
            if (!api) {
              send({ request_id: req.request_id, error: "表尚未打开" });
              return;
            }
            const displayed = api.getRenderedNodes();
            const visibleRows = displayed.map((n) => ({
              rowIndex: n.rowIndex,
              data: n.data as Record<string, unknown>,
            }));
            const colState = api.getColumnState();
            const visibleCols = colState.filter((c) => !c.hide).map((c) => c.colId);
            const fc = api.getFocusedCell();
            // MEDIUM #4:用 visibleRows[0].rowIndex 而非像素值(getVerticalPixelRange 是像素)
            const topRowIndex = visibleRows.length > 0 ? (visibleRows[0].rowIndex ?? 0) : 0;
            send({
              request_id: req.request_id,
              result: {
                visibleCols,
                visibleRowCount: visibleRows.length,
                visibleRows: visibleRows.slice(0, 30),
                topRowIndex,
                focusedCell: fc ? { rowIndex: fc.rowIndex, column: fc.column.getColId() } : null,
              },
            });
            return;
          }

          case "screenshot": {
            const container = gridContainerRef.current;
            if (!container) {
              send({ request_id: req.request_id, error: "grid 容器不存在" });
              return;
            }
            try {
              const canvas = await html2canvas(
                container.querySelector<HTMLElement>(".ag-root-wrapper") ?? container,
                { backgroundColor: "#0e1113", useCORS: true, scale: 1 },
              );
              const base64 = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
              send({ request_id: req.request_id, result: { imageBase64: base64 } });
            } catch (e: unknown) {
              send({ request_id: req.request_id, error: `截图失败: ${e instanceof Error ? e.message : String(e)}` });
            }
            return;
          }

          default:
            send({ request_id: req.request_id, error: `未知工具: ${req.tool}` });
        }
      } catch (e: unknown) {
        send({ request_id: req.request_id, error: `${req.tool} 执行异常: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [backendUrl, columns, tableState],
  );

  // ── 注册/注销 Tauri event listener ──
  useEffect(() => {
    const unlisten = listen<McpRequest>("screenshot-mcp:request", (event) => {
      void handleRequest(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [handleRequest]);

  // ── 渲染隐藏 AG Grid ──
  return (
    <div
      ref={gridContainerRef}
      className="ag-theme-quartz tt-grid"
      style={{
        position: "absolute",
        zIndex: 0,
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {datasource ? (
        <AgGridReact
          ref={gridRef}
          rowModelType="infinite"
          columnDefs={columnDefs}
          datasource={datasource}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          defaultColDef={{ resizable: true, minWidth: 80, maxWidth: 600 }}
          onFirstDataRendered={onFirstDataRendered}
          pinnedTopRowData={[]}
        />
      ) : (
        <div
          style={{
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            padding: 20,
          }}
        >
          等待 open_table…
        </div>
      )}
    </div>
  );
}

/** 行号列单元格渲染:读 __rowIndex(0-based)+1。 */
function rowNoCellRenderer(params: { data?: { __rowIndex?: number } }) {
  const idx = params.data?.__rowIndex;
  if (idx === undefined || idx === null) return null;
  return (
    <span
      style={{
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        height: "100%",
        width: "100%",
        paddingRight: "8px",
      }}
    >
      {idx + 1}
    </span>
  );
}
