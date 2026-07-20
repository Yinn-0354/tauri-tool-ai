import { useEffect, useState } from "react";
import { Modal, Tag, Typography, Spin, Empty, message } from "antd";
import {
  FileOutlined,
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import type { CommitInfo, ChangedFile } from "@/api/blame";
import { fetchCommitInfo } from "@/api/blame";

const { Text } = Typography;

interface Props {
  open: boolean;
  sourceId: string | null;
  revision: string | null;
  onClose: () => void;
}

// action 代码 → 中文 + 图标 + 颜色
const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  A: { label: "新增", color: "green", icon: <PlusOutlined /> },
  M: { label: "修改", color: "blue", icon: <EditOutlined /> },
  D: { label: "删除", color: "red", icon: <DeleteOutlined /> },
  R: { label: "替换", color: "orange", icon: <ExclamationCircleOutlined /> },
};

function formatDate(iso: string): string {
  if (!iso) return "";
  // ISO: 2026-04-16T10:03:19.322172Z → 2026-04-16 10:03:19
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}

export default function CommitInfoModal({ open, sourceId, revision, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<CommitInfo | null>(null);

  useEffect(() => {
    if (!open || !sourceId || !revision) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    fetchCommitInfo(sourceId, revision)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) {
          // 优先显示后端精确错误（凭证/权限），否则兜底
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          message.error(detail || "获取提交详情失败（可能 SVN 服务器不可达或凭证未缓存）");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceId, revision]);

  const changedFiles: ChangedFile[] = info?.changedFiles ?? [];

  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>提交详情</span>
          {revision && (
            <Tag color="blue" style={{ margin: 0 }}>
              r{revision}
            </Tag>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 0" }}>
          <Spin />
          <Text type="secondary">加载提交详情...</Text>
        </div>
      ) : !info ? (
        <Empty description="无提交详情" />
      ) : (
        <div>
          {/* 基础信息 */}
          <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                作者
              </Text>
              <div style={{ fontSize: 14 }}>{info.author || "—"}</div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                时间
              </Text>
              <div style={{ fontSize: 14 }}>{formatDate(info.date) || "—"}</div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                版本
              </Text>
              <div style={{ fontSize: 14 }}>r{info.revision}</div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                改动文件
              </Text>
              <div style={{ fontSize: 14 }}>{changedFiles.length} 个</div>
            </div>
          </div>

          {/* 提交信息 */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              提交信息
            </Text>
            <div
              style={{
                marginTop: 4,
                padding: "8px 12px",
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 4,
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1.5,
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {info.message || "（无提交信息）"}
            </div>
          </div>

          {/* 改动文件列表 */}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              改动文件（{changedFiles.length}）
            </Text>
            <div
              style={{
                marginTop: 4,
                border: "1px solid #f0f0f0",
                borderRadius: 4,
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {changedFiles.length === 0 ? (
                <Empty description="无改动文件" style={{ padding: "16px 0" }} />
              ) : (
                changedFiles.map((f, idx) => {
                  const cfg = ACTION_CONFIG[f.action] ?? {
                    label: f.action || "?",
                    color: "default",
                    icon: null,
                  };
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 12px",
                        borderBottom: idx < changedFiles.length - 1 ? "1px solid #f5f5f5" : undefined,
                        fontSize: 12,
                      }}
                    >
                      <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
                        {cfg.label}
                      </Tag>
                      <span style={{ flexShrink: 0, color: "#8c8c8c" }}>
                        {f.kind === "dir" ? <FolderOutlined /> : <FileOutlined />}
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                          title={f.path}
                      >
                        {f.path}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
