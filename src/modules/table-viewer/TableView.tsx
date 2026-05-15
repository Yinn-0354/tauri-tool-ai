import { useEffect, useState } from "react";
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

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const columns = data.columns.map((col) => ({
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

  const dataSource = data.rows.map((row, i) => {
    const record: Record<string, unknown> = { _key: i };
    data.columns.forEach((col, j) => {
      record[col] = row[j];
    });
    return record;
  });

  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      rowKey="_key"
      size="small"
      scroll={{ x: "max-content" }}
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
  );
}
