import { useEffect, useState } from "react";
import { List, Button, Popconfirm, Typography, Space, message } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import type { TableSource } from "@/api/table";
import { fetchSources, deleteSource } from "@/api/table";
import AddSourceModal from "./AddSourceModal";

const { Text } = Typography;

const typeLabels: Record<string, string> = {
  file: "文件",
  wps: "WPS",
  db: "数据库",
};

interface Props {
  selectedId: string | null;
  onSelect: (source: TableSource) => void;
}

export default function SourcePanel({ selectedId, onSelect }: Props) {
  const [sources, setSources] = useState<TableSource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0" }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            添加
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadSources} loading={loading} />
        </Space>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <List
          size="small"
          loading={loading}
          dataSource={sources}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: "pointer",
                padding: "8px 16px",
                background: selectedId === item.id ? "#e6f4ff" : undefined,
              }}
              onClick={() => onSelect(item)}
              actions={[
                <Popconfirm
                  title="确定删除？"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    handleDelete(item.id);
                  }}
                  onCancel={(e) => e?.stopPropagation()}
                  key="del"
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Text strong={selectedId === item.id}>{item.name}</Text>}
                description={
                  <Space size={4}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {typeLabels[item.type] ?? item.type}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                      {item.path}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </div>

      <AddSourceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(source) => {
          setSources((prev) => [...prev, source]);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
