/**
 * 模板 API 层
 *
 * 管理页面模板的 CRUD 操作。
 */

import apiClient from "./client";
import type { PageSchema, Template } from "@/types/schema";

// ─── 模板 CRUD ─────────────────────────────────────────────────

export async function fetchTemplates(): Promise<Template[]> {
  const res = await apiClient.get("/api/table/templates");
  return res.data;
}

export async function saveTemplate(data: {
  name: string;
  description?: string;
  schema: PageSchema;
}): Promise<Template> {
  const res = await apiClient.post("/api/table/templates", {
    name: data.name,
    description: data.description,
    page_schema: data.schema,
  });
  return res.data;
}

export async function updateTemplate(
  id: string,
  data: { name?: string; description?: string; schema?: PageSchema },
): Promise<Template> {
  const res = await apiClient.put(`/api/table/templates/${id}`, {
    name: data.name,
    description: data.description,
    page_schema: data.schema,
  });
  return res.data;
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiClient.delete(`/api/table/templates/${id}`);
}

// ─── Jinja2 文本渲染 ───────────────────────────────────────────

export async function renderTemplate(
  template: string,
  tableId: string,
  maxRows = 500,
): Promise<{ rendered: string[]; total: number }> {
  const res = await apiClient.post("/api/table/render-template", {
    template,
    tableId,
    maxRows,
  });
  return res.data;
}
