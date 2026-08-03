// ag-Grid 社区版模块注册:仅在模块顶层执行一次。
// v32 必须显式注册 ClientSideRowModelModule + InfiniteRowModelModule + CsvExportModule,
// 否则 rowModelType="infinite" 无效、CSV 导出不可用。
import { ModuleRegistry } from "@ag-grid-community/core";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import { InfiniteRowModelModule } from "@ag-grid-community/infinite-row-model";
import { CsvExportModule } from "@ag-grid-community/csv-export";

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  InfiniteRowModelModule,
  CsvExportModule,
]);

// ag-Grid 样式:ag-grid.css 基础布局 + ag-theme-quartz 主题。容器需 className="ag-theme-quartz"。
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-quartz.css";

// Carbon Terminal 主题 token + 全局 body + ag-Grid tt-grid 覆盖(纵向线/紧凑/hover/选中/滚动条)
import "./theme.css";
