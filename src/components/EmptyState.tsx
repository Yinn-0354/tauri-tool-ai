import { Button } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";

interface EmptyStateProps {
  /** 主按钮点击回调:等同工具栏「打开表格」。 */
  onOpen: () => void;
  /** 是否正在解析文件(按钮 loading 态)。 */
  loading?: boolean;
}

/**
 * 未选文件时的空状态(需求3:不是 loading)。
 * 居中大 mono 标题 + 副标题 + prominent 选择文件按钮。
 * 用 border 画几条线表现数据网格(opacity .15)作装饰。
 */
export default function EmptyState({ onOpen, loading }: EmptyStateProps) {
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        overflow: "hidden",
      }}
    >
      {/* 装饰:淡网格线(opacity .15) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.15,
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "32px 28px",
          backgroundPosition: "center",
          maskImage:
            "radial-gradient(ellipse at center, #000 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, #000 0%, transparent 70%)",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 20,
            letterSpacing: ".02em",
            color: "var(--text)",
            fontWeight: 500,
          }}
        >
          打开配置表
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--text-muted)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}
        >
          支持 .xlsx / .xls / .tab / .txt / .tsv
        </p>
        <Button
          type="primary"
          size="large"
          icon={<FolderOpenOutlined />}
          loading={loading}
          onClick={onOpen}
          style={{
            background: "var(--accent)",
            borderColor: "var(--accent)",
            color: "#0e1113",
            fontWeight: 500,
            height: 40,
            paddingInline: 22,
          }}
        >
          选择文件
        </Button>
      </div>
    </div>
  );
}
