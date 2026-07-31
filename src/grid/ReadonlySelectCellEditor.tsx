import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import type { ICellEditorParams } from "@ag-grid-community/core";

/**
 * 只读可选取 cellEditor:双击数据单元格时弹出浮层 textarea,展示完整值,
 * 用户可手动 Ctrl+C 复制、横向滚动选取长文本,Esc/Enter/失焦关闭,不写回数据。
 *
 * ag-grid React 适配器:cellEditor 用 React 函数组件,props 即 ICellEditorParams(含 value/stopEditing)。
 * 通过 forwardRef + useImperativeHandle 暴露 getValue(返回原值 → 不改数据)/isPopup/getPopupPosition/
 * isCancelAfterEnd。textarea readOnly + wrap=off,浏览器原生 Ctrl+C 复制;进入即全选。
 *
 * 沿用项目 CSS 变量,与 blameCellRenderer/rowNoCellRenderer 视觉一致。
 */
export interface EditorHandle {
  getValue: () => unknown;
  isPopup: () => boolean;
  getPopupPosition: () => "over";
  isCancelAfterEnd: () => boolean;
}

const ReadonlySelectCellEditor = forwardRef<EditorHandle, ICellEditorParams>(
  function ReadonlySelectCellEditor(props, ref) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const value =
      props.value === null || props.value === undefined ? "" : String(props.value);

    // 进入即聚焦全选,方便整段 Ctrl+C
    useEffect(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, []);

    // 暴露 ag-grid 需要的方法:getValue 返回原值(不改数据),isCancelAfterEnd=true 退出不写回
    useImperativeHandle(ref, () => ({
      getValue: () => props.value,
      isPopup: () => true,
      getPopupPosition: () => "over",
      isCancelAfterEnd: () => true,
    }));

    const stop = () => props.stopEditing();

    return (
      <textarea
        ref={taRef}
        defaultValue={value}
        readOnly
        spellCheck={false}
        wrap="soft"
        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        onKeyDown={(e) => {
          // Escape/Enter 退出;Ctrl/Cmd+C 走浏览器原生,不拦截
          if (e.key === "Escape") {
            e.preventDefault();
            stop();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            stop();
          }
        }}
        onBlur={stop}
        style={{
          // 宽度:不跟随单元格(单元格可能很窄),给较大最小宽 + 不超视口
          minWidth: 320,
          maxWidth: "60vw",
          // 高度:最小一行,最大 320px;超出则纵向滚动
          minHeight: 28,
          maxHeight: 320,
          padding: "4px 8px",
          resize: "vertical",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.4,
          color: "var(--text)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 4,
          outline: "none",
          // 文本自动换行(不横向滚动);纵向超 maxHeight 才滚动
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          overflowX: "hidden",
          overflowY: "auto",
          cursor: "text",
        }}
      />
    );
  }
);

export default ReadonlySelectCellEditor;
