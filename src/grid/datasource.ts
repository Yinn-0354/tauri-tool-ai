import type { IDatasource, IGetRowsParams } from "@ag-grid-community/core";
import type { TableColumnMeta } from "../store/tableStore";

/**
 * ag-Grid Infinite Row Model 的 datasource 构造器。
 *
 * ag-Grid Infinite 模式按需回调 getRows(params):前端只把每次可见区块的
 * params.startRow/params.endRow 透传给 GET /api/table/data,取回当前区块(默认 100 行)。
 * 后端基于 Parquet 的 lazy scan + slice 分块读取,只在需要时取行。
 *
 * successCallback(rows, lastRow=rowCount) 告知 ag-Grid 行数据 + 行总数,
 * 使滚动条尺寸正确;lastRow 让 ag-Grid 知道何时停止加载更多行。
 *
 * 注:/api/table/data 返回的 rows 是「二维数组」(每行一个数组,顺序与 columns 一致),
 * 而 ag-Grid infinite 需要「对象数组」(按 columnDef.field 取值)。
 * 这里按 columns 的顺序把二维行转成对象,缺列元素取值 undefined。
 *
 * headerRow / skipRows 透传:每次请求都带,后端 read_rows 据此剔除跳过行与表头,
 * 返回的是「剔除后有效行」的对应分块;rowCount 也是剔除后的有效行总数。
 *
 * frozenCount(冻结行):冻结 N 行到顶部后,前 N 行由 pinnedTopRowData 提供,
 * 数据行需跳过它们——请求 startRow/endRow +N 偏移,rowCount -N,否则前 N 行会在
 * pinned 顶部与数据区重复出现。每行对象附带 __rowIndex(真实有效行号 0-based),
 * 供 blame/高亮/提交详情统一按真实行号定位,与 ag-Grid rowIndex(冻结后偏移)解耦。
 */
export function buildDatasource(opts: {
  backendUrl: string;
  tableId: string;
  rowCount: number;
  columns: TableColumnMeta[];
  sortCol?: string | null;
  sortAsc?: boolean;
  headerRow?: number | null;
  skipRows?: number[][];
  /** 已冻结到顶部的行数(pinnedTopRowData 行数)。数据行需跳过它们:请求 +frozenCount 偏移,rowCount -frozenCount。 */
  frozenCount?: number;
  /** 列筛选:列名 → 选中值列表(多列 AND)。传给后端 /api/table/data(POST body)。 */
  filters?: Record<string, string[]>;
}): IDatasource {
  const {
    backendUrl,
    tableId,
    rowCount,
    columns,
    sortCol,
    sortAsc,
    headerRow = null,
    skipRows = [],
    frozenCount = 0,
    filters = {},
  } = opts;
  const base = backendUrl.replace(/\/$/, "");
  const colNames = columns.map((c) => c.name);

  // 只把非空筛选传后端(空数组=未筛)。
  const activeFilters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v && v.length > 0) activeFilters[k] = v;
  }

  return {
    // 冻结 N 行后,ag-Grid 视角数据行总数 = 总有效行数 - N(前 N 行已钉在顶部,不重复加载)。
    rowCount: Math.max(0, rowCount - frozenCount),
    getRows(params: IGetRowsParams) {
      // grid 请求 [startRow,endRow) 是 ag-Grid 视角(0-based,已扣除冻结行);
      // 映射到真实有效行号需 +frozenCount,跳过已冻结到顶部的行,避免与 pinned 重复。
      const reqStart = params.startRow + frozenCount;
      const reqEnd = params.endRow + frozenCount;
      const body: Record<string, unknown> = {
        tableId,
        startRow: reqStart,
        endRow: reqEnd,
        skipRows,
      };
      if (sortCol) {
        body.sortCol = sortCol;
        body.sortAsc = sortAsc;
      }
      if (headerRow !== null) {
        body.headerRow = headerRow;
      }
      if (Object.keys(activeFilters).length > 0) {
        body.filters = activeFilters;
      }

      fetch(`${base}/api/table/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{
            startRow: number;
            endRow: number;
            rowCount: number;
            rows: unknown[][];
            sourceRows?: number[];
          }>;
        })
        .then((data) => {
          // 返回 rows 为二维数组,顺序与 columns 一致;缺列值可能为 null。
          // 转 ag-Grid 需要的对象数组:{ [colName]: value },并附 __rowIndex 与 __sourceRow。
          const objectRows = data.rows.map((arr, rowI) => {
            const obj: Record<string, unknown> = {};
            colNames.forEach((name, colJ) => {
              obj[name] = arr[colJ];
            });
            // 真实有效行号(0-based)。reqStart 已含冻结偏移,故 = 该行在原数据集中的真实行号。
            obj.__rowIndex = reqStart + rowI;
            // 1-based 源行号(=parquet 原始行号+1,=文件行号)。供行号列显示与 blame gutter 对齐。
            // 缺失时回退 reqStart+rowI+1(防御,理论上后端总会返回)。
            obj.__sourceRow =
              data.sourceRows && data.sourceRows[rowI] !== undefined
                ? data.sourceRows[rowI]
                : reqStart + rowI + 1;
            return obj;
          });
          // lastRow 同样扣除冻结行数,否则 ag-Grid 会继续尝试加载已冻结的行段。
          params.successCallback(objectRows, Math.max(0, data.rowCount - frozenCount));
        })
        .catch(() => {
          params.failCallback();
        });
    },
  };
}
