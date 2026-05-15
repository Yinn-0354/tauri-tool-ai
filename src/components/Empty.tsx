import { Empty as AntEmpty } from "antd";

interface EmptyProps {
  description?: string;
}

export default function Empty({ description = "暂无数据" }: EmptyProps) {
  return <AntEmpty description={description} />;
}
