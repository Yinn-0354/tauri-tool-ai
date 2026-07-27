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
import type {
  ColDef,
  ICellRendererParams,
  CellClassParams,
  CellContextMenuEvent,
} from "@ag-grid-community/core";
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
  // ag-Grid 外层容器(带 tt-grid 类),用于切换 tt-has-frozen-cols 标记类
  const gridContainerRef = useRef<HTMLDivElement>(null);
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
        // 用行数据自带的真实有效行号(0-based),与 ag-Grid rowIndex(冻结后偏移)解耦。
        // pinned 顶部行也带 __rowIndex,搜索命中冻结行时同样高亮。
        const rowIdx = (params.data as { __rowIndex?: number } | undefined)?.__rowIndex;
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
      cellClass: "tt-data-cell", // 数据列标记类:冻结列样式只命中此类的单元格,排除 blame gutter
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

  // 冻结行:用 pinnedTopRowData prop(社区版支持),受控 state。
  // 语义:冻结至此行 = 该行及以上所有行钉在顶部(与「冻结至此列」对称)。
  // 大表下行数过多会卡,设上限保护(超过则不冻,由调用方提示)。
  const FREEZE_ROW_MAX = 200;
  const [pinnedTopRows, setPinnedTopRows] = useState<Record<string, unknown>[]>([]);
  // 已冻结到顶部的行数(= pinnedTopRowData 行数)。datasource 据此偏移跳过已冻结行,
  // blame/高亮/jump 据此把 grid 行号映射回真实数据行号。frozenCount=0 时无偏移,行为同未冻结。
  const frozenCount = pinnedTopRows.length;

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
        frozenCount,
      }),
    [backendUrl, tableId, rowCount, columns, sortCol, sortAsc, headerRow, skipRows, frozenCount]
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

  // 首次数据渲染后,按内容自动适配列宽(只对数据列,排除 __blame pinned gutter)。
  // infinite 模式 autoSize 只基于已加载的行(首块 100 行),给一个合理默认宽;
  // 用户滚动加载更多后不会自动重算,但可双击表头边重新 autoSize 单列(suppressAutoSize:false)。
  const onFirstDataRendered = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const dataColIds = columns.map((c) => c.name);
    api.autoSizeColumns(dataColIds, false);
  }, [columns]);

  // 复制文本到剪贴板(优先 navigator.clipboard,回退 execCommand)
  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 忽略 */
      }
      document.body.removeChild(ta);
    }
  }, []);

  // 列冻结:冻结至此列 = 该列及左边所有数据列 pin 到左侧(其余取消 pin)。
  // 同时给 grid 根元素加 tt-has-frozen-cols 类,CSS 据此给冻结列上底色
  // (blame 列恒在 pinned-left,需此类区分「只有 blame」与「blame+用户冻结列」两种状态)。
  const freezeColumn = useCallback((colId: string) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const dataCols = columns.map((c) => c.name);
    const idx = dataCols.indexOf(colId);
    dataCols.forEach((c, i) => api.setColumnPinned(c, i <= idx ? "left" : null));
    // 给外层容器加 tt-has-frozen-cols,CSS 据此给冻结列(含 blame gutter)上底色
    gridContainerRef.current?.classList.add("tt-has-frozen-cols");
  }, [columns]);

  // 自绘右键菜单状态:右键单元格时记录坐标 + 单元格信息,渲染浮动菜单。
  // ag-Grid 社区版无内置右键菜单(企业版才有),用 onCellContextMenu + 自绘菜单实现。
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    colId: string | null;
    rowIndex: number | null;
    value: string;
  } | null>(null);

  // 行冻结的 state 与 FREEZE_ROW_MAX 已移至 datasource 之前(供 frozenCount 偏移使用)。

  const freezeRow = useCallback(async (rowIndex: number): Promise<boolean> => {
    const api = gridRef.current?.api;
    if (!api) return false;
    if (rowIndex >= FREEZE_ROW_MAX) return false; // 行数过多,调用方提示
    // 拉该行及以上所有行(真实有效行 0..rowIndex),作为 pinnedTopRowData 钉在顶部。
    // 必须带上当前 sortCol/sortAsc,使 pinned 行与数据行同序(排序后冻结也一致)。
    const rows: Record<string, unknown>[] = [];
    const base = backendUrl.replace(/\/$/, "");
    const skipParam = skipRows.length > 0
      ? skipRows.map((s) => `${s[0]}-${s[1]}`).join(",")
      : "";
    let url = `${base}/api/table/data?tableId=${encodeURIComponent(tableId)}&startRow=0&endRow=${rowIndex + 1}`;
    if (sortCol) url += `&sortCol=${encodeURIComponent(sortCol)}&sortAsc=${sortAsc ? 1 : 0}`;
    if (headerRow !== null) url += `&headerRow=${headerRow}`;
    if (skipParam) url += `&skipRows=${encodeURIComponent(skipParam)}`;
    try {
      const resp = await fetch(url);
      const d = (await resp.json()) as { rows: unknown[][] };
      d.rows.forEach((arr, i) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((c, j) => {
          obj[c.name] = arr[j];
        });
        // pinned 行真实有效行号 = 0..rowIndex(与未冻结数据行号一致),
        // 供 blame/高亮/提交详情统一按 __rowIndex 定位。
        obj.__rowIndex = i;
        rows.push(obj);
      });
    } catch {
      return false;
    }
    if (rows.length === 0) return false;
    // setPinnedTopRows -> frozenCount 变 -> datasource 重建并偏移重拉数据行(跳过前 N 行),
    // ag-Grid 收到新 datasource 自动刷新,无需手动 refreshCells。
    setPinnedTopRows(rows);
    return true;
  }, [backendUrl, tableId, headerRow, skipRows, columns, sortCol, sortAsc]);

  // 右键单元格:阻止浏览器原生菜单,记录坐标+单元格信息,渲染自绘菜单(社区版无内置右键菜单)。
  const onCellContextMenu = useCallback((params: CellContextMenuEvent) => {
    const ev = params.event as MouseEvent | undefined;
    ev?.preventDefault();
    const colId = params.column?.getColId() ?? null;
    const isBlame = colId === "__blame";
    setCtxMenu({
      x: ev?.clientX ?? 0,
      y: ev?.clientY ?? 0,
      colId: isBlame ? null : colId,
      rowIndex: params.node?.rowIndex ?? null,
      value: params.value === null || params.value === undefined ? "" : String(params.value),
    });
  }, []);

  // 关闭右键菜单(点菜单项后或点别处)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);


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
    // rowIndex 是真实有效行号(0-based,来自 search 结果);冻结 N 行后 grid 数据行从 N 开始,
    // 故目标 grid 行号 = rowIndex + frozenCount。ensureIndexVisible 据此定位(未加载会触发拉取)。
    const gridRow = rowIndex + frozenCount;
    api.ensureIndexVisible(gridRow);
    // 列跳转:取该列的 colId(列名)。colIndex 相对 columns(不含 blame 列)。
    if (colIndex !== undefined && colIndex >= 0 && colIndex < columns.length) {
      const colName = columns[colIndex].name;
      const col = api.getColumn(colName);
      if (col) {
        api.ensureColumnVisible(col);
        try {
          // setFocusedCell 第三参数 floating 用 null(不浮动);某些行未渲染时可能抛,忽略。
          api.setFocusedCell(gridRow, colName, null);
        } catch {
          // 行未渲染等异常忽略;高亮已由 hits + cellClassRules 提供。
        }
      }
    }
    // 若该行尚未加载,ensureIndexVisible 触发 getRows;加载完后 cellClassRules 重算会高亮。
    gridRef.current?.api?.refreshCells({ force: true });
  }, [columns, frozenCount]);

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

  // 切换文件(tableId 变)时清空冻结行与查找高亮:冻结行/偏移与 __rowIndex 都绑定具体文件,
  // 残留会导致新文件的 datasource 偏移错乱、高亮错位。
  useEffect(() => {
    setPinnedTopRows([]);
    setHits(new Map());
  }, [tableId]);

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
    // 用行数据真实有效行号(0-based),+1 得 blame lineNumber(1-based)。
    // 不能用 node.rowIndex:冻结后数据行 rowIndex 已偏移 frozenCount,pinned 行 rowIndex 语义不稳。
    const dataIdx = (params.data as { __rowIndex?: number } | undefined)?.__rowIndex ?? 0;
    const byLine = params.context?.blameByLine as
      | Map<number, BlameLineInfo>
      | undefined;
    const openFn = params.context?.openCommitDetail as
      | ((rowIndex: number) => void)
      | undefined;
    const info = byLine?.get(dataIdx + 1);
    if (!info) return null as unknown as HTMLElement;
    const color = authorColor(info.author);
    return (
      <span
        style={{ display: "flex", gap: 6, alignItems: "center", height: "100%", width: "100%" }}
        title={`${info.author} @ r${info.revision} · ${info.date} · 点击查看提交详情`}
        onClick={(e) => {
          e.stopPropagation();
          openFn?.(dataIdx);
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
        ref={gridContainerRef}
        className="ag-theme-quartz tt-grid"
        style={{ flex: 1, minHeight: 0, width: "100%" }}
        // 阻止 ag-Grid 区域的浏览器原生右键菜单(自绘菜单由 onCellContextMenu 触发)。
        // 必须在容器原生 contextmenu 事件上 preventDefault,ag-Grid 合成事件的 preventDefault 拦不住原生菜单。
        onContextMenu={(e) => e.preventDefault()}
      >
        <AgGridReact
          ref={gridRef}
          rowModelType="infinite"
          columnDefs={columnDefs}
          datasource={datasource}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          defaultColDef={{
            resizable: true,
            minWidth: 80,
            maxWidth: 600,
            suppressAutoSize: false, // 双击表头边可 autoSize 单列(社区版默认支持)
          }}
          context={{ blameByLine, openCommitDetail }}
          onSortChanged={onSortChanged}
          onFirstDataRendered={onFirstDataRendered}
          onCellContextMenu={onCellContextMenu}
          pinnedTopRowData={pinnedTopRows}
        />
      </div>

      {/* 自绘右键菜单(社区版无内置右键菜单)。点遮罩或菜单项关闭。 */}
      {ctxMenu && (
        <>
          {/* 透明遮罩:点别处关闭菜单 */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1000 }}
            onClick={closeCtxMenu}
            onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }}
          />
          <div
            style={{
              position: "fixed",
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1001,
              minWidth: 160,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              padding: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,.4)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
            }}
          >
            <CtxItem
              label="复制单元格"
              disabled={ctxMenu.value === ""}
              onClick={() => { void copyText(ctxMenu.value); closeCtxMenu(); }}
            />
            {ctxMenu.colId && (
              <>
                <CtxSep />
                <CtxItem label="冻结至此列" onClick={() => { freezeColumn(ctxMenu.colId!); closeCtxMenu(); }} />
              </>
            )}
            {ctxMenu.rowIndex !== null && (
              <>
                <CtxSep />
                <CtxItem
                  label="冻结至此行"
                  onClick={async () => {
                    const ok = await freezeRow(ctxMenu.rowIndex!);
                    if (!ok) {
                      window.alert(
                        ctxMenu.rowIndex! >= 200
                          ? `该行位置过深(${ctxMenu.rowIndex! + 1} 行),冻结至此行仅支持前 200 行`
                          : "冻结至此行失败(拉取数据失败)"
                      );
                    }
                    closeCtxMenu();
                  }}
                />
              </>
            )}
            {ctxMenu.colId && ctxMenu.rowIndex !== null && (
              <>
                <CtxSep />
                <CtxItem
                  label="冻结至此行此列"
                  onClick={async () => {
                    freezeColumn(ctxMenu.colId!);
                    const ok = await freezeRow(ctxMenu.rowIndex!);
                    if (!ok) {
                      window.alert(
                        ctxMenu.rowIndex! >= 200
                          ? `该行位置过深(${ctxMenu.rowIndex! + 1} 行),冻结至此行仅支持前 200 行`
                          : "冻结至此行失败(拉取数据失败)"
                      );
                    }
                    closeCtxMenu();
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

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

/** 右键菜单项 */
function CtxItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "6px 12px",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--text-dim)" : "var(--text)",
        borderRadius: 4,
        ...(disabled ? {} : { ":hover": {} }),
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-panel)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {label}
    </div>
  );
}

function CtxSep() {
  return <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />;
}

export default TableView;
