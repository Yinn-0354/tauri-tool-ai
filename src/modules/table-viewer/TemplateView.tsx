import { useEffect, useState } from "react";
import { Input, message, Typography } from "antd";
import type { TableData } from "@/api/table";
import { fetchData } from "@/api/table";
import { useTableViewerStore } from "@/stores/tableViewerStore";
import Empty from "@/components/Empty";
import Loading from "@/components/Loading";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

function renderTemplate(
  row: unknown[],
  columns: string[],
  templateString: string,
): string {
  if (!templateString) return JSON.stringify(row);
  return templateString.replace(/\{(\w+)\}|\{\*\}/g, (match, col) => {
    if (match === "{*}") return row.map((c) => String(c ?? "")).join(" | ");
    const idx = columns.indexOf(col);
    return idx >= 0 ? String(row[idx] ?? "") : match;
  });
}

export default function TemplateView() {
  const { currentTable, templateString, setTemplateString } = useTableViewerStore();
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTable) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchData(currentTable.id, 1, 500)
      .then(setData)
      .catch(() => message.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, [currentTable]);

  if (!currentTable) return <Empty description="请先选择数据源并加载" />;
  if (loading) return <Loading />;
  if (!data) return <Empty />;

  return (
    <div>
      <Text>模板（{`{列名}`}或{`{*}`}占位符）：</Text>
      <TextArea
        rows={1}
        value={templateString}
        onChange={(e) => setTemplateString(e.target.value)}
        style={{ margin: "8px 0 16px" }}
        placeholder="例如: {Name} 的等级是 {Level}"
      />
      <div style={{ maxHeight: "calc(100vh - 300px)", overflow: "auto" }}>
        {data.rows.map((row, i) => (
          <Paragraph key={i} style={{ marginBottom: 4, padding: "4px 8px", background: i % 2 === 0 ? "#fafafa" : "#fff" }}>
            {renderTemplate(row, data.columns, templateString)}
          </Paragraph>
        ))}
      </div>
    </div>
  );
}
