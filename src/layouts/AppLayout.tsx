import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Tabs, Button } from "antd";
import {
  TableOutlined,
  HistoryOutlined,
  RobotOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import { useTabStore } from "@/stores/tabStore";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "/table-viewer", icon: <TableOutlined />, label: "表格查看器" },
  { key: "/blame-viewer", icon: <HistoryOutlined />, label: "Blame 查看器" },
  { key: "/ai-agent", icon: <RobotOutlined />, label: "AI Agent" },
];

const tabsStyle: React.CSSProperties = {
  paddingLeft: 8,
  paddingTop: 8,
  background: "#fff",
  flexShrink: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  background: "#f5f5f5",
  minHeight: 0,
  position: "relative",
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeKey, openTab, closeTab, setActiveKey } = useTabStore();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const currentModule = menuItems.find((m) => m.key === location.pathname);
    if (currentModule) {
      openTab({
        key: currentModule.key,
        label: currentModule.label,
        closable: true,
      });
    }
  }, [location.pathname, openTab]);

  const currentActive = activeKey || location.pathname;

  return (
    <Layout style={{ height: "100vh", overflow: "hidden" }}>
      <Sider
        width={200}
        collapsedWidth={64}
        collapsed={collapsed}
        collapsible
        trigger={null}
        theme="dark"
      >
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            padding: collapsed ? 0 : "0 12px 0 16px",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {!collapsed && <span>Tauri Tool AI</span>}
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((c) => !c)}
            style={{ color: "#fff" }}
          />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[currentActive]}
          items={menuItems}
          onClick={({ key }) => {
            navigate(key);
          }}
        />
      </Sider>
      <Layout style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Tabs
          activeKey={currentActive}
          type="editable-card"
          hideAdd
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            closable: tab.closable,
          }))}
          onChange={(key) => {
            setActiveKey(key);
            navigate(key);
          }}
          onEdit={(key, action) => {
            if (action === "remove" && typeof key === "string") {
              const idx = tabs.findIndex((t) => t.key === key);
              closeTab(key);
              // 在 closeTab 之后，用过滤后的 tabs 计算下一个标签
              const remaining = tabs.filter((t) => t.key !== key);
              if (remaining.length > 0) {
                const nextIdx = Math.min(idx, remaining.length - 1);
                navigate(remaining[nextIdx].key);
              }
            }
          }}
          style={tabsStyle}
        />
        <Content style={contentStyle}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
