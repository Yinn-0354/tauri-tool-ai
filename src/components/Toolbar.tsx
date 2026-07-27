import { useState } from "react";
import { Button, Tooltip, Input, Spin, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  FolderOpenOutlined,
  DownloadOutlined,
  BranchesOutlined,
  SearchOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import { useTableStore } from "../store/tableStore";

/** 查找命中条目(与 TableView.SearchMatch 同构)。 */
export interface SearchMatch {
  rowIndex: number; // 0-based,剔除跳过行后
  colIndex: number;
  colName: string;
  value: string;
}

interface ToolbarProps {
  /** 「打开表格」/「选择文件」回调。 */
  onOpen: () => void;
  /** 「获取 Blame」回调。仅在 tableId 存在时显示。 */
  onFetchBlame: () => void;
  /** 「导出 CSV」回调。仅在 tableId 存在时显示。 */
  onExportCsv: () => void;
  /** 全表查找回调。返回命中列表 + total。 */
  onSearch: (query: string) => Promise<{ matches: SearchMatch[]; total: number }>;
  /** 跳转到指定行/列。 */
  onJumpTo: (rowIndex: number, colIndex: number) => void;
  /** 是否正在解析文件(打开按钮 loading)。 */
  opening: boolean;
}

/**
 * 顶部工具栏(固定高 44px)。
 * 左:模块小标题(mono muted,如 "TABLE VIEWER")+ 打开按钮 + 文件路径(truncated)。
 * 右:行列 chip + 查找按钮(带下拉输入与结果)+ 获取 Blame 按钮 + 导出 CSV 按钮。
 *
 * 铁律:固定高度容器,绝不让内容撑高产生页面级滚动条(需求7)。
 * 查找用 AntD Dropdown 包裹按钮(trigger=click),overlay 内为输入框 + 结果列表。
 * Dropdown 的 overlay 自动 portal 到 body,不会撑高工具栏;overlay 内部固定高度 + 滚动。
 */
export default function Toolbar({
  onOpen,
  onFetchBlame,
  onExportCsv,
  onSearch,
  onJumpTo,
  opening,
}: ToolbarProps) {
  const tableId = useTableStore((s) => s.tableId);
  const filePath = useTableStore((s) => s.filePath);
  const rowCount = useTableStore((s) => s.rowCount);
  const columns = useTableStore((s) => s.columns);
  const blameLoading = useTableStore((s) => s.blameLoading);
  const blameLoaded = useTableStore((s) => s.blameLoaded);
  const blameCount = useTableStore((s) => s.blameCount);
  const blameError = useTableStore((s) => s.blameError);
  const filterEnabled = useTableStore((s) => s.filterEnabled);
  const filters = useTableStore((s) => s.filters);
  const setFilterEnabled = useTableStore((s) => s.setFilterEnabled);
  const clearAllFilters = useTableStore((s) => s.clearAllFilters);

  const hasTable = tableId !== null;
  // 已筛选的列数(用于开关按钮角标)
  const activeFilterCount = Object.values(filters).filter((v) => v && v.length > 0).length;

  // blame 按钮文案:加载中 → "获取中";完成 → "Blame ✓ N";未加载 → "获取 Blame"
  const blameLabel = blameLoaded
    ? `Blame ✓ ${blameCount.toLocaleString()}`
    : "获取 Blame";

  const blameTooltip = blameError
    ? `blame 失败:${blameError}`
    : "对 SVN 工作副本执行 svn blame,显示每行作者";

  // 查找 UI 状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setTotal(0);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await onSearch(q);
      setMatches(res.matches);
      setTotal(res.total);
    } catch (e) {
      setSearchError(String(e instanceof Error ? e.message : e));
      setMatches([]);
      setTotal(0);
    } finally {
      setSearching(false);
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  };

  const onResultClick = (m: SearchMatch) => {
    onJumpTo(m.rowIndex, m.colIndex);
    // 不关闭下拉,便于连续查看下一条
  };

  // Dropdown overlay:输入框 + 结果列表 + 底部统计。
  // 用 menu prop(AntD v5 Dropdown 推荐用 menu.items),但此处 overlay 是自定义非菜单内容,
  // 用 dropdownRender 更合适。但 AntD v5 Dropdown 支持 dropdownRender。
  const searchOverlay = (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        width: 360,
        boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 输入框 */}
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
        <Input
          autoFocus
          size="small"
          placeholder="输入关键字回车全表查找"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          suffix={
            searching ? (
              <Spin size="small" />
            ) : (
              <SearchOutlined style={{ color: "var(--text-dim)" }} />
            )
          }
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border-strong)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
          }}
        />
      </div>

      {/* 结果区 */}
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        {searchError ? (
          <div
            style={{
              padding: 12,
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            查找失败:{searchError}
          </div>
        ) : matches.length === 0 ? (
          <div
            style={{
              padding: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {query.trim() === ""
              ? "输入关键字后回车"
              : searching
                ? "查找中…"
                : "无命中"}
          </div>
        ) : (
          matches.map((m, i) => (
            <div
              key={i}
              onClick={() => onResultClick(m)}
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                display: "flex",
                gap: 8,
                alignItems: "center",
                color: "var(--text-muted)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-panel)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ color: "var(--accent)", flex: "0 0 auto" }}>
                行{m.rowIndex + 1}
              </span>
              <span style={{ color: "var(--text-dim)", flex: "0 0 auto" }}>
                列{m.colIndex + 1}
              </span>
              <span style={{ color: "var(--text-dim)", flex: "0 0 auto" }}>
                {m.colName}
              </span>
              <span
                style={{
                  color: "var(--text)",
                  flex: "1 1 auto",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
                title={m.value}
              >
                {m.value}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 底部统计 */}
      {matches.length > 0 && (
        <div
          style={{
            padding: "6px 10px",
            borderTop: "1px solid var(--border)",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          显示 {matches.length} / 共 {total.toLocaleString()} 条命中
        </div>
      )}
    </div>
  );

  // AntD v5 Dropdown:用 dropdownRender 渲染自定义 overlay,trigger=click。
  // menu 留空(AntD v5 MenuProps 要求非空,这里用 dropdownRender 时 menu 可省略,
  // 但 TS 类型要求 menu 或 dropdownRender 之一;实际 dropdownRender 是 Dropdown 的合法 prop。)
  const dropdownMenu: MenuProps = { items: [] };

  return (
    <div
      style={{
        height: 44,
        flex: "0 0 44px",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        minWidth: 0,
      }}
    >
      {/* 左:模块小标题(mono muted) */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          fontSize: 12,
          letterSpacing: ".04em",
          flex: "0 0 auto",
        }}
      >
        TABLE VIEWER
      </span>

      <Button
        type="primary"
        icon={<FolderOpenOutlined />}
        loading={opening}
        onClick={onOpen}
        style={{
          background: "var(--accent)",
          borderColor: "var(--accent)",
          color: "#0e1113",
          fontWeight: 500,
        }}
      >
        打开表格
      </Button>

      {/* 文件路径(muted, truncated, max-width 40vw) */}
      {filePath && (
        <span
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "40vw",
            flex: "1 1 auto",
            minWidth: 0,
          }}
          title={filePath}
        >
          {filePath}
        </span>
      )}

      {/* spacer */}
      <div style={{ flex: "1 0 auto" }} />

      {/* 行/列 chip(仅 hasTable) */}
      {hasTable && rowCount !== null && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            fontSize: 12,
            padding: "2px 8px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            flex: "0 0 auto",
          }}
        >
          {rowCount.toLocaleString()} 行 · {columns.length} 列
        </span>
      )}

      {/* 列筛选总开关(仅 hasTable):开关默认开,开启时表头显示漏斗;关闭则收起漏斗并清空筛选。 */}
      {hasTable && (
        <>
          <Tooltip title={filterEnabled ? "筛选已开启:点表头漏斗按列筛选。点击关闭收起漏斗" : "筛选已关闭:表头无漏斗。点击开启"}>
            <Button
              size="small"
              icon={<FilterOutlined />}
              onClick={() => setFilterEnabled(!filterEnabled)}
              style={{
                color: filterEnabled ? "var(--accent)" : "var(--text)",
                borderColor: filterEnabled ? "var(--accent-dim)" : "var(--border-strong)",
                background: filterEnabled ? "var(--accent-soft)" : "transparent",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              筛选
              {activeFilterCount > 0 && (
                <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 600 }}>
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </Tooltip>
          {activeFilterCount > 0 && (
            <Tooltip title="清除所有列筛选">
              <Button
                size="small"
                onClick={clearAllFilters}
                style={{
                  color: "var(--text-muted)",
                  borderColor: "var(--border-strong)",
                  background: "transparent",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                清筛选
              </Button>
            </Tooltip>
          )}
        </>
      )}

      {/* 查找(ghost,仅 tableId 存在):Dropdown 包裹按钮,trigger=click */}
      {hasTable && (
        <Dropdown
          menu={dropdownMenu}
          dropdownRender={() => searchOverlay}
          trigger={["click"]}
          open={searchOpen}
          onOpenChange={(o) => setSearchOpen(o)}
          placement="bottomRight"
        >
          <Button
            size="small"
            icon={<SearchOutlined />}
            title="全表查找(后端扫描,大小写不敏感)"
            style={{
              color: "var(--text)",
              borderColor: "var(--border-strong)",
              background: "transparent",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
        </Dropdown>
      )}

      {/* 获取 Blame(ghost,仅 tableId 存在) */}
      {hasTable && (
        <Tooltip title={blameTooltip}>
          <Button
            size="small"
            loading={blameLoading}
            onClick={onFetchBlame}
            style={{
              color: blameLoaded ? "var(--accent)" : "var(--text)",
              borderColor: blameLoaded ? "var(--accent-dim)" : "var(--border-strong)",
              background: blameLoaded ? "var(--accent-soft)" : "transparent",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            {!blameLoading && <BranchesOutlined />}
            {blameLabel}
          </Button>
        </Tooltip>
      )}

      {/* 导出 CSV(ghost,仅 tableId 存在) */}
      {hasTable && (
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={onExportCsv}
          style={{
            color: "var(--text)",
            borderColor: "var(--border-strong)",
            background: "transparent",
            fontSize: 12,
          }}
        >
          导出 CSV
        </Button>
      )}
    </div>
  );
}
