import type { ICellEditorParams } from "@ag-grid-community/core";

/**
 * 只读可选取 cellEditor:双击数据单元格时弹出浮层 textarea,展示完整值,
 * 用户可手动 Ctrl+C 复制、横向滚动选取长文本,Esc/Enter/失焦关闭,不写回数据。
 *
 * 设计要点:
 * - isPopup()=true + getPopupPosition()='over':浮层覆盖当前单元格,
 *   长文本 textarea 可自动撑高/滚动,不受 26px 行高截断。
 * - isCancelAfterEnd()=true:退出编辑时 ag-Grid 不取 getValue() 写回 → 「只读不改」。
 * - getValue() 返回 params.value(原值):即便被取用也是原值,保险。
 * - textarea readOnly + wrap=off:浏览器原生 Ctrl+C 复制生效;长行横向滚动便于选取。
 * - afterGuiAttached() focus+select:进入即全选,方便整段 Ctrl+C。
 * - 沿用项目 CSS 变量(var(--font-mono) / var(--text) / var(--bg-elevated) / var(--border-strong)),
 *   与 blameCellRenderer / rowNoCellRenderer 视觉一致。
 *
 * 采用 class 组件(而非 React 函数组件):ag-grid v32 社区版 React 适配器对 class 组件的
 * ICellEditor 方法透传最稳;函数组件需 forwardRef + useImperativeHandle 暴露 isCancelAfterEnd/
 * getValue/isPopup,易因适配器差异导致退出时仍写回值。class 写法与 ag-grid 契合最深。
 */
export default class ReadonlySelectCellEditor {
  private params: ICellEditorParams;
  private eInput: HTMLTextAreaElement;

  constructor(params: ICellEditorParams) {
    this.params = params;
    this.eInput = document.createElement("textarea");
    this.eInput.value =
      params.value === null || params.value === undefined
        ? ""
        : String(params.value);
    this.eInput.readOnly = true;
    this.eInput.wrap = "off";
    this.eInput.spellcheck = false;
    Object.assign(this.eInput.style, {
      width: "100%",
      minHeight: "28px",
      maxHeight: "320px",
      padding: "2px 6px",
      resize: "vertical",
      fontFamily: "var(--font-mono)",
      fontSize: "13px",
      color: "var(--text)",
      background: "var(--bg-elevated)",
      border: "1px solid var(--border-strong)",
      borderRadius: "4px",
      outline: "none",
      overflow: "auto",
      whiteSpace: "pre",
      cursor: "text",
    } as CSSStyleDeclaration);

    // Escape/Enter 退出编辑;Ctrl/Cmd+C 走浏览器原生,不拦截。
    this.eInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.params.stopEditing();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.params.stopEditing();
      }
    });
    // 失焦退出(stopEditingWhenCellsLoseFocus=true 时点别处会触发)。
    this.eInput.addEventListener("blur", () => {
      this.params.stopEditing();
    });
    // 点击 textarea 内全选,方便整段复制。
    this.eInput.addEventListener("click", (e: MouseEvent) => {
      (e.target as HTMLTextAreaElement).select();
    });
  }

  // ag-Grid 调用获取 DOM
  getGui(): HTMLElement {
    return this.eInput;
  }

  // 挂载后聚焦并全选
  afterGuiAttached(): void {
    this.eInput.focus();
    this.eInput.select();
  }

  // 原值返回(不取 input 内容,保险)
  getValue(): unknown {
    return this.params.value;
  }

  // 弹出浮层覆盖单元格
  isPopup?(): boolean {
    return true;
  }

  getPopupPosition?(): "over" {
    return "over";
  }

  // 关键:退出编辑不写回数据 → 「只读不改」
  isCancelAfterEnd?(): boolean {
    return true;
  }

  // 刷新时保持原值(无副作用)
  refresh(_params: ICellEditorParams): boolean {
    return true;
  }

  destroy(): void {
    // textarea 随 getGui 返回的 DOM 由 ag-Grid 移除,无需手动清理。
  }
}
