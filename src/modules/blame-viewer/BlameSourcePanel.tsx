import { useEffect, useRef, useState, useCallback } from "react";
import { List, Button, Popconfirm, Typography, Tag, Tooltip, message } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  BranchesOutlined,
  ForkOutlined,
} from "@ant-design/icons";
import type { VcsSource } from "@/api/blame";
import { fetchVcsSources, deleteVcsSource } from "@/api/blame";
import { useBlameStore } from "@/stores/blameStore";
import AddBlameSourceModal from "./AddBlameSourceModal";

const { Text } = Typography;

const typeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  svn: { label: "SVN", color: "green", icon: <BranchesOutlined /> },
  git: { label: "Git", color: "blue", icon: <ForkOutlined /> },
};

interface Props {
  selectedId: string | null;
  onSelect: (source: VcsSource) => void;
  /** Modal 编辑代码源后通知父组件同步 */
  onSourceUpdated?: (source: VcsSource) => void;
}

export default function BlameSourcePanel({ selectedId, onSelect, onSourceUpdated }: Props) {
  const storeSelectedSource = useBlameStore((s) => s.selectedSource);
  const [sources, setSources] = useState<VcsSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingSource, setEditingSource] = useState<VcsSource | null>(null);
  const prevSelectedRef = useRef<VcsSource | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchVcsSources();
      setSources(list);
    } catch {
      message.error("加载数据源列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // 工具栏更新代码源后，同步到本地列表（store 引用变化时触发）
  useEffect(() => {
    if (storeSelectedSource && storeSelectedSource !== prevSelectedRef.current) {
      prevSelectedRef.current = storeSelectedSource;
      setSources((prev) =>
        prev.map((s) => (s.id === storeSelectedSource.id ? storeSelectedSource : s)),
      );
    }
  }, [storeSelectedSource]);

  const handleDelete = async (id: string) => {
    try {
      await deleteVcsSource(id);
      message.success("已删除");
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch {
      message.error("删除失败");
    }
  };

  const openEditModal = (item: VcsSource, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSource(item);
    setModalOpen(true);
  };

  return (
    <div className="source-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text strong>代码源</Text>
        <div>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadSources}
            loading={loading}
            style={{ marginRight: 4 }}
          />
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            添加
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <List
          size="small"
          loading={loading}
          dataSource={sources}
          renderItem={(item) => {
            const cfg = typeConfig[item.type] ?? { label: item.type, color: "default", icon: null };
            const isSelected = selectedId === item.id;
            const displayName = item.alias || item.name;

            return (
              <List.Item
                style={{
                  cursor: "pointer",
                  padding: "10px 8px 10px 16px",
                  background: isSelected ? "#e6f4ff" : undefined,
                  borderLeft: isSelected ? "3px solid #1677ff" : "3px solid transparent",
                  display: "flex",
                  alignItems: "flex-start",
                }}
                onClick={() => onSelect(item)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text strong={isSelected} ellipsis style={{ flex: 1 }}>
                      {displayName}
                    </Text>
                    <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
                      {cfg.label}
                    </Tag>
                  </div>
                  <Tooltip title={item.path} placement="topLeft">
                    <Text type="secondary" style={{ fontSize: 12, display: "block" }} ellipsis>
                      {item.path}
                    </Text>
                  </Tooltip>
                </div>
                <div
                  style={{ flexShrink: 0, display: "flex", flexDirection: "column", marginLeft: 4 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => openEditModal(item, e)}
                  />
                  <Popconfirm
                    title="确定删除？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDelete(item.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              </List.Item>
            );
          }}
        />
      </div>

      <AddBlameSourceModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingSource(null);
        }}
        editingSource={editingSource}
        onAdded={(source) => {
          setSources((prev) => [...prev, source]);
          setModalOpen(false);
        }}
        onUpdated={(source) => {
          setSources((prev) => prev.map((s) => (s.id === source.id ? source : s)));
          setModalOpen(false);
          setEditingSource(null);
          onSourceUpdated?.(source);
        }}
      />
    </div>
  );
}
