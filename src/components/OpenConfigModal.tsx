import { useEffect, useState } from "react";
import { Modal, InputNumber, Button, Select } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";

/** 表头/跳过/编码配置。headerRow:1-based,null=自动(首行当表头)。skipRows:[[a,b],...] 1-based 闭区间。
 * encoding:文件编码(仅 .tab/.txt/.tsv 生效);null=自动探测。 */
export interface TableOpenConfig {
  headerRow: number | null;
  skipRows: number[][];
  encoding: string | null;
}

/** 编码下拉选项。value=null 为「自动」(走后端 chardet 探测),其余为强制指定编码。 */
const ENCODING_OPTIONS: { label: string; value: string | null }[] = [
  { label: "自动(探测)", value: null },
  { label: "UTF-8", value: "utf-8" },
  { label: "GBK", value: "gbk" },
  { label: "GB18030", value: "gb18030" },
  { label: "Big5", value: "big5" },
  { label: "UTF-16 LE", value: "utf-16le" },
  { label: "UTF-16 BE", value: "utf-16be" },
  { label: "Shift_JIS", value: "shift_jis" },
  { label: "EUC-KR", value: "euc-kr" },
  { label: "Latin-1", value: "iso-8859-1" },
];

interface OpenConfigModalProps {
  open: boolean;
  /** 文件路径,展示在标题。 */
  path: string;
  /** 预填的已有配置(来自 GET /api/table/config)。null=无记录。 */
  initial: TableOpenConfig | null;
  /** 提交(用户配置好后真正打开)。 */
  onSubmit: (cfg: TableOpenConfig) => void;
  /** 跳过配置直接打开(用 initial 或默认)。 */
  onSkip: () => void;
  /** 取消(关闭弹窗,不打开)。 */
  onCancel: () => void;
}

/** 一段 [start,end] 的内部编辑状态(允许临时空值,提交时校验)。 */
interface SkipSeg {
  start: number | null;
  end: number | null;
}

/** 把 [[a,b],...] 转成可编辑段列表。 */
function toSegs(skipRows: number[][]): SkipSeg[] {
  if (skipRows.length === 0) return [{ start: null, end: null }];
  return skipRows.map((seg) => ({ start: seg[0], end: seg[1] }));
}

/** 把可编辑段列表转成 [[a,b],...],过滤掉无效段(任一为空或 start>end)。 */
function fromSegs(segs: SkipSeg[]): number[][] {
  const out: number[][] = [];
  for (const seg of segs) {
    if (seg.start === null || seg.end === null) continue;
    if (seg.start < 1 || seg.end < 1) continue;
    if (seg.start > seg.end) continue;
    out.push([seg.start, seg.end]);
  }
  return out;
}

/**
 * 打开文件前的表格配置对话框。
 *
 * - 表头行:InputNumber,1-based,允许清空(=null 自动,首行当表头)。
 * - 跳过行:可编辑段列表,每段 [start,end] 1-based 闭区间,支持增删段。
 * - 「跳过配置直接打开」按钮:用 initial(无则 null/[])直接打开。
 * - 深色主题:bg-elevated,边框 border-strong,圆角 8,与 CommitDetailModal 一致。
 */
export default function OpenConfigModal({
  open,
  path,
  initial,
  onSubmit,
  onSkip,
  onCancel,
}: OpenConfigModalProps) {
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [segs, setSegs] = useState<SkipSeg[]>([{ start: null, end: null }]);
  const [encoding, setEncoding] = useState<string | null>(null);

  // 弹窗打开/initial 变化时同步本地编辑态。
  useEffect(() => {
    if (open) {
      setHeaderRow(initial?.headerRow ?? null);
      setSegs(toSegs(initial?.skipRows ?? []));
      setEncoding(initial?.encoding ?? null);
    }
  }, [open, initial]);

  const addSeg = () => {
    setSegs((prev) => [...prev, { start: null, end: null }]);
  };

  const removeSeg = (idx: number) => {
    setSegs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // 至少保留一段(空段在提交时会被过滤)。
      return next.length === 0 ? [{ start: null, end: null }] : next;
    });
  };

  const updateSeg = (idx: number, key: "start" | "end", val: number | null) => {
    setSegs((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [key]: val } : s))
    );
  };

  const submit = () => {
    onSubmit({ headerRow, skipRows: fromSegs(segs), encoding });
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={520}
      title="表格配置"
      className="tt-modal"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={onSkip} style={{ flex: "0 0 auto" }}>
            跳过配置直接打开
          </Button>
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            onClick={submit}
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#0e1113",
              fontWeight: 500,
            }}
          >
            打开
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 文件路径 */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            wordBreak: "break-all",
          }}
        >
          {path}
        </div>

        {/* 表头行 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              letterSpacing: ".04em",
            }}
          >
            表头行(1-based,留空=自动首行)
          </label>
          <InputNumber
            value={headerRow ?? undefined}
            min={1}
            placeholder="自动(首行)"
            onChange={(v) => setHeaderRow(v ?? null)}
            style={{
              width: "100%",
              background: "var(--bg-panel)",
              borderColor: "var(--border-strong)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
            }}
            controls={false}
          />
        </div>

        {/* 跳过行段列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <label
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                letterSpacing: ".04em",
              }}
            >
              跳过行段(1-based 闭区间,如 1-3)
            </label>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={addSeg}
              style={{
                color: "var(--accent)",
                borderColor: "var(--accent-dim)",
                background: "transparent",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              添加段
            </Button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {segs.map((seg, idx) => (
              <div
                key={idx}
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <InputNumber
                  value={seg.start ?? undefined}
                  min={1}
                  placeholder="起"
                  onChange={(v) => updateSeg(idx, "start", v ?? null)}
                  style={{
                    flex: 1,
                    background: "var(--bg-panel)",
                    borderColor: "var(--border-strong)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                  }}
                  controls={false}
                />
                <span
                  style={{
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  —
                </span>
                <InputNumber
                  value={seg.end ?? undefined}
                  min={1}
                  placeholder="止"
                  onChange={(v) => updateSeg(idx, "end", v ?? null)}
                  style={{
                    flex: 1,
                    background: "var(--bg-panel)",
                    borderColor: "var(--border-strong)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                  }}
                  controls={false}
                />
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeSeg(idx)}
                  style={{
                    color: "var(--text-dim)",
                    borderColor: "var(--border)",
                    background: "transparent",
                    flex: "0 0 auto",
                  }}
                />
              </div>
            ))}
          </div>
          <div
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginTop: 2,
            }}
          >
            被跳过的行不显示也不参与查找;无效段(任一为空或 起&gt;止)会被忽略。
          </div>
        </div>

        {/* 文件编码 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              letterSpacing: ".04em",
            }}
          >
            文件编码(仅 .tab/.txt/.tsv;乱码时改此项重开)
          </label>
          <Select<string | null>
            value={encoding}
            options={ENCODING_OPTIONS}
            onChange={(v) => setEncoding(v ?? null)}
            style={{
              width: "100%",
              fontFamily: "var(--font-mono)",
            }}
            popupClassName="tt-modal-select-dropdown"
          />
          <div
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            「自动」用 chardet 探测,不可靠时手动指定(如 GBK)。改编码会重新解析(不共享旧缓存)。
          </div>
        </div>
      </div>
    </Modal>
  );
}
