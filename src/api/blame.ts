import apiClient from "./client";

export interface BlameLine {
  revision: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

export async function fetchBlame(
  vcs: "svn" | "git",
  path: string,
): Promise<BlameLine[]> {
  const res = await apiClient.post("/api/vcs/blame", { vcs, path });
  return res.data;
}
