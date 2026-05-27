import { useState, useEffect } from "react";
import { Layout, Segmented, Button, InputNumber, Select, message, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { TableSource, TableMeta } from "@/api/table";
import { loadTable, updateSource } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import SourcePanel from "./SourcePanel";
import TableView from "./TableView";
import CardView from "./CardView";
import TemplateView from "./TemplateView";

const { Sider, Content } = Layout;

type ViewMode = "table" | "card" | "template";

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "table", label: "表格" },
  { value: "card", label: "卡片" },
  { value: "template", label: "模板" },
];

const toolbarStyle: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #f0f0f0",
};

const viewAreaStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 16px",
  minHeight: 0,
};

export default function TableViewerModule() {
  const { viewMode, setViewMode, currentTable, setCurrentTable } = useTableViewerStore();
  const [selectedSource, setSelectedSource] = useState<TableSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [editHeaderRow, setEditHeaderRow] = useState(1);
  const [editSkipRows, setEditSkipRows] = useState<number[]>([]);

  useEffect(() => {
    if (selectedSource) {
      setEditHeaderRow(selectedSource.headerRow ?? 1);
      setEditSkipRows(selectedSource.skipRows ?? []);
    }
  }, [selectedSource]);

  const handleSelectSource = async (source: TableSource) => {
    setSelectedSource(source);
    setLoading(true);
    try {
      const meta = await loadTable(source.id);
      setCurrentTable(meta as unknown as TableMeta);
    } catch {
      message.error("加载数据失败");
      setCurrentTable(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!selectedSource) return;
    await handleSelectSource(selectedSource);
  };

  const handleApplyConfig = async () => {
    if (!selectedSource) return;
    setLoading(true);
    try {
      const updated = await updateSource(selectedSource.id, {
        headerRow: editHeaderRow,
        skipRows: editSkipRows,
      });
      setSelectedSource(updated as unknown as TableSource);
      const meta = await loadTable(selectedSource.id);
      setCurrentTable(meta as unknown as TableMeta);
      message.success("配置已更新");
    } catch {
      message.error("更新配置失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ height: "100%", background: "#fff" }}>
      <Sider width={280} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <SourcePanel
          selectedId={selectedSource?.id ?? null}
          onSelect={handleSelectSource}
        />
      </Sider>
      <Content style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* 工具栏 — 固定在顶部 */}
        <div style={toolbarStyle}>
          <Segmented<ViewMode>
            value={viewMode}
            onChange={(val) => setViewMode(val as ViewMode)}
            options={VIEW_MODE_OPTIONS}
          />
          {currentTable && (
            <span style={{ color: "#8c8c8c", fontSize: 13 }}>
              {selectedSource?.name} — {currentTable.totalRows} 行 {currentTable.columns.length} 列
              <Button
                type="text"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={handleRefresh}
                style={{ marginLeft: 8 }}
              />
            </span>
          )}
        </div>

        {/* 数据源配置编辑条 */}
        {currentTable && (
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "4px 16px",
              borderBottom: "1px solid #f0f0f0",
              background: "#fafafa",
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              配置
            </Typography.Text>
            <Space size={4}>
              <Typography.Text style={{ fontSize: 12 }}>表头行</Typography.Text>
              <InputNumber
                size="small"
                min={1}
                value={editHeaderRow}
                onChange={(v) => setEditHeaderRow(v ?? 1)}
                style={{ width: 70 }}
              />
            </Space>
            <Space size={4}>
              <Typography.Text style={{ fontSize: 12 }}>跳过行</Typography.Text>
              <Select
                mode="tags"
                size="small"
                tokenSeparators={[","]}
                placeholder="行号"
                value={editSkipRows.map(String)}
                onChange={(vals) => setEditSkipRows(vals.map(Number))}
                style={{ minWidth: 120 }}
              />
            </Space>
            <Button size="small" type="primary" loading={loading} onClick={handleApplyConfig}>
              应用
            </Button>
          </div>
        )}

        {/* 视图区域 — 填充剩余高度，滚动由各子组件自己处理 */}
        <div style={viewAreaStyle}>
          {viewMode === "table" && <TableView />}
          {viewMode === "card" && <CardView />}
          {viewMode === "template" && <TemplateView />}
        </div>
      </Content>
    </Layout>
  );
}
