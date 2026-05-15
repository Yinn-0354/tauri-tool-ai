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

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeKey, openTab, closeTab, setActiveKey } = useTabStore();

  // 首次进入或刷新时，根据路径打开标签
  useEffect(() => {
    const currentModule = menuItems.find((m) => m.key === location.pathname);
    if (currentModule) {
      openTab({
        key: currentModule.key,
        label: currentModule.label,
        closable: true,
      });
    }
  }, [location.pathname]);

  // tabs 为空时用当前路径作为 active key
  const currentActive = activeKey || location.pathname;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} theme="dark">
        <div
          style={{
            height: 48,
            margin: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
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
      <Layout>
        <Content style={{ margin: 0 }}>
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
                if (tabs.length > 1) {
                  const nextIdx = Math.min(idx, tabs.length - 2);
                  const nextTab = tabs.filter((t) => t.key !== key)[nextIdx];
                  if (nextTab) {
                    navigate(nextTab.key);
                  }
                }
              }
            }}
            style={{
              paddingLeft: 8,
              paddingTop: 8,
              background: "#fff",
            }}
          />
          <div style={{ padding: 0, background: "#f5f5f5", minHeight: "calc(100vh - 56px)" }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
