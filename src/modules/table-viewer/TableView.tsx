import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Table, Input, Button, Space, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { TableData, ColumnFilter, RemarkData, ColumnGroupConfig } from "@/api/table";
import type { SortOrder, ColumnsType, ColumnType } from "antd/es/table/interface";
import { fetchData } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";
import type { TableComponents } from "@rc-component/table/lib/interface";

type RowRecord = Record<string, unknown>;
type SortState = { col: string; order: "asc" | "desc" } | null;

/** 稳定的表头 wrapper 组件 — 在模块级定义避免每次渲染重新挂载 */
const MemoizedHeaderWrapper = ({
  remarkData,
  dataColumns,
  children,
  onHeaderRef,
  ...restProps
}: {
  remarkData: RemarkData[];
  dataColumns: string[];
  children?: React.ReactNode;
  onHeaderRef?: (el: HTMLTableSectionElement | null) => void;
} & React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead ref={onHeaderRef} {...restProps}>
    {remarkData.map((remark, index) => (
      <tr key={`remark-${remark.row}`} className="ant-table-cell remark-row">
        {dataColumns.map((col, colIndex) => (
          <td
            key={col}
            style={{
              padding: "4px 11px",
              backgroundColor: index % 2 === 0 ? "#fafafa" : "#f6f8fa",
              borderBottom: "1px solid #f0f0f0",
              fontSize: 12,
              color: "#24292e",
              lineHeight: "20px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "center",
            }}
          >
            {colIndex < remark.values.length ? remark.values[colIndex] || "" : ""}
          </td>
        ))}
      </tr>
    ))}
    {children}
  </thead>
);

/** 稳定的列筛选下拉组件 — 自带本地输入状态，打字不再触发整表重渲染 */
function ColumnFilterDropdown({
  col,
  initial,
  applyFilter,
  clearFilter,
}: {
  col: string;
  initial: string;
  applyFilter: (col: string, value: string) => void;
  clearFilter: (col: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ padding: 8 }}>
      <Input
        placeholder={`搜索 ${col}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={() => applyFilter(col, value)}
        style={{ marginBottom: 8, display: "block" }}
      />
      <Space>
        <Button
          type="primary"
          size="small"
          icon={<SearchOutlined />}
          onClick={() => applyFilter(col, value)}
        >
          搜索
        </Button>
        <Button
          size="small"
          onClick={() => {
            setValue("");
            clearFilter(col);
          }}
        >
          重置
        </Button>
      </Space>
    </div>
  );
}

function isContiguous(indices: number[]) {
  if (indices.length === 0) return false;
  const ordered = [...indices].sort((a, b) => a - b);
  return ordered.every((idx, i) => i === 0 || idx === ordered[i - 1] + 1);
}

function normalizeColumnGroups(groups: ColumnGroupConfig[] | undefined, columns: string[]) {
  const colIndex = new Map(columns.map((col, index) => [col, index]));
  const used = new Set<string>();
  return (groups ?? []).flatMap((group) => {
    const title = group.title.trim();
    const id = group.id.trim();
    if (!id || !title) return [];

    const groupColumns = [...new Set(group.columns)]
      .filter((col) => colIndex.has(col) && !used.has(col))
      .sort((a, b) => colIndex.get(a)! - colIndex.get(b)!);

    if (groupColumns.length < 2) return [];
    if (!isContiguous(groupColumns.map((col) => colIndex.get(col)!))) return [];

    groupColumns.forEach((col) => used.add(col));
    return [{ ...group, id, title, columns: groupColumns }];
  });
}

function buildNestedColumns(
  leafColumns: ColumnType<RowRecord>[],
  groups: ColumnGroupConfig[] | undefined,
  columns: string[],
): ColumnsType<RowRecord> {
  const normalizedGroups = normalizeColumnGroups(groups, columns);
  if (normalizedGroups.length === 0) return leafColumns;

  const leafByName = new Map(leafColumns.map((col) => [String(col.key), col]));
  const colIndex = new Map(columns.map((col, index) => [col, index]));
  const groupByStart = new Map<number, ColumnGroupConfig>();
  const consumed = new Set<string>();

  normalizedGroups.forEach((group) => {
    groupByStart.set(colIndex.get(group.columns[0])!, group);
  });

  const result: ColumnsType<RowRecord> = [];
  columns.forEach((col, index) => {
    if (consumed.has(col)) return;
    const group = groupByStart.get(index);
    if (group) {
      const children = group.columns
        .map((groupCol) => leafByName.get(groupCol))
        .filter((child): child is ColumnType<RowRecord> => Boolean(child));
      if (children.length > 0) {
        result.push({
          title: group.title,
          key: `group-${group.id}`,
          children,
        });
        group.columns.forEach((groupCol) => consumed.add(groupCol));
        return;
      }
    }
    const leaf = leafByName.get(col);
    if (leaf) result.push(leaf);
  });

  return result;
}

export default function TableView() {
  const { currentTable } = useTableViewerStore();
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortState>(null);
  // 筛选生效值：列名 → 筛选值（触发请求）
  const [filterMap, setFilterMap] = useState<Record<string, string>>({});
  const [tableHeight, setTableHeight] = useState(400);
  const [headerHeight, setHeaderHeight] = useState(56);
  const observerRef = useRef<ResizeObserver | null>(null);
  const headerObserverRef = useRef<ResizeObserver | null>(null);

  // 请求数据 — 直接从 filterMap 派生 filters，减少中间 re-render 触发
  const loadData = useCallback(() => {
    if (!currentTable) return;
    setLoading(true);
    const filters: ColumnFilter[] = Object.entries(filterMap)
      .filter(([, v]) => v)
      .map(([col, val]) => ({ column: col, op: "contains" as const, value: val }));
    fetchData(
      currentTable.id,
      page,
      pageSize,
      sort?.col,
      sort?.order,
      filters.length > 0 ? filters : undefined,
    )
      .then(setData)
      .catch(() => message.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, [currentTable, page, pageSize, sort, filterMap]);

  useEffect(() => {
    if (!currentTable) {
      setData(null);
      return;
    }
    loadData();
  }, [loadData]);

  // 切换数据源时重置
  useEffect(() => {
    setPage(1);
    setSort(null);
    setFilterMap({});
  }, [currentTable?.id]);

  // 监听容器高度变化
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // 监听表头高度变化（含备注行动态增减）
  const handleHeaderRef = useCallback((el: HTMLTableSectionElement | null) => {
    if (headerObserverRef.current) {
      headerObserverRef.current.disconnect();
      headerObserverRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeaderHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    headerObserverRef.current = observer;
    // 首次挂载立即测量
    setHeaderHeight(el.getBoundingClientRect().height);
  }, []);

  const applyFilter = useCallback((col: string, value: string) => {
    setFilterMap((prev) => {
      if (!value) {
        const next = { ...prev };
        delete next[col];
        return next;
      }
      return { ...prev, [col]: value };
    });
    setPage(1);
  }, []);

  const clearFilter = useCallback((col: string) => {
    setFilterMap((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setPage(1);
  }, []);

  const leafColumns = useMemo<ColumnType<RowRecord>[]>(() => {
    if (!currentTable) return [];
    return currentTable.columns.map((col) => ({
      title: col,
      dataIndex: col,
      key: col,
      width: 160,
      ellipsis: true,
      sorter: true,
      sortOrder: (sort?.col === col ? (sort.order === "asc" ? "ascend" : "descend") : null) as SortOrder,
      // 受控 filteredValue：有值时显示筛选图标，无值时 null
      filteredValue: filterMap[col] != null ? [filterMap[col]] : null,
      // 下拉自带本地输入状态，打字不重建列；initial 用当前生效值做种子
      filterDropdown: () => (
        <ColumnFilterDropdown
          col={col}
          initial={filterMap[col] ?? ""}
          applyFilter={applyFilter}
          clearFilter={clearFilter}
        />
      ),
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
      ),
    }));
  }, [currentTable, sort, filterMap, applyFilter, clearFilter]);

  const columns = useMemo<ColumnsType<RowRecord>>(() => {
    if (!currentTable) return [];
    return buildNestedColumns(leafColumns, currentTable.columnGroups, currentTable.columns);
  }, [currentTable, leafColumns]);

  // 只处理排序，筛选由按钮直接控制
  const handleSortChange = useCallback((_pagination: any, _filters: any, sorter: any) => {
    const activeSorter = Array.isArray(sorter)
      ? sorter.find((item) => item?.field && item?.order)
      : sorter;
    if (activeSorter?.field && activeSorter?.order) {
      setSort({
        col: String(activeSorter.field),
        order: activeSorter.order === "ascend" ? "asc" : "desc",
      });
    } else {
      setSort(null);
    }
  }, []);

  const handlePageChange = useCallback((p: number, ps: number) => {
    setPage(p);
    setPageSize(ps);
  }, []);

  const dataSource = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, i) => {
      const record: Record<string, unknown> = { _key: (page - 1) * pageSize + i };
      data.columns.forEach((col, j) => {
        record[col] = row[j];
      });
      return record;
    });
  }, [data, page, pageSize]);

  // remarkData 在 early return 之前派生，供 useMemo 使用
  const remarkData = data?.remarkData ?? [];

  // 自定义表格组件 — 使用模块级 MemoizedHeaderWrapper 避免每次渲染重新挂载
  // 不依赖 leafColumns（否则筛选/排序改变 leafColumns 引用时会重挂表头 + ResizeObserver 抖动）
  const tableComponents = useMemo<TableComponents<Record<string, unknown>>>(
    () => ({
      header: {
        wrapper: (props: any) => (
          <MemoizedHeaderWrapper
            remarkData={remarkData}
            dataColumns={data?.columns ?? currentTable?.columns ?? []}
            onHeaderRef={handleHeaderRef}
            {...props}
          />
        ),
      },
    }),
    [remarkData, data?.columns, currentTable?.columns, handleHeaderRef],
  );

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading && !data) return <Loading />;
  if (!data) return <Empty />;

  const scrollY = tableHeight > headerHeight ? tableHeight - headerHeight - 16 : 0;
  // 注：每列已设 width:160（配合 ellipsis 提升渲染 + 为将来虚拟滚动铺路）。
  // 虚拟滚动（virtual）暂未开启：此前开启导致 OOM，疑似列分组嵌套列在虚拟模式下宽度异常。
  // 待单独验证后再引入，避免阻塞。

  return (
    <div ref={measureRef} style={{ height: "100%", maxHeight: "calc(100vh - 200px)" }}>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey="_key"
        size="small"
        bordered
        tableLayout="fixed"
        loading={loading}
        scroll={{ x: "max-content", y: scrollY }}
        onChange={handleSortChange}
        components={tableComponents}
        pagination={{
          current: page,
          pageSize,
          total: data.filteredTotal,
          showSizeChanger: true,
          pageSizeOptions: ["50", "100", "200", "500"],
          showTotal: (total) =>
            data.filteredTotal < data.total
              ? `筛选 ${data.filteredTotal} / 共 ${data.total} 行`
              : `共 ${total} 行`,
          onChange: handlePageChange,
        }}
      />
    </div>
  );
}
