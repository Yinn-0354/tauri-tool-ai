import { useMemo, useRef, useCallback, useEffect, useState } from "react";
import { AgGridReact } from "@ag-grid-community/react";
import type { ColDef, ICellRendererParams } from "@ag-grid-community/core";
import { buildDatasource } from "./datasource";
import { fetchBlame, authorColor, type BlameLineInfo } from "./blame";
import type { TableColumnMeta } from "../store/tableStore";

interface TableViewProps {
  backendUrl: string;
  tableId: string;
  rowCount: number;
  columns: TableColumnMeta[];
  filePath: string;
  blameEnabled: boolean;
}

/** blame gutter 单元格渲染:显示 `作者@rev`,按作者染色。 */
function blameCellRenderer(params: ICellRendererParams) {
  const idx = params.node?.rowIndex; // 0-based;blame lineNumber 是 1-based
  const blameByLine = params.context?.blameByLine as
    | Map<number, BlameLineInfo>
    | undefined;
  const info = blameByLine?.get((idx ?? 0) + 1);
  if (!info) return "";
  const color = authorColor(info.author);
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center", height: "100%" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flex: "0 0 auto",
        }}
        title={`${info.author} @ r${info.revision} · ${info.date}`}
      />
      <span style={{ color: "#666", fontSize: 12 }}>
        {info.author} <span style={{ color: "#aaa" }}>@{info.revision}</span>
      </span>
    </span>
  );
}

/**
 * ag-Grid Infinite Row Model 容器。
 * - rowModelType="infinite":社区版支持的 canvas 虚拟化模型,适配百万行。
 * - datasource 由 buildDatasource 生成,只在 getRows 回调里按视口拉分块。
 * - blame 开关:开启后最左加 pinned gutter 列,显示每行 svn blame 作者。
 *   blame 全量拉取一次并按 lineNumber 缓存到 grid context,按行号对齐渲染。
 */
export default function TableView({
  backendUrl,
  tableId,
  rowCount,
  columns,
  filePath,
  blameEnabled,
}: TableViewProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [blameByLine, setBlameByLine] = useState<Map<number, BlameLineInfo>>(
    () => new Map()
  );
  const [blameError, setBlameError] = useState<string | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);

  const columnDefs = useMemo<ColDef[]>(() => {
    const dataCols: ColDef[] = columns.map((c) => ({
      field: c.name,
      headerName: c.name,
      minWidth: 120,
      resizable: true,
      sortable: false, // 社区版 infinite 不支持服务端排序透传,先禁用排序 UI
    }));
    if (blameEnabled) {
      const blameCol: ColDef = {
        headerName: "Blame",
        field: "__blame",
        pinned: "left",
        width: 180,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: blameCellRenderer,
      };
      return [blameCol, ...dataCols];
    }
    return dataCols;
  }, [columns, blameEnabled]);

  const datasource = useMemo(
    () => buildDatasource({ backendUrl, tableId, rowCount, columns }),
    [backendUrl, tableId, rowCount, columns]
  );

  // 开启 blame 时拉一次全量 blame(后端已 LRU 缓存,重复打开不重跑),按 lineNumber 存 Map
  const loadBlame = useCallback(async () => {
    if (!filePath) return;
    setBlameLoading(true);
    setBlameError(null);
    try {
      const rows = await fetchBlame(backendUrl, filePath, "BASE");
      const m = new Map<number, BlameLineInfo>();
      for (const r of rows) m.set(r.lineNumber, r);
      setBlameByLine(m);
      // 刷新已渲染行的 blame 列,触发 cellRenderer 重算
      gridRef.current?.api?.refreshCells({ force: true, columns: ["__blame"] });
    } catch (e) {
      setBlameError(String(e instanceof Error ? e.message : e));
    } finally {
      setBlameLoading(false);
    }
  }, [backendUrl, filePath]);

  useEffect(() => {
    if (blameEnabled) {
      loadBlame();
    } else {
      setBlameByLine(new Map());
    }
  }, [blameEnabled, loadBlame]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {blameEnabled && (
        <div style={{ fontSize: 12, color: "#888", padding: "2px 4px" }}>
          {blameLoading
            ? "正在获取 svn blame(大文件可能较慢)…"
            : blameError
              ? `blame 失败:${blameError}`
              : `blame 已加载 · ${blameByLine.size} 行`}
        </div>
      )}
      <div
        className="ag-theme-quartz"
        style={{ width: "100%", height: "100%", minHeight: 0 }}
      >
        <AgGridReact
          ref={gridRef}
          rowModelType="infinite"
          columnDefs={columnDefs}
          datasource={datasource}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          rowSelection={{ mode: "singleRow" }}
          defaultColDef={{ resizable: true }}
          context={{ blameByLine }}
        />
      </div>
    </div>
  );
}
