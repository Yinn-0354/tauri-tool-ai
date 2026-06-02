import apiClient from "./client";

export interface TableSource {
  id: string;
  name: string;
  type: "file" | "wps" | "db";
  path: string;
  alias?: string;
  headerRow?: number;
  skipRows?: number[];
  addedAt: string;
}

export interface TableMeta {
  id: string;
  sourceId: string;
  columns: string[];
  totalRows: number;
}

export interface TableData {
  columns: string[];
  rows: unknown[][];
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
}

export interface ColumnFilter {
  column: string;
  op: "eq" | "ne" | "contains" | "gt" | "lt" | "gte" | "lte" | "in" | "between";
  value: unknown;
}

// 数据源 CRUD
export async function fetchSources(): Promise<TableSource[]> {
  const res = await apiClient.get("/api/table/sources");
  return res.data;
}

export async function addSource(
  name: string,
  type: string,
  path: string,
  alias = "",
  headerRow = 1,
  skipRows: number[] = [],
): Promise<TableSource> {
  const res = await apiClient.post("/api/table/sources", {
    name,
    type,
    path,
    alias,
    headerRow,
    skipRows,
  });
  return res.data;
}

export async function updateSource(
  id: string,
  data: { name?: string; alias?: string; headerRow?: number; skipRows?: number[] },
): Promise<TableSource> {
  const res = await apiClient.put(`/api/table/sources/${id}`, data);
  return res.data;
}

export async function deleteSource(id: string): Promise<void> {
  await apiClient.delete(`/api/table/sources/${id}`);
}

// 表格加载与查询
export async function loadTable(
  sourceId: string,
  sheet?: string,
): Promise<TableMeta> {
  const res = await apiClient.post("/api/table/load", { sourceId, sheet });
  return res.data;
}

export async function fetchData(
  tableId: string,
  page = 1,
  pageSize = 100,
  sortCol?: string,
  sortOrder?: "asc" | "desc",
  filters?: ColumnFilter[],
): Promise<TableData> {
  const params: Record<string, unknown> = { page, pageSize };
  if (sortCol) params.sortCol = sortCol;
  if (sortOrder) params.sortOrder = sortOrder;
  if (filters && filters.length > 0) params.filters = JSON.stringify(filters);

  const res = await apiClient.get(`/api/table/data/${tableId}`, { params });
  return res.data;
}
