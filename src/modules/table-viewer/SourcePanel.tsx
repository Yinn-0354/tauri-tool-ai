import { useEffect, useState } from "react";
import { List, Button, Popconfirm, Typography, Tag, Tooltip, message } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  DatabaseOutlined,
  CloudOutlined,
} from "@ant-design/icons";
import type { TableSource } from "@/api/table";
import { fetchSources, deleteSource } from "@/api/table";
import AddSourceModal from "./AddSourceModal";

const { Text } = Typography;

const typeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  file: { label: "文件", color: "green", icon: <FileExcelOutlined /> },
  wps: { label: "WPS", color: "blue", icon: <CloudOutlined /> },
  db: { label: "数据库", color: "purple", icon: <DatabaseOutlined /> },
};

interface Props {
  selectedId: string | null;
  onSelect: (source: TableSource) => void;
}

export default function SourcePanel({ selectedId, onSelect }: Props) {
  const [sources, setSources] = useState<TableSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingSource, setEditingSource] = useState<TableSource | null>(null);

  const loadSources = async () => {
    setLoading(true);
    try {
      const list = await fetchSources();
      setSources(list);
    } catch {
      message.error("加载数据源列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteSource(id);
      message.success("已删除");
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch {
      message.error("删除失败");
    }
  };

  const openEditModal = (item: TableSource, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSource(item);
    setModalOpen(true);
  };

  return (
    <div className="source-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        .source-panel .ant-list-item {
          transition: background 0.15s ease;
        }
        .source-panel .ant-list-item:hover {
          background: #dce8fd;
        }
      `}</style>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text strong>数据源</Text>
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
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, display: "block" }}
                      ellipsis
                    >
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

      <AddSourceModal
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
        }}
      />
    </div>
  );
}
