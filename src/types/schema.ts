/**
 * 页面 Schema 类型定义
 *
 * 用于描述表格查看器的结构化页面布局，
 * AI 生成 JSON Schema → 前端 SchemaRenderer 渲染。
 */

import type { CSSProperties } from "react";

// ─── 布局 ───────────────────────────────────────────────────────

export type LayoutMode = "vertical" | "horizontal" | "grid";

// ─── 数据引用 ───────────────────────────────────────────────────

/** 数据引用：指向当前表格数据或指定数据源 */
export type DataRef = "current" | string;

// ─── 文本节点 ───────────────────────────────────────────────────

export interface TextNode {
  type: "text";
  /** 文本内容，支持 {列名} 占位符 */
  content: string;
  /** 标题级别，0 表示普通段落 */
  level?: 1 | 2 | 3 | 4 | 5;
  /** 文本样式 */
  style?: "default" | "secondary" | "success" | "warning" | "danger";
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 统计卡片 ───────────────────────────────────────────────────

export interface StatNode {
  type: "stat";
  /** 标签文本 */
  label: string;
  /** 值表达式，支持 {列名} 占位符和聚合函数如 count()、sum(列名) */
  value: string;
  /** 前缀 */
  prefix?: string;
  /** 后缀 */
  suffix?: string;
  /** 精度（小数位数） */
  precision?: number;
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 表格节点 ───────────────────────────────────────────────────

export interface TableColumnDef {
  /** 列名（对应数据源列名） */
  key: string;
  /** 显示标题，默认使用 key */
  title?: string;
  /** 列宽 */
  width?: number;
  /** 是否可排序 */
  sortable?: boolean;
  /** 对齐方式 */
  align?: "left" | "center" | "right";
}

export interface TableNode {
  type: "table";
  /** 列定义，为空时使用数据源全部列 */
  columns?: TableColumnDef[];
  /** 数据引用 */
  dataRef?: DataRef;
  /** 每页行数 */
  pageSize?: number;
  /** 是否显示序号列 */
  showIndex?: boolean;
  /** 是否显示边框 */
  bordered?: boolean;
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 卡片节点 ───────────────────────────────────────────────────

export interface CardNode {
  type: "card";
  /** 卡片标题，支持 {列名} 占位符 */
  title?: string;
  /** 子节点 */
  children: ComponentNode[];
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 描述列表节点 ───────────────────────────────────────────────

export interface DescriptionsNode {
  type: "descriptions";
  /** 标题 */
  title?: string;
  /** 列定义：key 为列名，label 为显示标题 */
  fields: Array<{ key: string; label: string }>;
  /** 数据引用 */
  dataRef?: DataRef;
  /** 列数（Ant Design Descriptions 的 column） */
  column?: number;
  /** 是否显示边框 */
  bordered?: boolean;
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 分隔线 ─────────────────────────────────────────────────────

export interface DividerNode {
  type: "divider";
  /** 分隔线文本 */
  text?: string;
}

// ─── 循环节点 ───────────────────────────────────────────────────

export interface LoopNode {
  type: "loop";
  /** 数据引用 */
  dataRef: DataRef;
  /** 循环体模板 */
  template: ComponentNode[];
  /** 最大循环次数 */
  maxItems?: number;
}

// ─── 标签页节点 ─────────────────────────────────────────────────

export interface TabsNode {
  type: "tabs";
  /** 标签页列表 */
  items: Array<{
    key: string;
    label: string;
    children: ComponentNode[];
  }>;
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 图表节点（预留） ───────────────────────────────────────────

export interface ChartNode {
  type: "chart";
  /** 图表类型 */
  chartType: "bar" | "line" | "pie";
  /** 数据引用 */
  dataRef?: DataRef;
  /** 图表配置 */
  config: {
    /** X 轴字段 */
    xField?: string;
    /** Y 轴字段 */
    yField?: string;
    /** 分组字段 */
    seriesField?: string;
  };
  /** CSS 样式覆盖 */
  css?: CSSProperties;
}

// ─── 组件节点联合类型 ──────────────────────────────────────────

export type ComponentNode =
  | TextNode
  | StatNode
  | TableNode
  | CardNode
  | DescriptionsNode
  | DividerNode
  | LoopNode
  | TabsNode
  | ChartNode;

// ─── 页面 Schema ────────────────────────────────────────────────

export interface PageSchema {
  /** Schema 版本 */
  version: 1;
  /** 布局模式 */
  layout: LayoutMode;
  /** 网格布局列数（仅 layout=grid 时生效） */
  gridColumns?: number;
  /** 子节点 */
  children: ComponentNode[];
}

// ─── 模板元信息 ─────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  description?: string;
  schema: PageSchema;
  createdAt: string;
  updatedAt: string;
}
