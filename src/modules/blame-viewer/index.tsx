import { Layout, Button, Input, Segmented, Space, Typography, Tag, Tooltip, message } from "antd";
import { TeamOutlined, ClearOutlined } from "@ant-design/icons";
import type { VcsSource } from "@/api/blame";
import { fetchFileContent, fetchFileLines, fetchBlame } from "@/api/blame";
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
    fileTruncated,
    fileTooLargeForBlame,
    setFileMeta,
    setFileLoading,
    setFileError,
    page,
    pageSize,
    setPage,
    setPageSize,
    setTotalLines,
    setPageLines,
    setPageLoading,
    blameMode,
    blameStyle,
    blameLoading,
    setBlameLines,
    setBlameTotalLines,
    setBlameLoading,
    setBlameMode,
    setBlameStyle,
    searchQuery,
    setSearchQuery,
  } = useBlameStore();

  // 加载纯内容的一页
  const loadContentPage = async (sourceId: string, p: number, ps: number) => {
    setPageLoading(true);
    try {
      const res = await fetchFileLines(sourceId, p, ps);
      setPageLines(res.lines);
      setTotalLines(res.totalLines);
      setPage(res.page);
      setFileError(false);
    } catch {
      message.error("读取文件内容失败");
      setPageLines([]);
      setTotalLines(0);
      setFileError(true);
    } finally {
      setPageLoading(false);
    }
  };

  // 加载 blame 的一页
  const loadBlamePage = async (sourceId: string, p: number, ps: number) => {
    setBlameLoading(true);
    try {
      const res = await fetchBlame(sourceId, p, ps);
      setBlameLines(res.lines);
      setBlameTotalLines(res.totalLines);
      setPage(res.page);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(
        detail ||
          "获取 Blame 失败（可能文件过大、为二进制、未纳入版本控制，或 SVN 服务器不可达）",
      );
      setBlameMode("none");
      setBlameLines(null);
    } finally {
      setBlameLoading(false);
    }
  };

  // 选中数据源（文件）→ 拿元信息 + 第一页内容
  const handleSelectSource = async (source: VcsSource) => {
    setSelectedSource(source); // 切源时重置内容/blame/分页/搜索
    setFileLoading(true);
    let isBinary = false;
    try {
      const fc = await fetchFileContent(source.id);
      setFileMeta({
        isBinary: fc.isBinary,
        truncated: fc.truncated,
        tooLargeForBlame: fc.tooLargeForBlame,
      });
      setFileError(false);
      isBinary = fc.isBinary;
    } catch {
      message.error("读取文件信息失败");
      setFileMeta({ isBinary: false, truncated: false, tooLargeForBlame: false });
      setFileError(true);
      setFileLoading(false);
      return;
    }
    setFileLoading(false);
    if (!isBinary) {
      loadContentPage(source.id, 1, pageSize);
    }
  };

  // 翻页（纯内容或 blame 共用 page/pageSize；根据当前模式请求对应端点）
  const handlePageChange = (p: number, ps: number) => {
    if (!selectedSource) return;
    setPageSize(ps);
    if (blameMode === "blame") {
      loadBlamePage(selectedSource.id, p, ps);
    } else {
      loadContentPage(selectedSource.id, p, ps);
    }
  };

  const handleFetchBlame = async () => {
    if (!selectedSource) return;
    if (selectedSource.type === "git") {
      message.warning("Git blame 暂未实现，请使用 SVN 代码源");
      return;
    }
    setBlameMode("blame");
    setPage(1);
    await loadBlamePage(selectedSource.id, 1, pageSize);
  };

  const handleClearBlame = async () => {
    setBlameMode("none");
    setBlameLines(null);
    if (selectedSource) {
      // 回到纯内容当前页
      await loadContentPage(selectedSource.id, page, pageSize);
    }
  };

  const blameActive = blameMode === "blame";
  const blameDisabled = fileIsBinary || fileTooLargeForBlame;

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
                placeholder="搜索当前页内容"
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
                <Tooltip
                  title={fileTooLargeForBlame ? "文件过大（>10MB），暂不支持 Blame" : undefined}
                >
                  <Button
                    type="primary"
                    icon={<TeamOutlined />}
                    onClick={handleFetchBlame}
                    loading={blameLoading}
                    disabled={blameDisabled}
                  >
                    获取 Blame
                  </Button>
                </Tooltip>
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
          {!selectedSource ? <Empty description="请先选择文件" /> : <BlameContentView onPageChange={handlePageChange} />}
        </div>

        {/* 截断/过大提示 */}
        {selectedSource && (fileTruncated || fileTooLargeForBlame) && (
          <div
            style={{
              flexShrink: 0,
              padding: "4px 16px",
              background: "#fffbe6",
              borderTop: "1px solid #f0f0f0",
              fontSize: 12,
              color: "#ad6800",
            }}
          >
            {fileTruncated && "文件较大，仅显示前 10MB 内容。"}
            {fileTooLargeForBlame && " 文件超过 10MB，暂不支持 Blame。"}
          </div>
        )}
      </Content>
    </Layout>
  );
}
