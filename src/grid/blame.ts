/** /api/vcs/blame 返回的单行 blame 元信息(1-based 行号)。 */
export interface BlameLineInfo {
  lineNumber: number;
  revision: string;
  author: string;
  date: string;
}

/**
 * 对文件执行 svn blame,返回全量行级元信息。
 * 结果会被调用方缓存到组件内,避免重复请求;后端另有 LRU 缓存。
 */
export async function fetchBlame(
  backendUrl: string,
  path: string,
  revision = "BASE"
): Promise<BlameLineInfo[]> {
  const base = backendUrl.replace(/\/$/, "");
  const resp = await fetch(`${base}/api/vcs/blame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, revision }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`blame HTTP ${resp.status} ${t}`);
  }
  const data = (await resp.json()) as { rows: BlameLineInfo[] };
  return data.rows;
}

/** 作者 → 稳定颜色(哈希调色板),用于 blame gutter 染色。 */
const AUTHOR_COLORS = new Map<string, string>();
const PALETTE = [
  "#e57373", "#f06292", "#ba68c8", "#7986cb", "#64b5f6",
  "#4db6ac", "#81c784", "#aed581", "#ffb74d", "#ff8a65",
  "#a1887f", "#90a4ae", "#9575cd", "#4dd0e1", "#4fc3f7",
];

export function authorColor(author: string): string {
  if (!author) return "transparent";
  let c = AUTHOR_COLORS.get(author);
  if (!c) {
    let h = 0;
    for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
    c = PALETTE[h % PALETTE.length];
    AUTHOR_COLORS.set(author, c);
  }
  return c;
}
