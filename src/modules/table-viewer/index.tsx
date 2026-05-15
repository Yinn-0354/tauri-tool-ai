import { useState } from "react";
import { Layout, Segmented, Button, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { TableSource, TableMeta } from "@/api/table";
import { loadTable } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import SourcePanel from "./SourcePanel";
import TableView from "./TableView";
import CardView from "./CardView";
import TemplateView from "./TemplateView";

const { Sider, Content } = Layout;

type ViewMode = "table" | "card" | "template";

export default function TableViewerModule() {
  const { viewMode, setViewMode, currentTable, setCurrentTable } = useTableViewerStore();
  const [selectedSource, setSelectedSource] = useState<TableSource | null>(null);
  const [loading, setLoading] = useState(false);

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
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Segmented<ViewMode>
            value={viewMode}
            onChange={(val) => setViewMode(val as ViewMode)}
            options={[
              { value: "table", label: "表格" },
              { value: "card", label: "卡片" },
              { value: "template", label: "模板" },
            ]}
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

        {/* 视图区域 — 填充剩余高度，滚动由各子组件自己处理 */}
        <div style={{ flex: 1, padding: "12px 16px", minHeight: 0 }}>
          {viewMode === "table" && <TableView />}
          {viewMode === "card" && <CardView />}
          {viewMode === "template" && <TemplateView />}
        </div>
      </Content>
    </Layout>
  );
}
