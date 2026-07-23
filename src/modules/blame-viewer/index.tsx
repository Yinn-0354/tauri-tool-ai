import { Layout, Button, Input, Segmented, Space, Typography, Tag, Tooltip, message } from "antd";
import { TeamOutlined, ClearOutlined } from "@ant-design/icons";
import type { VcsSource } from "@/api/blame";
import { fetchFileContent, fetchBlame } from "@/api/blame";
import { useBlameStore, type BlameStyle } from "@/stores/blameStore";
import Empty from "@/components/Empty";
import BlameSourcePanel from "./BlameSourcePanel";
import BlameContentView from "./BlameContentView";

const { Sider, Content } = Layout;
const { Text } = Typography;

const BLAME_STYLE_OPTIONS: { value: BlameStyle; label: string }[] = [
  { value: "grouped", label: "分组" },
  { value: "gutter", label: "逐行" },
  { value: "hover", label: "悬停" },
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

export default function BlameViewerModule() {
  const {
    selectedSource,
    setSelectedSource,
    fileIsBinary,
    setFileContent,
    setFileMeta,
    setFileLoading,
    setFileError,
    blameMode,
    blameStyle,
    blameLoading,
    setBlameLines,
    setBlameLoading,
    setBlameMode,
    setBlameStyle,
    searchQuery,
    setSearchQuery,
  } = useBlameStore();

  // 选中数据源（文件）→ 一次性加载全部内容
  const handleSelectSource = async (source: VcsSource) => {
    setSelectedSource(source); // 切源时重置内容/blame/搜索
    setFileLoading(true);
    try {
      const fc = await fetchFileContent(source.id);
      setFileContent(fc.content);
      setFileMeta({ isBinary: fc.isBinary });
      setFileError(false);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(detail || "读取文件内容失败");
      setFileContent("");
      setFileMeta({ isBinary: false });
      setFileError(true);
    } finally {
      setFileLoading(false);
    }
  };

  const handleFetchBlame = async () => {
    if (!selectedSource) return;
    if (selectedSource.type === "git") {
      message.warning("Git blame 暂未实现，请使用 SVN 代码源");
      return;
    }
    setBlameLoading(true);
    try {
      const lines = await fetchBlame(selectedSource.id);
      setBlameLines(lines);
      setBlameMode("blame");
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(
        detail ||
          "获取 Blame 失败（可能为二进制、未纳入版本控制，或 SVN 凭证未缓存/服务器不可达）",
      );
      setBlameMode("none");
    } finally {
      setBlameLoading(false);
    }
  };

  const handleClearBlame = () => {
    setBlameMode("none");
  };

  const blameActive = blameMode === "blame";

  return (
    <Layout style={{ height: "100%", background: "#fff", overflow: "hidden" }}>
      <Sider width={280} theme="light" style={{ borderRight: "1px solid #f0f0f0", overflow: "auto" }}>
        <BlameSourcePanel
          selectedId={selectedSource?.id ?? null}
          onSelect={handleSelectSource}
          onSourceUpdated={(source) => setSelectedSource(source)}
        />
      </Sider>

      <Content style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        {/* 工具栏 */}
        <div style={toolbarStyle}>
          <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
            {selectedSource ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <Tooltip title={selectedSource.path} placement="topLeft">
                  <Text strong ellipsis style={{ flexShrink: 0, maxWidth: 240 }}>
                    {selectedSource.alias || selectedSource.name}
                  </Text>
                </Tooltip>
                {fileIsBinary && (
                  <Tag color="default" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
                    二进制
                  </Tag>
                )}
              </div>
            ) : (
              <Text type="secondary">请先选择文件</Text>
            )}
          </div>

          {/* 二进制文件不显示搜索与 Blame 按钮 */}
          {selectedSource && !fileIsBinary && (
            <Space>
              <Input.Search
                placeholder="搜索文件内容"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                allowClear
                style={{ width: 200 }}
              />
              {blameActive ? (
                <Button icon={<ClearOutlined />} onClick={handleClearBlame}>
                  清除 Blame
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<TeamOutlined />}
                  onClick={handleFetchBlame}
                  loading={blameLoading}
                >
                  获取 Blame
                </Button>
              )}
            </Space>
          )}
        </div>

        {/* Blame 配置条 — 仅 blame 激活时显示 */}
        {selectedSource && blameActive && (
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
            <Text type="secondary" style={{ fontSize: 13 }}>
              Blame 样式
            </Text>
            <Segmented<BlameStyle>
              value={blameStyle}
              onChange={(val) => setBlameStyle(val as BlameStyle)}
              options={BLAME_STYLE_OPTIONS}
            />
            <Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>
              显示工作副本内容 + BASE 版本 blame
            </Text>
          </div>
        )}

        {/* 视图区域 */}
        <div style={viewAreaStyle}>
          {!selectedSource ? <Empty description="请先选择文件" /> : <BlameContentView />}
        </div>
      </Content>
    </Layout>
  );
}
