import { Form, Input } from "antd";

export default function AddSourceFormDb() {
  return (
    <>
      <Form.Item
        name="dbHost"
        label="数据库 IP"
        rules={[{ required: true, message: "请输入数据库 IP" }]}
      >
        <Input placeholder="127.0.0.1" />
      </Form.Item>
      <Form.Item
        name="dbPort"
        label="端口"
        rules={[{ required: true, message: "请输入端口" }]}
      >
        <Input placeholder="3306" />
      </Form.Item>
      <Form.Item
        name="dbUser"
        label="用户名"
        rules={[{ required: true, message: "请输入用户名" }]}
      >
        <Input placeholder="root" />
      </Form.Item>
      <Form.Item name="dbPassword" label="密码">
        <Input.Password placeholder="输入密码" />
      </Form.Item>
    </>
  );
}
