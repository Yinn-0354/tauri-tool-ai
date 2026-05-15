import { Spin } from "antd";
import type { SpinProps } from "antd";

export default function Loading(props: SpinProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        minHeight: 200,
      }}
    >
      <Spin tip="加载中..." {...props} />
    </div>
  );
}
