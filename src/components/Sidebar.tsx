import { Tooltip } from "antd";
import { TableOutlined, CheckCircleOutlined, SunOutlined, MoonOutlined } from "@ant-design/icons";
import { useNavStore } from "../store/navStore";
import { useThemeStore } from "../store/themeStore";

/**
 * 左侧 56px 图标导航栏。
 * - 模块1 表格查看器(激活):图标 accent + 左侧 3px accent 竖条 + 浅 accent-soft 背景。
 * - 模块2 结果核对器:未实现,禁用态(opacity .4, cursor not-allowed),tooltip "即将开放"。
 * - 顶部 logo 块(mono "C" 在 accent 色方块里)。
 * - 底部设置图标(可选,目前仅装饰)。
 */
export default function Sidebar() {
  const active = useNavStore((s) => s.active);
  const setActive = useNavStore((s) => s.setActive);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <div
      style={{
        width: 56,
        flex: "0 0 56px",
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 4,
      }}
    >
      {/* logo 块 */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "var(--accent)",
          color: "#0e1113",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          fontSize: 16,
          marginBottom: 10,
          userSelect: "none",
        }}
      >
        C
      </div>

      <NavIcon
        active={active === "table"}
        onClick={() => setActive("table")}
        label="表格查看器"
        icon={<TableOutlined />}
      />
      <NavIcon
        active={false}
        disabled
        onClick={() => {
          /* 即将开放,不响应点击 */
        }}
        label="即将开放"
        icon={<CheckCircleOutlined />}
      />

      {/* 底部 spacer + 主题切换 */}
      <div style={{ flex: 1 }} />
      <Tooltip title={theme === "dark" ? "切换浅色主题" : "切换深色主题"} placement="right">
        <div
          onClick={toggleTheme}
          style={{
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            cursor: "pointer",
            borderRadius: 4,
            transition: "color .15s, background .15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--accent)";
            e.currentTarget.style.background = "var(--accent-soft)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          {theme === "dark" ? <SunOutlined /> : <MoonOutlined />}
        </div>
      </Tooltip>
    </div>
  );
}

interface NavIconProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function NavIcon({ active, disabled, onClick, label, icon }: NavIconProps) {
  return (
    <Tooltip title={label} placement="right">
      <div
        onClick={disabled ? undefined : onClick}
        style={{
          position: "relative",
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: active ? "var(--accent)" : "var(--text-muted)",
          background: active ? "var(--accent-soft)" : "transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          borderRadius: 4,
          transition: "background .15s, color .15s",
        }}
        onMouseEnter={(e) => {
          if (!disabled && !active) {
            e.currentTarget.style.background = "var(--bg-elevated)";
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && !active) {
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        {/* 激活态左侧 3px accent 竖条 */}
        {active && (
          <span
            style={{
              position: "absolute",
              left: -10,
              top: 4,
              bottom: 4,
              width: 3,
              background: "var(--accent)",
              borderRadius: 2,
            }}
          />
        )}
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      </div>
    </Tooltip>
  );
}
