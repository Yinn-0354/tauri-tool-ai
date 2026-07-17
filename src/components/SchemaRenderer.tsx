/**
 * SchemaRenderer — 页面 Schema 渲染引擎
 *
 * 递归解析 PageSchema，将每个 ComponentNode 映射到 Ant Design 组件。
 * 支持 {列名} 占位符替换、聚合函数（count/sum/avg/min/max）。
 */

import { useMemo } from "react";
import {
  Typography,
  Card,
  Statistic,
  Table,
  Descriptions,
  Divider,
  Tabs,
} from "antd";
import type { TableProps } from "antd";
import type {
  PageSchema,
  ComponentNode,
  TextNode,
  StatNode,
  TableNode,
  CardNode,
  DescriptionsNode,
  DividerNode,
  LoopNode,
  TabsNode,
  ChartNode,
  TableColumnDef,
} from "@/types/schema";

const { Title, Paragraph } = Typography;

// ─── 类型守卫 ───────────────────────────────────────────────────

function isTextNode(n: ComponentNode): n is TextNode { return n.type === "text"; }
function isStatNode(n: ComponentNode): n is StatNode { return n.type === "stat"; }
function isTableNode(n: ComponentNode): n is TableNode { return n.type === "table"; }
function isCardNode(n: ComponentNode): n is CardNode { return n.type === "card"; }
function isDescriptionsNode(n: ComponentNode): n is DescriptionsNode { return n.type === "descriptions"; }
function isDividerNode(n: ComponentNode): n is DividerNode { return n.type === "divider"; }
function isLoopNode(n: ComponentNode): n is LoopNode { return n.type === "loop"; }
function isTabsNode(n: ComponentNode): n is TabsNode { return n.type === "tabs"; }
function isChartNode(n: ComponentNode): n is ChartNode { return n.type === "chart"; }

// ─── 占位符解析 ─────────────────────────────────────────────────

/**
 * 将 {列名} 替换为对应列值
 * @param template 模板字符串
 * @param row 当前行数据
 * @param columns 列名列表
 */
function resolvePlaceholder(
  template: string,
  row: unknown[],
  columns: string[],
): string {
  return template.replace(/\{(\w+)\}/g, (match, col) => {
    if (col === "*") return row.map((c) => String(c ?? "")).join(" | ");
    const idx = columns.indexOf(col);
    return idx >= 0 ? String(row[idx] ?? "") : match;
  });
}

/**
 * 解析聚合表达式，如 count()、sum(列名)、avg(列名)
 */
function resolveAggregation(
  expr: string,
  rows: unknown[][],
  columns: string[],
): number | string {
  // count()
  if (expr === "count()") return rows.length;

  const match = expr.match(/^(sum|avg|min|max)\((\w+)\)$/);
  if (!match) return expr;

  const [, fn, col] = match;
  const idx = columns.indexOf(col);
  if (idx < 0) return NaN;

  const values = rows
    .map((r) => Number(r[idx]))
    .filter((v) => !isNaN(v));

  if (values.length === 0) return NaN;

  switch (fn) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: return NaN;
  }
}

// ─── 样式文本 ───────────────────────────────────────────────────

const STYLE_MAP = {
  default: {},
  secondary: { type: "secondary" as const },
  success: { type: "success" as const },
  warning: { type: "warning" as const },
  danger: { type: "danger" as const },
};

// ─── 渲染器 Props ───────────────────────────────────────────────

interface SchemaRendererProps {
  schema: PageSchema;
  /** 当前表格数据：{ columns, rows } */
  data?: { columns: string[]; rows: unknown[][] };
}

// ─── 单节点渲染 ─────────────────────────────────────────────────

interface NodeRendererProps {
  node: ComponentNode;
  data?: { columns: string[]; rows: unknown[][] };
}

function NodeRenderer({ node, data }: NodeRendererProps) {
  if (isTextNode(node)) return <TextBlock node={node} data={data} />;
  if (isStatNode(node)) return <StatBlock node={node} data={data} />;
  if (isTableNode(node)) return <TableBlock node={node} data={data} />;
  if (isCardNode(node)) return <CardBlock node={node} data={data} />;
  if (isDescriptionsNode(node)) return <DescriptionsBlock node={node} data={data} />;
  if (isDividerNode(node)) return <DividerBlock node={node} />;
  if (isLoopNode(node)) return <LoopBlock node={node} data={data} />;
  if (isTabsNode(node)) return <TabsBlock node={node} data={data} />;
  if (isChartNode(node)) return <ChartBlock node={node} data={data} />;
  return null;
}

// ─── Text ───────────────────────────────────────────────────────

function TextBlock({ node, data }: { node: TextNode; data?: { columns: string[]; rows: unknown[][] } }) {
  const content = data?.rows.length
    ? resolvePlaceholder(node.content, data.rows[0], data.columns)
    : node.content;

  const styleProps = STYLE_MAP[node.style ?? "default"];

  if (node.level) {
    return <Title level={node.level} style={node.css} {...styleProps}>{content}</Title>;
  }
  return <Paragraph style={node.css} {...styleProps}>{content}</Paragraph>;
}

// ─── Stat ───────────────────────────────────────────────────────

function StatBlock({ node, data }: { node: StatNode; data?: { columns: string[]; rows: unknown[][] } }) {
  let value: string | number = node.value;

  if (data?.rows.length) {
    // 检查是否是聚合表达式
    const aggResult = resolveAggregation(node.value, data.rows, data.columns);
    if (typeof aggResult === "number" && !isNaN(aggResult)) {
      value = node.precision !== undefined
        ? Number(aggResult.toFixed(node.precision))
        : aggResult;
    } else if (typeof aggResult === "string") {
      // 普通占位符
      value = resolvePlaceholder(node.value, data.rows[0], data.columns);
    }
  }

  return (
    <Statistic
      title={node.label}
      value={value}
      prefix={node.prefix}
      suffix={node.suffix}
      precision={node.precision}
      style={node.css}
    />
  );
}

// ─── Table ──────────────────────────────────────────────────────

function TableBlock({ node, data }: { node: TableNode; data?: { columns: string[]; rows: unknown[][] } }) {
  const columns = useMemo(() => {
    if (!data) return [];
    const defs = node.columns ?? data.columns.map((c) => ({ key: c }));
    return defs.map((def: TableColumnDef) => ({
      title: def.title ?? def.key,
      dataIndex: def.key,
      key: def.key,
      width: def.width,
      sorter: def.sortable,
      align: def.align,
    }));
  }, [node.columns, data]);

  const dataSource = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, i) => {
      const record: Record<string, unknown> = { _rowIndex: i };
      data.columns.forEach((col, idx) => {
        record[col] = row[idx];
      });
      return record;
    });
  }, [data]);

  const antColumns: TableProps<Record<string, unknown>>["columns"] = node.showIndex
    ? [
        { title: "#", dataIndex: "_rowIndex", key: "_rowIndex", width: 60, align: "center" },
        ...columns,
      ]
    : columns;

  return (
    <Table<Record<string, unknown>>
      columns={antColumns}
      dataSource={dataSource}
      rowKey="_rowIndex"
      size="small"
      bordered={node.bordered ?? false}
      pagination={{
        pageSize: node.pageSize ?? 20,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 行`,
      }}
      style={node.css}
      scroll={{ x: "max-content" }}
    />
  );
}

// ─── Card ───────────────────────────────────────────────────────

function CardBlock({ node, data }: { node: CardNode; data?: { columns: string[]; rows: unknown[][] } }) {
  const title = node.title && data?.rows.length
    ? resolvePlaceholder(node.title, data.rows[0], data.columns)
    : node.title;

  return (
    <Card
      title={title}
      size="small"
      style={node.css}
    >
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} data={data} />
      ))}
    </Card>
  );
}

// ─── Descriptions ───────────────────────────────────────────────

function DescriptionsBlock({ node, data }: { node: DescriptionsNode; data?: { columns: string[]; rows: unknown[][] } }) {
  const items = useMemo(() => {
    if (!data?.rows.length) return [];
    const row = data.rows[0];
    return node.fields.map((f) => ({
      key: f.key,
      label: f.label,
      children: String(row[data.columns.indexOf(f.key)] ?? ""),
    }));
  }, [node.fields, data]);

  return (
    <Descriptions
      title={node.title}
      column={node.column ?? 3}
      bordered={node.bordered ?? false}
      size="small"
      items={items}
      style={node.css}
    />
  );
}

// ─── Divider ────────────────────────────────────────────────────

function DividerBlock({ node }: { node: DividerNode }) {
  return <Divider>{node.text}</Divider>;
}

// ─── Loop ───────────────────────────────────────────────────────

function LoopBlock({ node, data }: { node: LoopNode; data?: { columns: string[]; rows: unknown[][] } }) {
  if (!data) return null;

  const rows = node.maxItems ? data.rows.slice(0, node.maxItems) : data.rows;

  return (
    <>
      {rows.map((row, i) => {
        const rowData = { columns: data.columns, rows: [row] };
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            {node.template.map((child, j) => (
              <NodeRenderer key={`${i}-${j}`} node={child} data={rowData} />
            ))}
          </div>
        );
      })}
    </>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────

function TabsBlock({ node, data }: { node: TabsNode; data?: { columns: string[]; rows: unknown[][] } }) {
  const items = node.items.map((item) => ({
    key: item.key,
    label: item.label,
    children: (
      <div>
        {item.children.map((child, i) => (
          <NodeRenderer key={i} node={child} data={data} />
        ))}
      </div>
    ),
  }));

  return <Tabs items={items} style={node.css} />;
}

// ─── Chart（占位） ──────────────────────────────────────────────

function ChartBlock({ node, data }: { node: ChartNode; data?: { columns: string[]; rows: unknown[][] } }) {
  // TODO: 后续接入图表库（如 @ant-design/charts 或 echarts）
  return (
    <Card size="small" style={node.css}>
      <Paragraph type="secondary">
        图表组件（{node.chartType}）— 后续版本支持
        {data && ` · 数据 ${data.rows.length} 行`}
      </Paragraph>
    </Card>
  );
}

// ─── 主渲染器 ───────────────────────────────────────────────────

export default function SchemaRenderer({ schema, data }: SchemaRendererProps) {
  const layoutStyle: React.CSSProperties = useMemo(() => {
    switch (schema.layout) {
      case "horizontal":
        return { display: "flex", flexWrap: "wrap", gap: 16 };
      case "grid":
        return {
          display: "grid",
          gridTemplateColumns: `repeat(${schema.gridColumns ?? 2}, 1fr)`,
          gap: 16,
        };
      default:
        return {};
    }
  }, [schema.layout, schema.gridColumns]);

  return (
    <div style={layoutStyle}>
      {schema.children.map((node, i) => {
        if (schema.layout === "horizontal") {
          return (
            <div key={i} style={{ flex: "1 1 300px", minWidth: 0 }}>
              <NodeRenderer node={node} data={data} />
            </div>
          );
        }
        return <NodeRenderer key={i} node={node} data={data} />;
      })}
    </div>
  );
}
