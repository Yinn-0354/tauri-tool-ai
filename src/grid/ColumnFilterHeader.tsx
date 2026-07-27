import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IHeaderParams } from "@ag-grid-community/core";
import { Dropdown, Input, Spin } from "antd";
import { FilterOutlined } from "@ant-design/icons";

/**
 * ag-Grid 自绘表头:列名 + 漏斗图标(点击弹该列筛选下拉)。
 *
 * 社区版无 Set Filter(企业版 agSetColumnFilter),这里自行实现"多选值筛选"。
 * 点漏斗 → antd Dropdown(dropdownRender)弹一个面板:搜索框 + 带重复数目的 checkbox 列表 +
 * 全选/反选 + 重置/确认。确认 → onApply(选中值);重置 → onClear。
 *
 * headerComponentParams(由 TableView 注入,见 columnDefs):
 * - colName: 列名
 * - selected: 当前已选值(filters[colName],用于决定漏斗"已筛"态与初始勾选)
 * - backendUrl / tableId / headerRow / skipRows: 拉去重值用
 * - otherFilters: 其他列已筛选(开本列下拉时传后端,做"按其他列已筛选项去重")
 * - onApply(values) / onClear()
 *
 * 去重计数语义:每个值后显示的数目 = 按其他列筛选后、该值出现的行数(本列已选值不传后端,
 * 故选过的值也能看到其总数)。按 count 降序。
 */

interface ColumnFilterHeaderParams extends IHeaderParams {
  colName: string;
  selected: string[];
  backendUrl: string;
  tableId: string;
  headerRow: number | null;
  skipRows: number[][];
  otherFilters: Record<string, string[]>;
  onApply: (values: string[]) => void;
  onClear: () => void;
}

interface ColValue {
  value: string;
  count: number;
}

export default function ColumnFilterHeader(params: ColumnFilterHeaderParams) {
  const {
    displayName,
    colName,
    selected,
    backendUrl,
    tableId,
    headerRow,
    skipRows,
    otherFilters,
    onApply,
    onClear,
  } = params;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allValues, setAllValues] = useState<ColValue[]>([]);
  const [truncated, setTruncated] = useState(false);
  // 面板内临时勾选(确认才写回);打开时用 selected 初始化。
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));
  const [search, setSearch] = useState("");

  // 用 otherFilters 作缓存 key:其他列筛选变了,去重值需重拉。本列 selected 不影响拉取(不计入计数范围)。
  const otherKey = useMemo(
    () => JSON.stringify(otherFilters),
    [otherFilters]
  );
  // 切换列(tableId/colName 变)也要重拉。
  const fetchKey = `${tableId}|${colName}|${headerRow ?? ""}|${JSON.stringify(skipRows)}|${otherKey}`;

  const fetchValues = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = backendUrl.replace(/\/$/, "");
    try {
      const resp = await fetch(`${base}/api/table/column-values`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          column: colName,
          headerRow: headerRow ?? null,
          skipRows,
          filters: otherFilters, // 排除本列,使计数=按其他列筛选后的值计数
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { values: ColValue[]; truncated: boolean };
      setAllValues(data.values);
      setTruncated(data.truncated);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setAllValues([]);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, tableId, colName, headerRow, skipRows, otherFilters]);

  // 打开下拉时拉取(按 fetchKey 缓存:同 key 不重复拉)。
  const lastFetchedKey = useRef<string>("");
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // 重新用最新 selected 初始化临时勾选(每次打开同步当前筛选状态)
      setChecked(new Set(selected));
      setSearch("");
      if (lastFetchedKey.current !== fetchKey) {
        lastFetchedKey.current = fetchKey;
        void fetchValues();
      }
    }
  };

  // fetchKey 变化(其他列筛选/列切换)时,若面板开着则重拉;面板关着则下次打开拉。
  useEffect(() => {
    if (open && lastFetchedKey.current !== fetchKey) {
      lastFetchedKey.current = fetchKey;
      void fetchValues();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // 搜索过滤后的选项
  const filtered = useMemo(() => {
    if (!search.trim()) return allValues;
    const q = search.toLowerCase();
    return allValues.filter((v) => v.value.toLowerCase().includes(q));
  }, [allValues, search]);

  const allChecked =
    filtered.length > 0 && filtered.every((v) => checked.has(v.value));
  const someChecked = filtered.some((v) => checked.has(v.value));

  const toggleValue = (value: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked((prev) => {
      // 若当前过滤集已全选 → 反选取消这些;否则全选这些
      const next = new Set(prev);
      if (filtered.every((v) => next.has(v.value))) {
        filtered.forEach((v) => next.delete(v.value));
      } else {
        filtered.forEach((v) => next.add(v.value));
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onApply(Array.from(checked));
    setOpen(false);
  };
  const handleReset = () => {
    onClear();
    setChecked(new Set());
    setOpen(false);
  };

  const isFiltered = selected.length > 0;

  const overlay = (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        width: 300,
        boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        display: "flex",
        flexDirection: "column",
      }}
      // 阻止点击面板内滚动/选择时冒泡触发 ag-Grid 表头排序
      onClick={(e) => e.stopPropagation()}
    >
      {/* 搜索框 */}
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
        <Input
          size="small"
          allowClear
          placeholder="搜索选项"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          suffix={loading ? <Spin size="small" /> : null}
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border-strong)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
          }}
        />
      </div>

      {/* 全选/反选 */}
      {filtered.length > 0 && (
        <div
          onClick={toggleAll}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-panel)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <FakeCheckbox checked={allChecked} indeterminate={!allChecked && someChecked} />
          {allChecked ? "取消全选" : "全选当前结果"}
        </div>
      )}

      {/* 选项列表(带 count) */}
      <div style={{ maxHeight: 320, overflow: "auto" }}>
        {error ? (
          <div style={{ padding: 12, color: "var(--danger)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            加载失败:{error}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12, textAlign: "center", fontFamily: "var(--font-mono)" }}>
            {loading ? "加载中…" : "无选项"}
          </div>
        ) : (
          filtered.map((v) => {
            const on = checked.has(v.value);
            return (
              <div
                key={v.value}
                onClick={() => toggleValue(v.value)}
                style={{
                  padding: "5px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-panel)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <FakeCheckbox checked={on} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto" }}>
                  {v.value === "" ? <span style={{ color: "var(--text-dim)" }}>(空)</span> : v.value}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>{v.count}</span>
              </div>
            );
          })
        )}
      </div>

      {truncated && (
        <div style={{ padding: "4px 12px", fontSize: 11, color: "var(--text-dim)", borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
          去重值过多,仅显示前 5000 项
        </div>
      )}

      {/* 底部操作 */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: 8, borderTop: "1px solid var(--border)" }}>
        <button
          onClick={handleReset}
          style={btnStyle(false)}
        >
          重置
        </button>
        <button
          onClick={handleConfirm}
          style={btnStyle(true)}
        >
          确认{checked.size > 0 ? ` (${checked.size})` : ""}
        </button>
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        gap: 4,
        overflow: "hidden",
      }}
    >
      <span
        title={displayName ?? colName}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto" }}
      >
        {displayName ?? colName}
      </span>
      <Dropdown
        trigger={["click"]}
        open={open}
        onOpenChange={handleOpenChange}
        dropdownRender={() => overlay}
        placement="bottomRight"
      >
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            color: isFiltered ? "var(--accent)" : "var(--text-muted)",
            lineHeight: 1,
          }}
          title={isFiltered ? `已筛选 ${selected.length} 项` : "筛选此列"}
        >
          <FilterOutlined style={{ fontSize: 13 }} />
          {isFiltered && (
            <span
              style={{
                fontSize: 10,
                marginLeft: 2,
                background: "var(--accent)",
                color: "#0e1113",
                borderRadius: 8,
                padding: "0 4px",
                fontWeight: 600,
              }}
            >
              {selected.length}
            </span>
          )}
        </span>
      </Dropdown>
    </div>
  );
}

/** 自绘复选框(深色主题;项目未引 antd Checkbox)。 */
function FakeCheckbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  let inner: React.ReactNode = null;
  if (indeterminate) {
    inner = <span style={{ width: 8, height: 2, background: "var(--accent)", borderRadius: 1, display: "block" }} />;
  } else if (checked) {
    inner = (
      <svg viewBox="0 0 12 12" width="10" height="10" style={{ display: "block" }}>
        <path d="M2 6.5 L5 9 L10 3" stroke="#0e1113" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        border: `1px solid ${checked || indeterminate ? "var(--accent)" : "var(--border-strong)"}`,
        background: checked || indeterminate ? "var(--accent)" : "transparent",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {inner}
    </span>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "3px 12px",
    borderRadius: 4,
    border: "1px solid var(--border-strong)",
    background: primary ? "var(--accent)" : "transparent",
    color: primary ? "#0e1113" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "var(--font-sans)",
  };
}
