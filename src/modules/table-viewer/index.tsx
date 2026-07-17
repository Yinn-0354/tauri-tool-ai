import { useState, useEffect } from "react";
import { Layout, Segmented, Button, InputNumber, Select, message, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { TableSource, TableMeta, ColumnGroupConfig } from "@/api/table";
import { loadTable, updateSource } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import SourcePanel from "./SourcePanel";
import TableView from "./TableView";
import CardView from "./CardView";
import TemplateView from "./TemplateView";
import PageView from "./PageView";
import ColumnGroupsEditor from "./ColumnGroupsEditor";

const { Sider, Content } = Layout;

type ViewMode = "table" | "card" | "template" | "page";

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "table", label: "表格" },
  { value: "card", label: "卡片" },
  { value: "template", label: "模板" },
  { value: "page", label: "页面" },
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
  padding: "8px 16px",
  minHeight: 0,
};

export default function TableViewerModule() {
  const { viewMode, setViewMode, currentTable, setCurrentTable, selectedSource, setSelectedSource } = useTableViewerStore();
  const [loading, setLoading] = useState(false);
  const [editHeaderRow, setEditHeaderRow] = useState(1);
  const [editSkipRows, setEditSkipRows] = useState<number[]>([]);
  const [editRemarkRows, setEditRemarkRows] = useState<number[]>([]);
  const [editColumnGroups, setEditColumnGroups] = useState<ColumnGroupConfig[]>([]);
  const [columnGroupsEditorOpen, setColumnGroupsEditorOpen] = useState(false);

  // 切换数据源时，同步配置到 toolbar
  useEffect(() => {
    if (selectedSource) {
      setEditHeaderRow(selectedSource.headerRow ?? 1);
      setEditSkipRows(selectedSource.skipRows ?? []);
      setEditRemarkRows(selectedSource.remarkRows ?? []);
      setEditColumnGroups(selectedSource.columnGroups ?? []);
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
        remarkRows: editRemarkRows,
        columnGroups: editColumnGroups,
      });
      const updatedSource = {
        ...(updated as unknown as TableSource),
        columnGroups: (updated as unknown as TableSource).columnGroups ?? editColumnGroups,
      };
      // 同步到 store → SourcePanel 通过 watch store 自动同步本地列表
      setSelectedSource(updatedSource);
      const meta = await loadTable(updatedSource.id);
      setCurrentTable({
        ...(meta as unknown as TableMeta),
        columnGroups: (meta as unknown as TableMeta).columnGroups ?? editColumnGroups,
      });
      if ((updated as unknown as TableSource).columnGroups === undefined && editColumnGroups.length > 0) {
        message.warning("当前后端未返回表头分组字段，请重启开发环境后再次应用以持久化配置");
      } else {
        message.success("配置已更新");
      }
    } catch {
      message.error("更新配置失败");
    } finally {
      setLoading(false);
    }
  };

  // Modal 编辑数据源后，同步到 store selectedSource + toolbar config
  const handleSourceUpdated = (source: TableSource) => {
    setSelectedSource(source);
  };

  return (
    <Layout style={{ height: "100%", background: "#fff", overflow: "hidden" }}>
      <Sider width={280} theme="light" style={{ borderRight: "1px solid #f0f0f0", overflow: "auto" }}>
        <SourcePanel
          selectedId={selectedSource?.id ?? null}
          onSelect={handleSelectSource}
          onSourceUpdated={handleSourceUpdated}
        />
      </Sider>
      <Content style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
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

        {/* 数据源配置编辑条 — 仅表格视图显示 */}
        {viewMode === "table" && currentTable && selectedSource && (
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
              <Typography.Text style={{ fontSize: 12 }}>备注行</Typography.Text>
              <Select
                mode="tags"
                size="small"
                tokenSeparators={[","]}
                placeholder="行号"
                value={editRemarkRows.map(String)}
                onChange={(vals) => setEditRemarkRows(vals.map(Number))}
                style={{ minWidth: 120 }}
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
            <Space size={4}>
              <Typography.Text style={{ fontSize: 12 }}>表头分组</Typography.Text>
              <Button size="small" onClick={() => setColumnGroupsEditorOpen(true)}>
                管理（{editColumnGroups.length} 组）
              </Button>
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
          {viewMode === "page" && <PageView />}
        </div>

        <ColumnGroupsEditor
          open={columnGroupsEditorOpen}
          columns={currentTable?.columns ?? []}
          value={editColumnGroups}
          onOk={(groups) => {
            setEditColumnGroups(groups);
            setColumnGroupsEditorOpen(false);
          }}
          onCancel={() => setColumnGroupsEditorOpen(false)}
        />
      </Content>
    </Layout>
  );
}
