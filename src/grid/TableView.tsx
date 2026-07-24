import {
  useMemo,
  useRef,
  useCallback,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { AgGridReact } from "@ag-grid-community/react";
import type { ColDef, ICellRendererParams, CellClassParams } from "@ag-grid-community/core";
import { buildDatasource } from "./datasource";
import { fetchBlame, authorColor, type BlameLineInfo } from "./blame";
import type { TableColumnMeta } from "../store/tableStore";
import { useTableStore } from "../store/tableStore";
import CommitDetailModal from "../components/CommitDetailModal";

interface TableViewProps {
  backendUrl: string;
  tableId: string;
  rowCount: number;
  columns: TableColumnMeta[];
  filePath: string;
  /** 表头行(1-based,null=自动)。透传给 datasource/search。 */
  headerRow: number | null;
  /** 跳过行段列表,1-based 闭区间。透传给 datasource/search。 */
  skipRows: number[][];
  /** blame 是否已加载(决定 gutter 列是否出现)。来自 store。 */
  blameLoaded: boolean;
}

/** 查找命中条目(后端返回结构)。 */
interface SearchMatch {
  rowIndex: number; // 0-based,剔除跳过行后
  colIndex: number;
  colName: string;
  value: string;
}

/** 暴露给父组件(App)的 imperative API。 */
export interface TableViewHandle {
  /** 触发 svn blame 全量拉取,更新 store 状态 + 刷新 gutter。 */
  loadBlame: () => void;
  /** 导出当前表格为 CSV(ag-Grid CsvExportModule)。 */
  exportCsv: () => void;
  /** 全表查找(应用当前 skipRows/headerRow)。返回命中列表 + total。 */
  search: (query: string) => Promise<{ matches: SearchMatch[]; total: number }>;
  /** 跳转到指定 rowIndex/colIndex(infinite 会自动触发未加载行拉取)。 */
  jumpTo: (rowIndex: number, colIndex?: number) => void;
}

/**
 * ag-Grid Infinite Row Model 容器(Carbon Terminal 主题)。
 *
 * 关键约束(需求7:只允许 ag-Grid 内部滚动):
 * - 根容器 height:100% + overflow:hidden,绝不产生页面级/容器级多余滚动条。
 * - 已删除「blame 已加载 · N 行」那行独立小字(blame 状态移至工具栏)。
 *
 * 需求5:移除 rowSelection,不要选择器列。
 * 需求4:gutter 单元格点击 → 打开 CommitDetailModal。
 * 需求6:容器 className="ag-theme-quartz tt-grid",纵向线由 theme.css 覆盖。
 *
 * 查找高亮:命中单元格用 cellClassRules 加 tt-hit 类(theme.css 定义)。
 * 跳转:infinite 模式 ensureIndexVisible(rowIndex);若该行未加载,ag-Grid 会触发 getRows 拉取。
 */
const TableView = forwardRef<TableViewHandle, TableViewProps>(function TableView(
  {
    backendUrl,
    tableId,
    rowCount,
    columns,
    filePath,
    headerRow,
    skipRows,
    blameLoaded,
  },
  ref
) {
  const gridRef = useRef<AgGridReact>(null);
  const [blameByLine, setBlameByLine] = useState<Map<number, BlameLineInfo>>(
    () => new Map()
  );

  // 服务端排序状态:点列头切换。社区版 infinite 不自动透传,手动重设 datasource 触发重拉。
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // CommitDetailModal 状态
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRevision, setModalRevision] = useState<string | null>(null);

  // 查找命中:rowIndex → 命中列集合(用 Set 便于 cellClassRules 判定)。
  const [hits, setHits] = useState<Map<number, Set<number>>>(() => new Map());

  // store:blame 状态(由 Toolbar 触发,此处执行 + 写回)
  const setBlame = useTableStore((s) => s.setBlame);
  const setBlameLoading = useTableStore((s) => s.setBlameLoading);

  // 命中单元格 class 规则:行命中且该列命中 → 加 tt-hit。blame gutter 列(__blame)永远不高亮。
  const cellClassRules = useMemo(
    () => ({
      "tt-hit": (params: CellClassParams) => {
        const rowIdx = params.node?.rowIndex;
        if (rowIdx === undefined || rowIdx === null) return false;
        const colSet = hits.get(rowIdx);
        if (!colSet) return false;
        // 用列 field(= 列名)反查 colIndex。columnDefs 顺序与 columns 一致,field=colName。
        const colField = params.colDef?.field;
        if (!colField) return false;
        // __blame 列不参与高亮
        if (colField === "__blame") return false;
        const colIdx = columns.findIndex((c) => c.name === colField);
        if (colIdx < 0) return false;
        return colSet.has(colIdx);
      },
    }),
    [hits, columns]
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const dataCols: ColDef[] = columns.map((c) => ({
      field: c.name,
      headerName: c.name,
      minWidth: 120,
      resizable: true,
      sortable: true, // 开启排序 UI;实际排序由 onSortChanged 拦截走后端(社区版 infinite 不自动透传)
      cellClassRules,
    }));
    if (blameLoaded) {
      const blameCol: ColDef = {
        headerName: "Blame",
        field: "__blame",
        pinned: "left",
        width: 180,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: blameCellRenderer,
        cellClass: "tt-blame-cell",
      };
      return [blameCol, ...dataCols];
    }
    return dataCols;
  }, [columns, blameLoaded, cellClassRules]);

  const datasource = useMemo(
    () =>
      buildDatasource({
        backendUrl,
        tableId,
        rowCount,
        columns,
        sortCol,
        sortAsc,
        headerRow,
        skipRows,
      }),
    [backendUrl, tableId, rowCount, columns, sortCol, sortAsc, headerRow, skipRows]
  );

  // ag-Grid 列头排序变化:infinite 模式下需手动把排序状态转成 sortCol/sortAsc 并重设 datasource。
  // 取第一个有 sort 的列(单列排序)。getColumnState 每列含 sort: 'asc'|'desc'|null。
  const onSortChanged = useCallback(() => {
    const cols = gridRef.current?.api?.getColumnState() ?? [];
    const sorted = cols.find((c) => c.sort);
    if (sorted) {
      setSortCol(sorted.colId);
      setSortAsc(sorted.sort === "asc");
    } else {
      setSortCol(null);
      setSortAsc(true);
    }
    // datasource 因 sortCol/sortAsc 变化而重建(useMemo 依赖),ag-Grid 检测到新 datasource 会自动刷新。
  }, []);

  // 全量 blame:拉一次,按 lineNumber 缓存到组件 state + 写回 store 元信息。
  const loadBlame = useCallback(async () => {
    if (!filePath) return;
    setBlameLoading(true);
    try {
      const rows = await fetchBlame(backendUrl, filePath, "BASE");
      const m = new Map<number, BlameLineInfo>();
      for (const r of rows) m.set(r.lineNumber, r);
      setBlameByLine(m);
      setBlame({ loaded: true, count: rows.length, error: null });
      // 刷新已渲染行的 blame 列,触发 cellRenderer 重算
      gridRef.current?.api?.refreshCells({ force: true, columns: ["__blame"] });
    } catch (e) {
      setBlame({
        loaded: false,
        count: 0,
        error: String(e instanceof Error ? e.message : e),
      });
    } finally {
      setBlameLoading(false);
    }
  }, [backendUrl, filePath, setBlame, setBlameLoading]);

  const exportCsv = useCallback(() => {
    gridRef.current?.api?.exportDataAsCsv();
  }, []);

  // 全表查找:POST /api/table/search,带 tableId + 当前 skipRows/headerRow。
  // 返回命中列表 + total;同时存 hits 状态用于高亮。
  const search = useCallback(
    async (query: string): Promise<{ matches: SearchMatch[]; total: number }> => {
      const base = backendUrl.replace(/\/$/, "");
      const resp = await fetch(`${base}/api/table/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          query,
          limit: 1000,
          // 透传当前配置,后端按剔除跳过行后的数据行序号返回 rowIndex。
          headerRow,
          skipRows,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as {
        matches: SearchMatch[];
        total: number;
      };
      // 存命中:rowIndex → Set<colIndex>
      const m = new Map<number, Set<number>>();
      for (const hit of data.matches) {
        let colSet = m.get(hit.rowIndex);
        if (!colSet) {
          colSet = new Set<number>();
          m.set(hit.rowIndex, colSet);
        }
        colSet.add(hit.colIndex);
      }
      setHits(m);
      // 触发已加载行重绘以应用 tt-hit 类。
      gridRef.current?.api?.refreshCells({ force: true });
      return data;
    },
    [backendUrl, tableId, headerRow, skipRows]
  );

  // 跳转到指定行/列。infinite 模式下 ensureIndexVisible 会自动拉取未加载块。
  // setFocusedCell 给键盘焦点(需指定 colId);refreshCells 确保高亮已渲染。
  const jumpTo = useCallback((rowIndex: number, colIndex?: number) => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.ensureIndexVisible(rowIndex);
    // 列跳转:取该列的 colId(列名)。colIndex 相对 columns(不含 blame 列)。
    if (colIndex !== undefined && colIndex >= 0 && colIndex < columns.length) {
      const colName = columns[colIndex].name;
      const col = api.getColumn(colName);
      if (col) {
        api.ensureColumnVisible(col);
        try {
          // setFocusedCell 第三参数 floating 用 null(不浮动);某些行未渲染时可能抛,忽略。
          api.setFocusedCell(rowIndex, colName, null);
        } catch {
          // 行未渲染等异常忽略;高亮已由 hits + cellClassRules 提供。
        }
      }
    }
    // 若该行尚未加载,ensureIndexVisible 触发 getRows;加载完后 cellClassRules 重算会高亮。
    gridRef.current?.api?.refreshCells({ force: true });
  }, [columns]);

  useImperativeHandle(
    ref,
    () => ({ loadBlame, exportCsv, search, jumpTo }),
    [loadBlame, exportCsv, search, jumpTo]
  );

  // blameLoaded 由 store 驱动(Toolbar 触发 loadBlame → store blameLoaded=true → 本组件列出现)
  // 切换文件时 store 会清 blame,这里无需额外 effect。
  useEffect(() => {
    if (!blameLoaded) setBlameByLine(new Map());
  }, [blameLoaded]);

  // 打开提交详情 Modal:从 blameByLine 取该行 revision
  const openCommitDetail = useCallback(
    (rowIndex: number) => {
      const info = blameByLine.get(rowIndex + 1);
      if (info) {
        setModalRevision(info.revision);
        setModalOpen(true);
      }
    },
    [blameByLine]
  );

  /** blame gutter 单元格渲染:作者@rev,按作者染色;点击打开 CommitDetailModal。 */
  function blameCellRenderer(params: ICellRendererParams) {
    const idx = params.node?.rowIndex; // 0-based;blame lineNumber 是 1-based
    const byLine = params.context?.blameByLine as
      | Map<number, BlameLineInfo>
      | undefined;
    const openFn = params.context?.openCommitDetail as
      | ((rowIndex: number) => void)
      | undefined;
    const info = byLine?.get((idx ?? 0) + 1);
    if (!info) return null as unknown as HTMLElement;
    const color = authorColor(info.author);
    return (
      <span
        style={{ display: "flex", gap: 6, alignItems: "center", height: "100%", width: "100%" }}
        title={`${info.author} @ r${info.revision} · ${info.date} · 点击查看提交详情`}
        onClick={(e) => {
          e.stopPropagation();
          openFn?.(idx ?? 0);
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flex: "0 0 auto",
          }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {info.author}
          <span style={{ color: "var(--text-dim)" }}> @{info.revision}</span>
        </span>
      </span>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", position: "relative" }}>
      <div
        className="ag-theme-quartz tt-grid"
        style={{ flex: 1, minHeight: 0, width: "100%" }}
      >
        <AgGridReact
          ref={gridRef}
          rowModelType="infinite"
          columnDefs={columnDefs}
          datasource={datasource}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          defaultColDef={{ resizable: true }}
          context={{ blameByLine, openCommitDetail }}
          onSortChanged={onSortChanged}
        />
      </div>

      <CommitDetailModal
        open={modalOpen}
        backendUrl={backendUrl}
        path={filePath}
        revision={modalRevision}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
});

export default TableView;
