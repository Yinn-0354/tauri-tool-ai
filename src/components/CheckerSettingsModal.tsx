import { useEffect, useState } from "react";
import {
  Modal,
  Button,
  Input,
  AutoComplete,
  Segmented,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

/** 后端 GET /api/checker/config 返回结构。 */
interface CheckerConfig {
  env: "prod" | "dev";
  appkeyRoots: { appkey: string; branch: string; root: string }[];
  scriptLibRoot: string;
}

/** GET /api/checker/projects 返回的单个项目。 */
interface ProjectInfo {
  id: string;
  chinese_name: string;
  english_name: string;
}

interface CheckerSettingsModalProps {
  open: boolean;
  /** sidecar 基址。 */
  backendUrl: string;
  onClose: () => void;
  /** 保存成功后回调(App 用来 bumpEnvVersion 刷新徽标)。 */
  onSaved: () => void;
}

/** appkey+分支→根路径映射的可编辑行。 */
interface RootRow {
  appkey: string;
  branch: string;
  root: string;
}

/** MCP 端点提示(展示用,与后端 checker/config.py MCP_ENDPOINTS 对齐)。 */
const ENV_ENDPOINTS: Record<"prod" | "dev", string> = {
  prod: "http://10.11.66.70:7072/mcp",
  dev: "http://10.11.82.207:7000/mcp",
};

/**
 * AutoComplete filterOption:解决"选中某项后再次点开只剩当前项"的 bug。
 *
 * - 选中态(输入值已完整匹配某选项 value)→ 显示全部选项供改选,不按子串过滤。
 * - 打字搜索态(输入值未完整匹配任何选项)→ 按 value(+可选 label)子串过滤。
 * - 输入为空 → 显示全部。
 */
function filterOpt(
  options: { value: string; label?: string }[],
  matchLabel: boolean,
): (
  input: string,
  option: { value?: unknown; label?: unknown } | undefined,
) => boolean {
  return (input, option) => {
    const inp = input.toLowerCase().trim();
    if (!inp) return true;
    // 选中态:输入完整匹配某选项 → 全部显示(让用户改选其他项)
    if (options.some((o) => o.value.toLowerCase() === inp)) return true;
    // 打字搜索态:子串匹配 value(+可选 label)
    if (String(option?.value ?? "").toLowerCase().includes(inp)) return true;
    return (
      matchLabel && String(option?.label ?? "").toLowerCase().includes(inp)
    );
  };
}

/**
 * 配置检查器 · 全局设置弹窗(PRD 3)。
 *
 * 三项:
 * - 环境(prod/dev):决定后端调哪个 rulecheck MCP;后端按需读 config,无需重启。
 * - 脚本库根目录(PRD 3.2):全局单一,所有 appkey 共用;Claude 审核时按需 read_check_script 用。
 * - appkey→本地根路径映射(PRD 3.1):审核时 table_path 在根下解析绝对路径 open 表。
 *
 * 深色主题,沿用 OpenConfigModal/CommitDetailModal 写法。
 */
export default function CheckerSettingsModal({
  open,
  backendUrl,
  onClose,
  onSaved,
}: CheckerSettingsModalProps) {
  const [env, setEnv] = useState<"prod" | "dev">("prod");
  const [scriptLibRoot, setScriptLibRoot] = useState("");
  const [rows, setRows] = useState<RootRow[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  // 内置 SVN 分支(后端写死):{appkey: [分支...]}。给分支输入框补全,不在列表也允许手填。
  const [builtinBranches, setBuiltinBranches] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 弹窗打开时拉配置 + 项目列表(并行)。
  useEffect(() => {
    if (!open || !backendUrl) return;
    const base = backendUrl.replace(/\/$/, "");
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${base}/api/checker/config`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CheckerConfig>;
      }),
      fetch(`${base}/api/checker/projects`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ projects: ProjectInfo[] }>;
        })
        .catch((e) => {
          // 项目列表取失败不阻断(允许手填 appkey),降级空列表。
          console.warn("取项目列表失败", e);
          return { projects: [] } as { projects: ProjectInfo[] };
        }),
      fetch(`${base}/api/checker/builtin-branches`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ branches: Record<string, string[]> }>;
        })
        .catch((e) => {
          // 内置分支取失败不阻断(允许手填分支),降级空表。
          console.warn("取内置分支失败", e);
          return { branches: {} } as { branches: Record<string, string[]> };
        }),
    ])
      .then(([cfg, proj, br]) => {
        setEnv(cfg.env);
        setScriptLibRoot(cfg.scriptLibRoot ?? "");
        setRows(
          (cfg.appkeyRoots ?? []).map((r) => ({
            appkey: r.appkey ?? "",
            branch: r.branch ?? "",
            root: r.root ?? "",
          })),
        );
        setProjects(proj.projects ?? []);
        setBuiltinBranches(br.branches ?? {});
      })
      .catch((e) => {
        setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => setLoading(false));
  }, [open, backendUrl]);

  // appkey AutoComplete 选项:项目列表补全(显示 中文名 (id)),值用 id。
  const appkeyOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.chinese_name} (${p.id})`,
  }));

  const addRow = () => {
    setRows((prev) => [...prev, { appkey: "", branch: "", root: "" }]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  // 重复校验:复合键 appkey|branch(忽略首尾空白)。只要 appkey 非空就参与,
  // 不等路径填完——用户选完 appkey+分支就该立刻提示重复(不必等 root)。
  // 返回 Map<"appkey|branch", Set<行索引>>,供每行判断自己是否重复。
  const duplicateMap = (() => {
    const m = new Map<string, Set<number>>();
    rows.forEach((r, idx) => {
      const ak = r.appkey.trim();
      if (!ak) return; // appkey 为空才跳过(branch/root 空不影响重复判定)
      const key = `${ak}|${r.branch.trim()}`;
      if (!m.has(key)) m.set(key, new Set());
      m.get(key)!.add(idx);
    });
    return m;
  })();

  const rowDuplicateKey = (idx: number): string | null => {
    const r = rows[idx];
    const ak = r.appkey.trim();
    if (!ak) return null; // appkey 空不参与(还没开始填)
    const key = `${ak}|${r.branch.trim()}`;
    return (duplicateMap.get(key)?.size ?? 0) > 1 ? key : null;
  };

  const updateRow = (idx: number, key: keyof RootRow, val: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)),
    );
  };

  // Tauri 选文件夹(directory:true),返回路径或 null。
  const pickFolder = async (idx: number) => {
    try {
      const selected = await openDialog({ multiple: false, directory: true });
      if (typeof selected === "string") {
        updateRow(idx, "root", selected);
      }
    } catch (e) {
      setError(`选择文件夹失败: ${String(e)}`);
    }
  };

  const pickScriptLibRoot = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: true });
      if (typeof selected === "string") {
        setScriptLibRoot(selected);
      }
    } catch (e) {
      setError(`选择文件夹失败: ${String(e)}`);
    }
  };

  const save = async () => {
    const base = backendUrl.replace(/\/$/, "");
    // 前端先查重复:只要 appkey 非空就参与(不等 root 填完),有重复直接提示不提交。
    const seen = new Map<string, number[]>();
    rows.forEach((r, idx) => {
      const ak = r.appkey.trim();
      if (!ak) return;
      const key = `${ak}|${r.branch.trim()}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(idx + 1);
    });
    const dup = [...seen.entries()].find(([, lines]) => lines.length > 1);
    if (dup) {
      const [key, lines] = dup;
      const [ak, br] = key.split("|");
      setError(
        `appkey 映射重复:appkey=${ak} 分支=${br || "(空)"} 在第 ${lines.join("、")} 行重复,请改后再保存`,
      );
      return;
    }
    // 行:过滤掉 appkey 或 root 为空的(后端也会过滤,前端先清掉避免误存)。
    const appkeyRoots = rows
      .map((r) => ({
        appkey: r.appkey.trim(),
        branch: r.branch.trim(),
        root: r.root.trim(),
      }))
      .filter((r) => r.appkey && r.root);
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/api/checker/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env,
          appkeyRoots,
          scriptLibRoot: scriptLibRoot.trim(),
        }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${t ? `: ${t}` : ""}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-panel)",
    borderColor: "var(--border-strong)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={780}
      destroyOnClose
      title="配置检查器 · 全局设置"
      className="tt-modal"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={save}
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#0e1113",
              fontWeight: 500,
            }}
          >
            保存
          </Button>
        </div>
      }
    >
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
          加载中…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {error && (
            <div
              style={{
                background: "rgba(255,107,107,.12)",
                color: "var(--danger)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}

          {/* 1. 环境(prod/dev) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                letterSpacing: ".04em",
              }}
            >
              环境(决定后端调哪个 rulecheck MCP)
            </label>
            <Segmented
              value={env}
              onChange={(v) => setEnv(v as "prod" | "dev")}
              options={[
                { label: "正式 prod", value: "prod" },
                { label: "开发 dev", value: "dev" },
              ]}
              style={{ alignSelf: "flex-start" }}
            />
            <div
              style={{
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              端点:{ENV_ENDPOINTS[env]}
            </div>
          </div>

          {/* 2. 脚本库根目录(全局单一) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                letterSpacing: ".04em",
              }}
            >
              脚本库根目录(全局单一,Claude 审核时按需读检查脚本)
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <Input
                value={scriptLibRoot}
                onChange={(e) => setScriptLibRoot(e.target.value)}
                placeholder="如 D:\work\custom-rule"
                style={{ flex: 1, ...inputStyle }}
              />
              <Tooltip title="选择文件夹">
                <Button
                  icon={<FolderOpenOutlined />}
                  onClick={pickScriptLibRoot}
                  style={{
                    color: "var(--text-muted)",
                    borderColor: "var(--border-strong)",
                    background: "var(--bg-panel)",
                    flex: "0 0 auto",
                  }}
                />
              </Tooltip>
            </div>
          </div>

          {/* 3. appkey + 分支 → 本地根路径映射 */}
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
                appkey + 分支 → 本地根路径映射(审核时 table_path 在根下解析绝对路径)
              </label>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={addRow}
                style={{
                  color: "var(--accent)",
                  borderColor: "var(--accent-dim)",
                  background: "transparent",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                添加映射
              </Button>
            </div>
            {rows.length === 0 ? (
              <div
                style={{
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "8px 0",
                }}
              >
                暂无映射,点"添加映射"新建
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((row, idx) => {
                  const dupKey = rowDuplicateKey(idx);
                  const isDup = dupKey !== null;
                  // 分支补全选项:按当前行 appkey 从内置分支表取;appkey 无内置则空(仍可手填)。
                  const branchOptions = (builtinBranches[row.appkey.trim()] ?? []).map(
                    (b) => ({ value: b, label: b }),
                  );
                  return (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <AutoComplete
                          value={row.appkey}
                          onChange={(v) => updateRow(idx, "appkey", v)}
                          options={appkeyOptions}
                          placeholder="appkey(如 JX3)"
                          filterOption={filterOpt(appkeyOptions, true)}
                          style={{ width: 160, ...inputStyle }}
                          allowClear
                        />
                        <Tooltip
                          title="SVN 分支名(按 appkey 内置补全,也可手填)。同一 appkey 不同分支的表内容不同,故 appkey+分支 唯一对应一个根路径"
                          mouseEnterDelay={0.4}
                        >
                          <AutoComplete
                            value={row.branch}
                            onChange={(v) => updateRow(idx, "branch", v)}
                            options={branchOptions}
                            placeholder="分支(如 trunk)"
                            filterOption={filterOpt(branchOptions, false)}
                            style={{ width: 200, ...inputStyle }}
                            allowClear
                          />
                        </Tooltip>
                        <Input
                          value={row.root}
                          onChange={(e) => updateRow(idx, "root", e.target.value)}
                          placeholder="本地根路径"
                          style={{ flex: 1, ...inputStyle }}
                        />
                        <Tooltip title="选择文件夹">
                          <Button
                            icon={<FolderOpenOutlined />}
                            onClick={() => pickFolder(idx)}
                            style={{
                              color: "var(--text-muted)",
                              borderColor: "var(--border-strong)",
                              background: "var(--bg-panel)",
                              flex: "0 0 auto",
                            }}
                          />
                        </Tooltip>
                        <Button
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => removeRow(idx)}
                          style={{
                            color: "var(--text-dim)",
                            borderColor: "var(--border)",
                            background: "transparent",
                            flex: "0 0 auto",
                          }}
                        />
                      </div>
                      {/* 重复提示:复合键 appkey|branch 与其他行重复时显示 */}
                      {isDup && (
                        <div
                          style={{
                            color: "var(--danger)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            paddingLeft: 2,
                          }}
                        >
                          ⚠ 该 appkey+分支 已与其他行重复,保存时会被拦截
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div
              style={{
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              appkey 可从项目列表补全,也可手填;分支按 appkey 内置补全(JX3/mecha 已内置,其他可手填);
              appkey 或路径为空的行保存时忽略;appkey+分支重复会提示并拦截。
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
