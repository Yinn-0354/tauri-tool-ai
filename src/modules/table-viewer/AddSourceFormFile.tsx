import { Form, Input, InputNumber, Button, Select } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";

export default function AddSourceFormFile() {
  const form = Form.useFormInstance();

  const handlePickFile = async () => {
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          title: "选择数据文件",
          filters: [
            {
              name: "表格文件",
              extensions: ["xlsx", "xls", "xlsm", "csv", "tab", "tsv", "txt"],
            },
          ],
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
    <>
      <Form.Item
        name="path"
        label="文件"
        rules={[{ required: true, message: "请选择文件" }]}
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
      <Form.Item name="headerRow" label="表头行" tooltip="表头所在行号，从 1 开始">
        <InputNumber min={1} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="skipRows" label="跳过行" tooltip="需要跳过的行号，可多选，从 1 开始">
        <Select
          mode="tags"
          tokenSeparators={[","]}
          placeholder="输入行号后回车，如: 1,2"
          style={{ width: "100%" }}
        />
      </Form.Item>
    </>
  );
}
