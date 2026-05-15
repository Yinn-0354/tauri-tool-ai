import apiClient from "./client";

export interface TableSource {
  id: string;
  name: string;
  type: "file" | "wps" | "db";
  path: string;
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
  page: number;
  pageSize: number;
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
): Promise<TableSource> {
  const res = await apiClient.post("/api/table/sources", { name, type, path });
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
): Promise<TableData> {
  const res = await apiClient.get(`/api/table/data/${tableId}`, {
    params: { page, pageSize },
  });
  return res.data;
}
