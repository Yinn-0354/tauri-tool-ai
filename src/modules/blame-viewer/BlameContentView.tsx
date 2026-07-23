import { useMemo, useState } from "react";
import { Tag, Tooltip } from "antd";
import type { BlameLine } from "@/api/blame";
import { useBlameStore, type BlameStyle } from "@/stores/blameStore";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";
import type { ReactNode } from "react";
import CommitInfoModal from "./CommitInfoModal";

// ─── 与后端 _split_lines_like_svn 对齐的行切分 ──────────────────
function splitContentLines(content: string): string[] {
  const raw = content.split("\n");
  if (raw.length && raw[raw.length - 1] === "") raw.pop();
  return raw.map((l) => l.replace(/\r$/, ""));
}

// ─── 作者稳定着色（“UI 融洽”：同一作者同一颜色）──────────────
const AUTHOR_PALETTE = [
  "#1677ff", "#52c41a", "#faad14", "#eb2f96",
  "#722ed1", "#13c2c2", "#fa541c", "#2f54eb",
];
const colorCache = new Map<string, string>();
function authorColor(author: string): string {
  if (!author) return "#8c8c8c";
  const cached = colorCache.get(author);
  if (cached) return cached;
  let h = 0;
  for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
  const c = AUTHOR_PALETTE[h % AUTHOR_PALETTE.length];
  colorCache.set(author, c);
  return c;
}

function shortDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

// ─── 搜索高亮 ─────────────────────────────────────────────────
function highlightLine(text: string, query: string): { nodes: ReactNode; matched: boolean } {
  if (!query) return { nodes: text, matched: false };
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q || lower.indexOf(q) === -1) return { nodes: text, matched: false };
  const out: ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(q);
  let matched = false;
  let key = 0;
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={key++} style={{ background: "#ffe58f", padding: "0 1px", borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    matched = true;
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return { nodes: out, matched };
}

// ─── 行 blame 元信息（含连续同版本分组的边界与行号区间）────────
interface LineBlame {
  revision: string;
  author: string;
  date: string;
  isBoundary: boolean; // 同版本连续段的起始行
  range: string; // 如 L1-5
}

function buildLineBlame(blameLines: BlameLine[]): LineBlame[] {
  const arr: LineBlame[] = blameLines.map((b) => ({
    revision: b.revision,
    author: b.author,
    date: b.date,
    isBoundary: false,
    range: "",
  }));
  let i = 0;
  while (i < arr.length) {
    const cur = arr[i];
    if (!cur.revision) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < arr.length && arr[j].revision === cur.revision) j++;
    cur.isBoundary = true;
    const start = i + 1;
    const end = j;
    cur.range = start === end ? `L${start}` : `L${start}-${end}`;
    i = j;
  }
  return arr;
}

// ─── 样式 ─────────────────────────────────────────────────────
const rowStyle: React.CSSProperties = {
  display: "flex",
  minWidth: "100%",
  width: "max-content",
  borderBottom: "1px solid #f5f5f5",
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 1.5,
};

const stickyGutterStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 2,
  background: "#fff",
  display: "flex",
  flexShrink: 0,
  borderRight: "1px solid #f0f0f0",
};

const lineNumStyle: React.CSSProperties = {
  minWidth: 56,
  padding: "0 8px 0 12px",
  textAlign: "right",
  color: "#8c8c8c",
  userSelect: "none",
};

const blameGutterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  minWidth: 230,
  maxWidth: 230,
  overflow: "hidden",
  whiteSpace: "nowrap",
};

const codeCellStyle: React.CSSProperties = {
  whiteSpace: "pre",
  padding: "0 8px",
  color: "#333",
};

// ─── blame chip 渲染 ──────────────────────────────────────────
function renderBlameChip(
  style: BlameStyle,
  blame: LineBlame | undefined,
  onClick: () => void,
): ReactNode {
  if (!blame || !blame.revision) return null;
  const color = authorColor(blame.author);

  if (style === "gutter") {
    if (blame.isBoundary) {
      return (
        <>
          <Tag color={color} style={{ margin: 0, fontSize: 11, lineHeight: "1.4" }}>
            {blame.revision}
          </Tag>
          <span style={{ color, fontSize: 12, marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis" }}>
            {blame.author}
          </span>
        </>
      );
    }
    return <span style={{ color: "#bfbfbf", fontSize: 11 }}>{blame.revision}</span>;
  }

  if (style === "grouped") {
    if (!blame.isBoundary) return null;
    return (
      <Tooltip title={`r${blame.revision} · ${blame.author} · ${shortDate(blame.date)} · 点击查看提交详情`}>
        <span onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", cursor: "pointer" }}>
          <Tag color={color} style={{ margin: 0, fontSize: 11, lineHeight: "1.4", flexShrink: 0 }}>
            {blame.revision}
          </Tag>
          <span style={{ color, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
            {blame.author}
          </span>
          <span style={{ color: "#8c8c8c", fontSize: 11, flexShrink: 0 }}>{shortDate(blame.date)}</span>
          <span style={{ color: "#bfbfbf", fontSize: 11, flexShrink: 0 }}>{blame.range}</span>
        </span>
      </Tooltip>
    );
  }

  return null;
}

export default function BlameContentView() {
  const {
    selectedSource,
    fileContent,
    fileLoading,
    fileIsBinary,
    fileError,
    blameLines,
    blameMode,
    blameStyle,
    searchQuery,
  } = useBlameStore();

  const blameActive = blameMode === "blame";

  // 提交详情弹窗（点击 blame 行触发，懒加载）
  const [commitRevision, setCommitRevision] = useState<string | null>(null);
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  const openCommit = (revision: string) => {
    if (!revision) return;
    setCommitRevision(revision);
    setCommitModalOpen(true);
  };

  // blame 激活时从 blameLines 内容渲染（与 blame 同源，保证对齐）；否则从 fileContent 全量切分
  const lines = useMemo<{ line: string; lineNumber: number; blame?: BlameLine }[]>(() => {
    if (blameActive && blameLines && blameLines.length > 0) {
      return blameLines.map((b) => ({ line: b.content, lineNumber: b.lineNumber, blame: b }));
    }
    return splitContentLines(fileContent).map((line, idx) => ({ line, lineNumber: idx + 1 }));
  }, [blameActive, blameLines, fileContent]);

  const lineBlame = useMemo<LineBlame[]>(
    () => (blameActive && blameLines ? buildLineBlame(blameLines) : []),
    [blameActive, blameLines],
  );

  // 全文搜索匹配
  const { totalMatches, lineMatched } = useMemo<{
    totalMatches: number;
    lineMatched: (boolean | null)[] | null;
  }>(() => {
    if (!searchQuery) return { totalMatches: 0, lineMatched: null };
    const q = searchQuery.toLowerCase();
    let total = 0;
    const matched = lines.map((r) => {
      const m = r.line.toLowerCase().includes(q);
      if (m) total++;
      return m;
    });
    return { totalMatches: total, lineMatched: matched };
  }, [lines, searchQuery]);

  if (fileLoading) return <Loading />;
  if (fileIsBinary) return <Empty description="该文件为二进制，无法显示" />;
  if (fileError) return <Empty description="读取文件内容失败" />;
  if (lines.length === 0 && !blameActive) return <Empty description="文件为空" />;

  const rows: ReactNode[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const { line, lineNumber } = lines[idx];
    const blame = lineBlame[idx];
    const matched = searchQuery ? lineMatched?.[idx] === true : true;
    const dim = searchQuery && !matched;

    const renderInner = () => (
      <>
        <div style={stickyGutterStyle}>
          <span style={lineNumStyle}>{lineNumber}</span>
          {blameActive && (
            <span
              style={{ ...blameGutterStyle, cursor: blame && blame.revision ? "pointer" : "default" }}
              onClick={blame && blame.revision ? () => openCommit(blame.revision) : undefined}
              title={blame?.revision ? `点击查看 r${blame.revision} 提交详情` : undefined}
            >
              {blameStyle === "hover" ? null : renderBlameChip(blameStyle, blame, () =>
                blame ? openCommit(blame.revision) : undefined,
              )}
            </span>
          )}
        </div>
        <div style={codeCellStyle}>
          {searchQuery ? highlightLine(line, searchQuery).nodes : line}
        </div>
      </>
    );

    if (blameActive && blameStyle === "hover" && blame && blame.revision) {
      rows.push(
        <Tooltip
          key={lineNumber}
          placement="left"
          title={`r${blame.revision} · ${blame.author} · ${shortDate(blame.date)} · 点击查看提交详情`}
        >
          <div style={{ ...rowStyle, cursor: "pointer", opacity: dim ? 0.35 : 1 }} onClick={() => openCommit(blame.revision)}>
            {renderInner()}
          </div>
        </Tooltip>,
      );
    } else {
      rows.push(
        <div key={lineNumber} style={{ ...rowStyle, opacity: dim ? 0.35 : 1 }}>
          {renderInner()}
        </div>,
      );
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {searchQuery && (
        <div style={{ flexShrink: 0, padding: "4px 0 8px", fontSize: 12, color: "#8c8c8c" }}>
          {totalMatches > 0 ? `已高亮 ${totalMatches} 处匹配` : "无匹配内容"}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>{rows}</div>
      <CommitInfoModal
        open={commitModalOpen}
        sourceId={selectedSource?.id ?? null}
        revision={commitRevision}
        onClose={() => setCommitModalOpen(false)}
      />
    </div>
  );
}
