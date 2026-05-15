import { useState } from "react";
import { Modal, Form, Input, Select, message } from "antd";
import type { TableSource } from "@/api/table";
import { addSource } from "@/api/table";
import AddSourceFormFile from "./AddSourceFormFile";
import AddSourceFormWps from "./AddSourceFormWps";
import AddSourceFormDb from "./AddSourceFormDb";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (source: TableSource) => void;
}

export default function AddSourceModal({ open, onClose, onAdded }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const sourceType = Form.useWatch("type", form);

  const handleOk = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      let path = values.path;
      if (values.type === "db") {
        path = JSON.stringify({
          host: values.dbHost,
          port: values.dbPort,
          user: values.dbUser,
          password: values.dbPassword,
        });
      }
      const source = await addSource(values.name, values.type, path);
      message.success("数据源已添加");
      onAdded(source as unknown as TableSource);
      form.resetFields();
      onClose();
    } catch {
      message.error("添加失败");
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => {
    switch (sourceType) {
      case "file":
        return <AddSourceFormFile />;
      case "wps":
        return <AddSourceFormWps />;
      case "db":
        return <AddSourceFormDb />;
      default:
        return null;
    }
  };

  return (
    <Modal
      title="添加数据源"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
    >
      <Form form={form} layout="vertical" initialValues={{ type: "file" }}>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "file", label: "本地文件" },
              { value: "wps", label: "WPS 在线表格" },
              { value: "db", label: "数据库" },
            ]}
          />
        </Form.Item>

        {renderForm()}

        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请输入名称" }]}
        >
          <Input placeholder="数据源名称" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
