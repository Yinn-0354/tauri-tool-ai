/**
 * PageView — 页面视图
 *
 * 基于 PageSchema 渲染结构化页面，支持：
 * - 从已保存模板加载 Schema
 * - 手动编辑 JSON Schema
 * - 实时预览渲染结果
 */

import { useEffect, useState, useCallback } from "react";
import {
  Button,
  Input,
  message,
  Space,
  Typography,
  Select,
  Modal,
  Tooltip,
  Divider,
} from "antd";
import {
  SaveOutlined,
  CodeOutlined,
  EyeOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { TableData } from "@/api/table";
import { fetchData } from "@/api/table";
import {
  fetchTemplates,
  saveTemplate,
  deleteTemplate,
} from "@/api/template";
import type { PageSchema, Template } from "@/types/schema";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import SchemaRenderer from "@/components/SchemaRenderer";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";

const { TextArea } = Input;
const { Text } = Typography;

// ─── 默认 Schema 示例 ──────────────────────────────────────────

const DEFAULT_SCHEMA: PageSchema = {
  version: 1,
  layout: "vertical",
  children: [
    {
      type: "stat",
      label: "总行数",
      value: "count()",
    },
    { type: "divider" },
    {
      type: "table",
      pageSize: 20,
      showIndex: true,
    },
  ],
};

// ─── 组件 ───────────────────────────────────────────────────────

export default function PageView() {
  const { currentTable } = useTableViewerStore();

  // 数据状态
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);

  // Schema 状态
  const [schemaText, setSchemaText] = useState(JSON.stringify(DEFAULT_SCHEMA, null, 2));
  const [parsedSchema, setParsedSchema] = useState<PageSchema | null>(DEFAULT_SCHEMA);
  const [parseError, setParseError] = useState<string | null>(null);

  // 模板状态
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");

  // ── 加载数据 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!currentTable) {
      setData(null);
      return;
    }
    setLoading(true);
    // 页面视图一次性加载最多 5000 行（与 CardView 一致）
    fetchData(currentTable.id, 1, 5000)
      .then(setData)
      .catch(() => message.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, [currentTable]);

  // ── 加载模板列表 ──────────────────────────────────────────────

  useEffect(() => {
    fetchTemplates()
      .then(setTemplates)
      .catch(() => { /* 忽略，首次可能无模板 */ });
  }, []);

  // ── Schema 解析 ───────────────────────────────────────────────

  const handleSchemaTextChange = useCallback((text: string) => {
    setSchemaText(text);
    try {
      const parsed = JSON.parse(text) as PageSchema;
      if (!parsed.version || !parsed.layout || !Array.isArray(parsed.children)) {
        setParseError("Schema 结构不完整，需要 version、layout、children");
        setParsedSchema(null);
        return;
      }
      setParsedSchema(parsed);
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
      setParsedSchema(null);
    }
  }, []);

  // ── 模板操作 ──────────────────────────────────────────────────

  const handleLoadTemplate = useCallback((templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSelectedTemplateId(templateId);
    setSchemaText(JSON.stringify(tpl.schema, null, 2));
    setParsedSchema(tpl.schema);
    setParseError(null);
    setEditMode(false);
  }, [templates]);

  const handleSaveTemplate = useCallback(async () => {
    if (!parsedSchema) {
      message.error("Schema 格式错误，无法保存");
      return;
    }
    if (!saveName.trim()) {
      message.error("请输入模板名称");
      return;
    }
    try {
      const saved = await saveTemplate({
        name: saveName.trim(),
        description: saveDesc.trim() || undefined,
        schema: parsedSchema,
      });
      setTemplates((prev) => {
        const idx = prev.findIndex((t) => t.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      setSelectedTemplateId(saved.id);
      setSaveModalOpen(false);
      setSaveName("");
      setSaveDesc("");
      message.success("模板已保存");
    } catch {
      message.error("保存模板失败");
    }
  }, [parsedSchema, saveName, saveDesc]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!selectedTemplateId) return;
    try {
      await deleteTemplate(selectedTemplateId);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplateId));
      setSelectedTemplateId(null);
      message.success("模板已删除");
    } catch {
      message.error("删除模板失败");
    }
  }, [selectedTemplateId]);

  // ── 空状态 ────────────────────────────────────────────────────

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading) return <Loading />;

  // ── 渲染 ──────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 工具栏 */}
      <div style={{ flexShrink: 0, marginBottom: 12 }}>
        <Space wrap>
          <Select
            placeholder="选择已保存模板"
            style={{ width: 200 }}
            value={selectedTemplateId}
            onChange={handleLoadTemplate}
            allowClear
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Tooltip title="编辑 Schema">
            <Button
              icon={editMode ? <EyeOutlined /> : <CodeOutlined />}
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? "预览" : "编辑"}
            </Button>
          </Tooltip>
          <Tooltip title="保存为模板">
            <Button
              icon={<SaveOutlined />}
              onClick={() => setSaveModalOpen(true)}
              disabled={!parsedSchema}
            >
              保存
            </Button>
          </Tooltip>
          {selectedTemplateId && (
            <Tooltip title="删除当前模板">
              <Button
                icon={<DeleteOutlined />}
                danger
                onClick={handleDeleteTemplate}
              />
            </Tooltip>
          )}
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setSchemaText(JSON.stringify(DEFAULT_SCHEMA, null, 2));
              setParsedSchema(DEFAULT_SCHEMA);
              setParseError(null);
              setSelectedTemplateId(null);
              setEditMode(true);
            }}
          >
            新建
          </Button>
        </Space>
      </div>

      <Divider style={{ margin: "0 0 12px", flexShrink: 0 }} />

      {/* 内容区域 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {editMode ? (
          /* JSON 编辑模式 */
          <div>
            <TextArea
              value={schemaText}
              onChange={(e) => handleSchemaTextChange(e.target.value)}
              rows={20}
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1.5,
              }}
              status={parseError ? "error" : undefined}
            />
            {parseError && (
              <Text type="danger" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                JSON 解析错误：{parseError}
              </Text>
            )}
          </div>
        ) : (
          /* 预览模式 */
          <div>
            {parsedSchema ? (
              <SchemaRenderer
                schema={parsedSchema}
                data={data ? { columns: data.columns, rows: data.rows } : undefined}
              />
            ) : (
              <Empty description={parseError ?? "Schema 格式错误"} />
            )}
          </div>
        )}
      </div>

      {/* 保存模板弹窗 */}
      <Modal
        title="保存模板"
        open={saveModalOpen}
        onOk={handleSaveTemplate}
        onCancel={() => setSaveModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text>模板名称</Text>
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="输入模板名称"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text>描述（可选）</Text>
            <Input
              value={saveDesc}
              onChange={(e) => setSaveDesc(e.target.value)}
              placeholder="输入模板描述"
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
