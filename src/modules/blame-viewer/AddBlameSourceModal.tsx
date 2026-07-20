import { useState, useEffect } from "react";
import { Modal, Form, Input, Select, message } from "antd";
import type { VcsSource } from "@/api/blame";
import { addVcsSource, updateVcsSource } from "@/api/blame";
import AddBlameSourceFormPath from "./AddBlameSourceFormPath";

const SOURCE_TYPE_OPTIONS = [
  { value: "svn", label: "SVN" },
  { value: "git", label: "Git（即将支持 blame）" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (source: VcsSource) => void;
  editingSource?: VcsSource | null;
  onUpdated?: (source: VcsSource) => void;
}

export default function AddBlameSourceModal({
  open,
  onClose,
  onAdded,
  editingSource,
  onUpdated,
}: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isEdit = !!editingSource;

  useEffect(() => {
    if (open && editingSource) {
      form.setFieldsValue({
        type: editingSource.type,
        name: editingSource.name,
        alias: editingSource.alias ?? "",
        path: editingSource.path,
      });
    } else if (open) {
      form.resetFields();
    }
  }, [open, editingSource, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      if (isEdit && editingSource) {
        const updated = await updateVcsSource(editingSource.id, {
          name: values.name,
          alias: values.alias ?? "",
          path: values.path,
        });
        message.success("代码源已更新");
        onUpdated?.(updated as unknown as VcsSource);
      } else {
        const source = await addVcsSource({
          name: values.name,
          type: values.type,
          path: values.path,
          alias: values.alias ?? "",
        });
        message.success("代码源已添加");
        onAdded(source as unknown as VcsSource);
      }
      form.resetFields();
      onClose();
    } catch {
      message.error(isEdit ? "更新失败" : "添加失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "编辑代码源" : "添加代码源"}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
    >
      <Form form={form} layout="vertical" initialValues={{ type: "svn" }}>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select options={SOURCE_TYPE_OPTIONS} disabled={isEdit} />
        </Form.Item>

        <AddBlameSourceFormPath />

        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请输入名称" }]}
        >
          <Input placeholder="代码源名称" />
        </Form.Item>

        <Form.Item name="alias" label="别名" tooltip="列表中优先显示的自定义名称">
          <Input placeholder="可选，留空则显示原始名称" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
