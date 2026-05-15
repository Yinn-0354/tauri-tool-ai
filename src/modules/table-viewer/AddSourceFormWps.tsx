import { Form, Input } from "antd";

export default function AddSourceFormWps() {
  return (
    <Form.Item
      name="path"
      label="URL 地址"
      rules={[{ required: true, message: "请输入 WPS 表格地址" }]}
    >
      <Input placeholder="输入 WPS 在线表格 URL" />
    </Form.Item>
  );
}
