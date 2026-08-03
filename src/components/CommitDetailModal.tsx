import { useEffect, useState } from "react";
import { Modal, Spin, Tag } from "antd";

/** POST /api/vcs/log 返回的提交详情。 */
export interface CommitDetail {
  revision: string;
  author: string;
  date: string;
  message: string;
  changedPaths: { path: string; action: string }[];
}

interface CommitDetailModalProps {
  open: boolean;
  backendUrl: string;
  /** 文件路径,传给 /api/vcs/log。 */
  path: string;
  /** revision,如 "12345" 或 "BASE"。空则不发请求。 */
  revision: string | null;
  onClose: () => void;
}

async function fetchLog(
  backendUrl: string,
  path: string,
  revision: string
): Promise<CommitDetail> {
  const base = backendUrl.replace(/\/$/, "");
  const resp = await fetch(`${base}/api/vcs/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, revision }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${t}`);
  }
  return (await resp.json()) as CommitDetail;
}

/** action 字母 → 颜色 + 全称。SVN: A=Added/M=Modified/D=Deleted/R=Replaced。 */
function actionTag(a: string): { color: string; label: string } {
  switch (a) {
    case "A":
      return { color: "var(--accent)", label: "A · 新增" };
    case "M":
      return { color: "var(--warn)", label: "M · 修改" };
    case "D":
      return { color: "var(--danger)", label: "D · 删除" };
    case "R":
      return { color: "var(--text-muted)", label: "R · 替换" };
    default:
      return { color: "var(--text-muted)", label: a || "?" };
  }
}

/**
 * blame 单元格点击打开的提交详情 Modal(需求4)。
 * 调 POST /api/vcs/log {path, revision} 展示 revision/author/date/message/changedPaths。
 * 深色主题(bg-elevated,边框 border-strong),宽 560,圆角 8。
 */
export default function CommitDetailModal({
  open,
  backendUrl,
  path,
  revision,
  onClose,
}: CommitDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);

  useEffect(() => {
    if (!open || !revision) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchLog(backendUrl, path, revision)
      .then((d) => setDetail(d))
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, backendUrl, path, revision]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      title={revision ? `r${revision}` : "提交详情"}
      className="tt-modal"
    >
      {loading ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin />
        </div>
      ) : error ? (
        <div style={{ color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
          加载失败:{error}
        </div>
      ) : detail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 顶部:author + date */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              {detail.author}
            </span>
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {detail.date}
            </span>
          </div>

          {/* commit message */}
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "10px 12px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--text)",
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {detail.message || "(无提交信息)"}
          </div>

          {/* changedPaths */}
          <div>
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: 11,
                marginBottom: 6,
                letterSpacing: ".04em",
              }}
            >
              变更文件({detail.changedPaths.length})
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 200,
                overflow: "auto",
                borderTop: "1px solid var(--border)",
                paddingTop: 8,
              }}
            >
              {detail.changedPaths.map((c, i) => {
                const tag = actionTag(c.action);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    <Tag
                      style={{
                        color: tag.color,
                        border: `1px solid ${tag.color}`,
                        background: "transparent",
                        margin: 0,
                        minWidth: 56,
                        textAlign: "center",
                      }}
                    >
                      {tag.label}
                    </Tag>
                    <span style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                      {c.path}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
