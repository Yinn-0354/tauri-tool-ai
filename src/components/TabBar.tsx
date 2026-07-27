import { Tooltip } from "antd";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import { useTableStore } from "../store/tableStore";

/**
 * 自绘标签栏(多表格多 tab)。放右侧内容区 Toolbar 下方、主区上方,固定 34px。
 *
 * - 每个 tab 显示文件名(basename,完整路径 tooltip)+ 关闭 ×。
 * - 活动 tab:顶部 2px accent 竖条 + accent-soft 背景(复用 Sidebar NavIcon 视觉语言)。
 * - 非活动 tab:muted 文字 + 透明背景,hover 时 bg-elevated。
 * - 右侧 + 按钮新开(复用 Toolbar 打开流程)。
 * - 仅在 tabOrder.length > 0 时渲染(无 tab 时由 EmptyState 占位,不显示空标签栏)。
 * - 关闭活动 tab 后 store 自动激活相邻(右优先)。
 */
interface TabBarProps {
  /** 新开 tab:复用 App 的打开文件流程。 */
  onOpen: () => void;
}

/** 取路径 basename(最后一段)作 tab 标题。 */
function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

export default function TabBar({ onOpen }: TabBarProps) {
  const tabOrder = useTableStore((s) => s.tabOrder);
  const tabs = useTableStore((s) => s.tabs);
  const activeTabId = useTableStore((s) => s.activeTabId);
  const switchTab = useTableStore((s) => s.switchTab);
  const closeTab = useTableStore((s) => s.closeTab);

  if (tabOrder.length === 0) return null;

  return (
    <div
      style={{
        flex: "0 0 34px",
        minHeight: 0,
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {tabOrder.map((id) => {
          const tab = tabs[id];
          if (!tab) return null;
          const active = id === activeTabId;
          return (
            <div
              key={id}
              onClick={() => switchTab(id)}
              onAuxClick={(e) => {
                // 中键关闭
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(id);
                }
              }}
              title={tab.filePath}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                minWidth: 120,
                maxWidth: 220,
                cursor: "pointer",
                color: active ? "var(--text)" : "var(--text-muted)",
                background: active ? "var(--accent-soft)" : "transparent",
                borderRight: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "var(--bg-elevated)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {/* 活动 tab 顶部 accent 竖条 */}
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: 2,
                    background: "var(--accent)",
                  }}
                />
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: "1 1 auto",
                }}
              >
                {basename(tab.filePath)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: 11,
                  lineHeight: 1,
                  flexShrink: 0,
                  borderRadius: 3,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
                title="关闭"
              >
                <CloseOutlined />
              </button>
            </div>
          );
        })}
      </div>

      {/* 新开 tab */}
      <Tooltip title="打开文件(新标签页)">
        <button
          onClick={onOpen}
          style={{
            flex: "0 0 auto",
            width: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderLeft: "1px solid var(--border)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 14,
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
          <PlusOutlined />
        </button>
      </Tooltip>
    </div>
  );
}
