import apiClient from "./client";

export interface BlameLine {
  revision: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

export interface VcsSource {
  id: string;
  name: string;
  type: "svn" | "git";
  path: string;
  alias?: string;
  addedAt: string;
}

export interface FileContent {
  content: string;
  encoding: string;
  truncated: boolean;
  isBinary: boolean;
  fileSize: number;
  tooLargeForBlame: boolean;
}

export interface ChangedFile {
  path: string;
  action: string; // A 新增 / M 修改 / D 删除 / R 替换
  kind: string; // file / dir
}

export interface CommitInfo {
  revision: string;
  author: string;
  date: string;
  message: string;
  changedFiles: ChangedFile[];
}

// ─── Blame（分页）──────────────────────────────────────────────

export interface BlamePage {
  lines: BlameLine[];
  totalLines: number;
  page: number;
  pageSize: number;
}

export async function fetchBlame(
  sourceId: string,
  page: number,
  pageSize: number,
): Promise<BlamePage> {
  // 后端 svn blame 超时 60s，客户端给 65s 让后端先返回明确错误，避免 axios 提前中断孤儿进程
  const res = await apiClient.post(
    "/api/vcs/blame",
    { sourceId, page, pageSize },
    { timeout: 65000 },
  );
  return res.data;
}

// ─── VCS 代码源 CRUD ────────────────────────────────────────────

export async function fetchVcsSources(): Promise<VcsSource[]> {
  const res = await apiClient.get("/api/vcs/sources");
  return res.data;
}

export interface AddVcsSourceRequest {
  name: string;
  type: "svn" | "git";
  path: string;
  alias?: string;
}

export async function addVcsSource(
  body: AddVcsSourceRequest,
): Promise<VcsSource> {
  const res = await apiClient.post("/api/vcs/sources", body);
  return res.data;
}

export interface UpdateVcsSourceRequest {
  name?: string;
  alias?: string;
  path?: string;
}

export async function updateVcsSource(
  id: string,
  body: UpdateVcsSourceRequest,
): Promise<VcsSource> {
  const res = await apiClient.put(`/api/vcs/sources/${id}`, body);
  return res.data;
}

export async function deleteVcsSource(id: string): Promise<void> {
  await apiClient.delete(`/api/vcs/sources/${id}`);
}

// ─── 文件内容 ──────────────────────────────────────────────────

export async function fetchFileContent(sourceId: string): Promise<FileContent> {
  const res = await apiClient.post("/api/vcs/file-content", { sourceId });
  return res.data;
}

export interface FileLinesPage {
  lines: string[];
  totalLines: number;
  page: number;
  pageSize: number;
  isBinary: boolean;
  truncated: boolean;
}

export async function fetchFileLines(
  sourceId: string,
  page: number,
  pageSize: number,
): Promise<FileLinesPage> {
  const res = await apiClient.post("/api/vcs/file-lines", { sourceId, page, pageSize });
  return res.data;
}

// ─── 提交详情（点击 blame 行弹窗）─────────────────────────────

export async function fetchCommitInfo(
  sourceId: string,
  revision: string,
): Promise<CommitInfo> {
  const res = await apiClient.post(
    "/api/vcs/commit-info",
    { sourceId, revision },
    { timeout: 35000 },
  );
  return res.data;
}
