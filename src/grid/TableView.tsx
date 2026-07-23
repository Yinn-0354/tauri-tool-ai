import { useMemo } from "react";
import { AgGridReact } from "@ag-grid-community/react";
import type { ColDef } from "@ag-grid-community/core";
import type { IDatasource } from "@ag-grid-community/core";
import { buildDatasource } from "./datasource";
import type { TableColumnMeta } from "../store/tableStore";

interface TableViewProps {
  backendUrl: string;
  tableId: string;
  rowCount: number;
  columns: TableColumnMeta[];
}

/**
 * ag-Grid Infinite Row Model 容器。
 * - rowModelType="infinite":社区版支持的 canvas 虚拟化模型,适配百万行。
 * - datasource 由 buildDatasource 生成,只在 getRows 回调里按视口拉分块。
 * - cacheBlockSize=100:maxBlocksInCache 适度,避免缓存过多分块占内存。
 * - 列定义从后端 columns 动态生成,field=name / headerName=name。
 * - 绝不在前端存全表:state 只持有 tableId/columns/rowCount 元信息。
 */
export default function TableView({
  backendUrl,
  tableId,
  rowCount,
  columns,
}: TableViewProps) {
  const columnDefs = useMemo<ColDef[]>(() => {
    // 给每列加一个最小宽度,避免列过多时挤成 0 宽。
    return columns.map((c) => ({
      field: c.name,
      headerName: c.name,
      minWidth: 120,
      resizable: true,
      sortable: false, // 社区版 infinite 不支持服务端排序透传,先禁用排序 UI
    }));
  }, [columns]);

  const datasource = useMemo<IDatasource>(
    () => buildDatasource({ backendUrl, tableId, rowCount }),
    [backendUrl, tableId, rowCount],
  );

  return (
    <div
      className="ag-theme-quartz"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    >
      <AgGridReact
        rowModelType="infinite"
        columnDefs={columnDefs}
        datasource={datasource}
        cacheBlockSize={100}
        maxBlocksInCache={10}
        rowSelection={{ mode: "singleRow" }}
        defaultColDef={{ resizable: true }}
      />
    </div>
  );
}
