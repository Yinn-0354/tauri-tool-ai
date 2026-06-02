import { Spin } from "antd";
import type { SpinProps } from "antd";

const wrapperStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  height: "100%",
  minHeight: 200,
};

export default function Loading(props: SpinProps) {
  return (
    <div style={wrapperStyle}>
      <Spin description="加载中..." {...props} />
    </div>
  );
}
