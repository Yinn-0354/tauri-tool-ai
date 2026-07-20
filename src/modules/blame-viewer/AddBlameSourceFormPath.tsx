import { Form, Input, Button } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";

/**
 * 代码源路径选择子表单 — 数据源以文件为单位：选择一个文件（SVN 工作副本中的文件）。
 * 通过 Tauri 原生文件选择器拾取；非 Tauri 环境（如纯浏览器开发）可手动输入。
 */
export default function AddBlameSourceFormPath() {
  const form = Form.useFormInstance();

  const handlePickFile = async () => {
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          title: "选择文件",
          // 不限扩展名：配置表/脚本/文本等都可；SVN 工作副本中的任意文本文件
          multiple: false,
        });
        if (selected && typeof selected === "string") {
          const name = selected.replace(/^.*[\\/]/, "");
          form.setFieldsValue({ path: selected, name });
        }
      } catch (e) {
        console.error("File picker error:", e);
      }
    }
  };

  return (
    <Form.Item
      name="path"
      label="文件"
      rules={[{ required: true, message: "请选择或输入文件路径" }]}
      tooltip="SVN 工作副本中的单个文件（用于查看内容与 Blame）"
    >
      <Input
        placeholder="选择或输入文件路径"
        suffix={
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={handlePickFile}
          />
        }
      />
    </Form.Item>
  );
}
