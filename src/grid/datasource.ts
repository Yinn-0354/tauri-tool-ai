import type { IDatasource, IGetRowsParams } from "@ag-grid-community/core";
import type { TableColumnMeta } from "../store/tableStore";

/**
 * 构造 infinite datasource。
 *
 * ag-Grid Infinite Row Model 按滚动视口分块回调 getRows(params):
 * 前端只在每次回调里以 params.startRow/params.endRow 调后端 GET /api/table/data,
 * 拉取当前视口所需的一个分块(默认 100 行),绝不一次性拉全表 / 不在 state 存全表。
 * 后端对缓存 parquet 做 lazy scan + slice,也只物化该分块。
 *
 * successCallback(rows, lastRow=rowCount) 告诉 ag-Grid 本块数据 + 总行数,
 * 使滚动条尺寸正确;lastRow 到达后 ag-Grid 不再继续请求后续块。
 *
 * 注意:后端 /api/table/data 返回的 rows 是「二维数组」(行 × 列,顺序与 columns 一致),
 * 而 ag-Grid infinite 需要的是「对象数组」(按 columnDef.field 从对象取值)。
 * 这里按 columns 的列名顺序把二维数组转成对象数组,否则单元格取值为 undefined(表头正常但内容空)。
 */
export function buildDatasource(opts: {
  backendUrl: string;
  tableId: string;
  rowCount: number;
  columns: TableColumnMeta[];
}): IDatasource {
  const { backendUrl, tableId, rowCount, columns } = opts;
  const base = backendUrl.replace(/\/$/, "");
  const colNames = columns.map((c) => c.name);

  return {
    // 已知总行数 -> 设置后 ag-Grid 据此计算滚动条高度,不再盲拉。
    rowCount,
    getRows(params: IGetRowsParams) {
      const url =
        `${base}/api/table/data` +
        `?tableId=${encodeURIComponent(tableId)}` +
        `&startRow=${params.startRow}` +
        `&endRow=${params.endRow}`;

      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{
            startRow: number;
            endRow: number;
            rowCount: number;
            rows: unknown[][];
          }>;
        })
        .then((data) => {
          // 后端 rows 为二维数组,顺序与 columns 一致;空值已是 null。
          // 转 ag-Grid 所需的对象数组:{ [colName]: value }。
          const objectRows = data.rows.map((arr) => {
            const obj: Record<string, unknown> = {};
            colNames.forEach((name, i) => {
              obj[name] = arr[i];
            });
            return obj;
          });
          params.successCallback(objectRows, data.rowCount);
        })
        .catch(() => {
          params.failCallback();
        });
    },
  };
}
