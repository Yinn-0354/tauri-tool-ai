import { useState, useEffect } from "react";
import { Modal, Form, Input, Select, message } from "antd";
import type { TableSource } from "@/api/table";
import { addSource, updateSource } from "@/api/table";
import AddSourceFormFile from "./AddSourceFormFile";
import AddSourceFormWps from "./AddSourceFormWps";
import AddSourceFormDb from "./AddSourceFormDb";

const SOURCE_TYPE_OPTIONS = [
  { value: "file", label: "本地文件" },
  { value: "wps", label: "WPS 在线表格" },
  { value: "db", label: "数据库" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (source: TableSource) => void;
  editingSource?: TableSource | null;
  onUpdated?: (source: TableSource) => void;
}

export default function AddSourceModal({ open, onClose, onAdded, editingSource, onUpdated }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const sourceType = Form.useWatch("type", form);
  const isEdit = !!editingSource;

  useEffect(() => {
    if (open && editingSource) {
      form.setFieldsValue({
        type: editingSource.type,
        name: editingSource.name,
        alias: editingSource.alias ?? "",
        path: editingSource.path,
        headerRow: editingSource.headerRow ?? 1,
        skipRows: (editingSource.skipRows ?? []).map(String),
      });
    } else if (open) {
      form.resetFields();
    }
  }, [open, editingSource, form]);

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

      if (isEdit && editingSource) {
        const updated = await updateSource(editingSource.id, {
          name: values.name,
          alias: values.alias ?? "",
          headerRow: values.headerRow ?? 1,
          skipRows: (values.skipRows ?? []).map(Number),
        });
        message.success("数据源已更新");
        onUpdated?.(updated as unknown as TableSource);
      } else {
        const source = await addSource(
          values.name,
          values.type,
          path,
          values.alias ?? "",
          values.headerRow ?? 1,
          (values.skipRows ?? []).map(Number),
        );
        message.success("数据源已添加");
        onAdded(source as unknown as TableSource);
      }

      form.resetFields();
      onClose();
    } catch {
      message.error(isEdit ? "更新失败" : "添加失败");
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
      title={isEdit ? "编辑数据源" : "添加数据源"}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: "file", headerRow: 1, skipRows: [] }}
      >
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select options={SOURCE_TYPE_OPTIONS} disabled={isEdit} />
        </Form.Item>

        {renderForm()}

        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请输入名称" }]}
        >
          <Input placeholder="数据源名称" />
        </Form.Item>

        <Form.Item name="alias" label="别名" tooltip="列表中优先显示的自定义名称">
          <Input placeholder="可选，留空则显示原始名称" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
