import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Tabs } from "antd";
import {
  TableOutlined,
  HistoryOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useTabStore } from "@/stores/tabStore";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "/table-viewer", icon: <TableOutlined />, label: "表格查看器" },
  { key: "/blame-viewer", icon: <HistoryOutlined />, label: "Blame 查看器" },
  { key: "/ai-agent", icon: <RobotOutlined />, label: "AI Agent" },
];

const logoStyle: React.CSSProperties = {
  height: 48,
  margin: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 16,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

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
      <Sider width={200} theme="dark">
        <div style={logoStyle}>
          Tauri Tool AI
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
