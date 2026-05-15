import { Typography } from "antd";

const { Title, Paragraph } = Typography;

export default function BlameViewerModule() {
  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Blame 查看器</Title>
      <Paragraph type="secondary">
        可视化展示 SVN / Git 文件的逐行提交历史，包括版本号、作者、时间和内容。
      </Paragraph>
    </div>
  );
}
