import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Select, Space, Typography, Alert } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnGroupConfig } from "@/api/table";

const { Text } = Typography;

interface Props {
  open: boolean;
  columns: string[];
  value: ColumnGroupConfig[];
  onOk: (value: ColumnGroupConfig[]) => void;
  onCancel: () => void;
}

function createGroup(): ColumnGroupConfig {
  return {
    id: `group-${Date.now().toString(36)}`,
    title: "",
    columns: [],
  };
}

function isContiguous(selectedColumns: string[], allColumns: string[]) {
  const indices = selectedColumns
    .map((col) => allColumns.indexOf(col))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);
  if (indices.length !== selectedColumns.length || indices.length < 2) return false;
  return indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);
}

function normalizeGroupColumns(selectedColumns: string[], allColumns: string[]) {
  const set = new Set(selectedColumns.filter((col) => allColumns.includes(col)));
  return allColumns.filter((col) => set.has(col));
}

function validateGroups(groups: ColumnGroupConfig[], allColumns: string[]) {
  const errors: string[] = [];
  const used = new Map<string, string>();
  const ids = new Set<string>();

  groups.forEach((group, index) => {
    const label = group.title.trim() || `第 ${index + 1} 组`;
    if (!group.id.trim()) errors.push(`${label} 缺少 ID`);
    if (group.id.trim() && ids.has(group.id.trim())) errors.push(`${label} 的 ID 重复`);
    ids.add(group.id.trim());

    if (!group.title.trim()) errors.push(`第 ${index + 1} 组名称不能为空`);
    if (group.columns.length < 2) errors.push(`${label} 至少需要选择 2 列`);

    const uniqueColumns = new Set(group.columns);
    if (uniqueColumns.size !== group.columns.length) errors.push(`${label} 存在重复列`);

    group.columns.forEach((col) => {
      if (!allColumns.includes(col)) {
        errors.push(`${label} 包含不存在的列：${col}`);
        return;
      }
      const usedBy = used.get(col);
      if (usedBy) {
        errors.push(`列 ${col} 已属于 ${usedBy}，不能重复分组`);
      } else {
        used.set(col, label);
      }
    });

    if (group.columns.length >= 2 && !isContiguous(group.columns, allColumns)) {
      errors.push(`${label} 的列必须在当前表格中连续`);
    }
  });

  return errors;
}

export default function ColumnGroupsEditor({ open, columns, value, onOk, onCancel }: Props) {
  const [draft, setDraft] = useState<ColumnGroupConfig[]>([]);

  useEffect(() => {
    if (open) {
      setDraft(value.map((group) => ({
        ...group,
        columns: normalizeGroupColumns(group.columns, columns),
      })));
    }
  }, [open, value, columns]);

  const errors = useMemo(() => validateGroups(draft, columns), [draft, columns]);

  const options = useMemo(
    () => columns.map((col) => ({ value: col, label: col })),
    [columns],
  );

  const updateGroup = (index: number, patch: Partial<ColumnGroupConfig>) => {
    setDraft((prev) => prev.map((group, i) => (
      i === index ? { ...group, ...patch } : group
    )));
  };

  const addGroup = () => {
    setDraft((prev) => [...prev, createGroup()]);
  };

  const removeGroup = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOk = () => {
    if (errors.length > 0) return;
    onOk(draft.map((group) => ({
      id: group.id.trim(),
      title: group.title.trim(),
      columns: normalizeGroupColumns(group.columns, columns),
    })));
  };

  return (
    <Modal
      title="表头分组"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="确定"
      cancelText="取消"
      width={760}
      okButtonProps={{ disabled: errors.length > 0 }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Alert
          type="info"
          showIcon
          message="表头分组只影响表格视图显示。每个分组需要选择连续的 2 个或更多列。"
        />

        {errors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="请先修正分组配置"
            description={errors.map((error) => <div key={error}>{error}</div>)}
          />
        )}

        <Button icon={<PlusOutlined />} onClick={addGroup}>
          新增分组
        </Button>

        {draft.length === 0 && (
          <Text type="secondary">暂无表头分组，表格将使用默认单层表头。</Text>
        )}

        {draft.map((group, index) => (
          <Card
            key={group.id || index}
            size="small"
            title={`分组 ${index + 1}`}
            extra={(
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => removeGroup(index)}
              />
            )}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              <div>
                <Text>分组名称</Text>
                <Input
                  value={group.title}
                  placeholder="例如：Begin 1"
                  onChange={(e) => updateGroup(index, { title: e.target.value })}
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text>包含列</Text>
                <Select
                  mode="multiple"
                  showSearch
                  value={group.columns}
                  options={options}
                  placeholder="选择连续的列"
                  onChange={(selected) => updateGroup(index, {
                    columns: normalizeGroupColumns(selected, columns),
                  })}
                  style={{ width: "100%", marginTop: 4 }}
                  maxTagCount="responsive"
                />
              </div>
            </Space>
          </Card>
        ))}
      </Space>
    </Modal>
  );
}
