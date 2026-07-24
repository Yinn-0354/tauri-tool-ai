import { Button, Tooltip } from "antd";
import { FolderOpenOutlined, DownloadOutlined, BranchesOutlined } from "@ant-design/icons";
import { useTableStore } from "../store/tableStore";

interface ToolbarProps {
  /** 「打开表格」/「选择文件」回调。 */
  onOpen: () => void;
  /** 「获取 Blame」回调。仅在 tableId 存在时显示。 */
  onFetchBlame: () => void;
  /** 「导出 CSV」回调。仅在 tableId 存在时显示。 */
  onExportCsv: () => void;
  /** 是否正在解析文件(打开按钮 loading)。 */
  opening: boolean;
}

/**
 * 顶部工具栏(固定高 44px)。
 * 左:模块小标题(mono muted,如 "TABLE VIEWER")+ 打开按钮 + 文件路径(truncated)。
 * 右:行列 chip + 获取 Blame 按钮 + 导出 CSV 按钮。
 *
 * 铁律:固定高度容器,绝不让内容撑高产生页面级滚动条(需求7)。
 */
export default function Toolbar({
  onOpen,
  onFetchBlame,
  onExportCsv,
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

  const hasTable = tableId !== null;

  // blame 按钮文案:加载中 → "获取中";完成 → "Blame ✓ N";未加载 → "获取 Blame"
  const blameLabel = blameLoaded
    ? `Blame ✓ ${blameCount.toLocaleString()}`
    : "获取 Blame";

  const blameTooltip = blameError
    ? `blame 失败:${blameError}`
    : "对 SVN 工作副本执行 svn blame,显示每行作者";

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
