import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Table, message } from "antd";
import type { TableData } from "@/api/table";
import { fetchData } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";

export default function TableView() {
  const { currentTable } = useTableViewerStore();
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [tableHeight, setTableHeight] = useState(400);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!currentTable) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchData(currentTable.id, page, pageSize)
      .then(setData)
      .catch(() => message.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, [currentTable, page, pageSize]);

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

  const columns = useMemo(() => {
    if (!data) return [];
    return data.columns.map((col) => ({
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
      sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const va = a[col] ?? "";
        const vb = b[col] ?? "";
        return String(va).localeCompare(String(vb));
      },
    }));
  }, [data]);

  const dataSource = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row, i) => {
      const record: Record<string, unknown> = { _key: i };
      data.columns.forEach((col, j) => {
        record[col] = row[j];
      });
      return record;
    });
  }, [data]);

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const scrollY = tableHeight > 56 ? tableHeight - 56 : 0;

  return (
    <div ref={measureRef} style={{ height: "100%", maxHeight: "calc(100vh - 200px)" }}>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey="_key"
        size="small"
        bordered
        tableLayout="fixed"
        scroll={{ x: "max-content", y: scrollY }}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: ["50", "100", "200", "500"],
          showTotal: (total) => `共 ${total} 行`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
