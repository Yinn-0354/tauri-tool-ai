import { Typography } from "antd";

const { Title, Paragraph } = Typography;

export default function AiAgentModule() {
  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>AI Agent</Title>
      <Paragraph type="secondary">AI 对话面板，支持多模型切换与流式响应。</Paragraph>
    </div>
  );
}
