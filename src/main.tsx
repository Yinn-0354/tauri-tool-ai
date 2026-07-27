import React from "react";
import ReactDOM from "react-dom/client";
// 主题 store 尽早 import:模块顶层副作用会把初始主题( localStorage 或系统 prefers-color-scheme )
// 应用到 <html data-theme>,使首帧 CSS 变量即正确,避免闪烁(FOUC)。须在 App 之前。
import "./store/themeStore";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
