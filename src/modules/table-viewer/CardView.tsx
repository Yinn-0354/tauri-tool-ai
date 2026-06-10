import { useEffect, useState, useMemo } from "react";
import { Card, Select, Row, Col, Typography, message } from "antd";
import type { TableData } from "@/api/table";
import { fetchData } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";

const { Text } = Typography;

export default function CardView() {
  const { currentTable, groupByColumn, setGroupByColumn } = useTableViewerStore();
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTable) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchData(currentTable.id, 1, 5000)
      .then(setData)
      .catch(() => message.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, [currentTable]);

  // 按指定列分组 — useMemo 缓存避免每次渲染重新计算（hooks 必须在 early return 之前）
  const { groupCol, groups } = useMemo(() => {
    if (!data) return { groupCol: "", groups: new Map<string, unknown[][]>() };
    const col = groupByColumn || data.columns[0];
    const idx = data.columns.indexOf(col);
    const map = new Map<string, unknown[][]>();
    data.rows.forEach((row) => {
      const key = String(row[idx] ?? "(空)");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    return { groupCol: col, groups: map };
  }, [data, groupByColumn]);

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading) return <Loading />;
  if (!data) return <Empty />;

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <Text>分组列：</Text>
        <Select
          size="small"
          style={{ width: 160 }}
          value={groupCol}
          onChange={setGroupByColumn}
          options={data.columns.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {[...groups.entries()].map(([key, rows]) => (
        <Card key={key} size="small" title={`${key} (${rows.length} 条)`} style={{ marginBottom: 8 }}>
          {rows.slice(0, 50).map((row, i) => (
            <Row key={i} gutter={8} style={{ fontSize: 13, padding: "2px 0" }}>
              {row.map((cell, j) => (
                <Col key={j} span={Math.max(4, Math.floor(24 / Math.min(row.length, 6)))}>
                  <Text type="secondary">{data.columns[j]}:</Text>{" "}
                  {String(cell ?? "")}
                </Col>
              ))}
            </Row>
          ))}
          {rows.length > 50 && (
            <Text type="secondary">... 仅显示前 50 条，共 {rows.length} 条</Text>
          )}
        </Card>
      ))}
    </div>
  );
}
