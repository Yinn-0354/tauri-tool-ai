# 配置检查器模块 · 需求文档（PRD）

> 状态：需求整理稿，待审。本文档不改动任何源代码，仅固化 grilling 过程中与产品负责人逐条确认的决策。
> 最后更新：2026-08-03
> 模块在侧边栏的占位与阶段 0 stub 已落地（`src/components/CheckerView.tsx`、`src/store/checkerStore.ts`、`python-backend/main.py` 的 `POST /api/checker/report`）。本文档定义从 stub 到真实闭环的目标形态。
>
> **实现进度**：
> - 阶段 1（第一二层 + 第三层 mock SSE 闭环）：✅ 已落地。
> - 阶段 2.1（第三层接真 Claude Agent SDK，无截图 MCP）：✅ 已落地（`audit.py` 真 `_run_audit` + `script_reader.py` `read_check_script` + `lib.rs` 退出清 `D:\temp\tauri-checker` + `AuditPanel.tsx` 动态步）。已用本机 GLM 网关端到端跑通。
> - 阶段 2.2（截图 MCP server + 隐藏 AG Grid + Python 接截图 MCP）：✅ 已落地（`mcp_screenshot.rs` axum HTTP MCP 7 工具 + `ScreenshotGrid.tsx` 隐藏 AG Grid 驱动 + `App.tsx` 双挂载 z-index + `audit.py` 读端口接 `McpHttpServerConfig`）。**已 `cargo tauri dev` 真联调验证通过**（HTTP 直连 initialize/tools/list + Tauri event 往返 + open_table 落 Parquet 缓存 + html2canvas 截出真 PNG + Claude 连截图 MCP 编排 7 工具全链路）。修复一个 SDK 坑：截图大结果被 CLI 持久化到文件（`<persisted-output>`），`audit.py._extract_screenshot_base64` 已兼容读文件解 list 嵌套 JSON。
> - 阶段 3（AI Agent 对话面板 + Git blame）：⏳ 未实现。
> - 增量需求 §12（2026-08 grilling）：✅ 已落地。分支识别 getReports（`rulecheck_client.get_reports` + `identify_report_branch_safe`）、多报告标签页（`checkerStore` 按 reportId 键控 + 两级导航）、审核前 svn update（`svn.svn_update` + audit 起点 SSE step）。
> - 增量需求 §12 补充（2026-08 改稿）：✅ 已落地。规则详情懒加载（§1.1/§5/决策24/42）：拉取时不再带 ruleDesc/scriptPath，点开规则弹窗经 `GET /api/checker/rule-detail?appkey&ruleId` 实时拉，后端按 appkey 全项目内存缓存（首次 1.4s 填缓存，之后 0.004s 秒出）；审核入参同样先拉详情。
> - 增量需求 §12 补充 2（2026-08 改稿）：✅ 已落地。项目颜色分组（§12.2/决策42）：报告标签带项目前缀 `JX3 · #9322 (发布分支)`；8 色序首见顺序分配、超 8 固定灰；边框+文字用项目色、底色 12% 透明；选中态=项目色实底（dark=深字、light=白字）。
> - 增量需求 §12 补充 2b（2026-08 改稿）：✅ 已落地。项目颜色双主题适配（§12.2/决策42）：新增 light 加深色板 `PROJECT_COLORS_LIGHT`，`projectColor()` 按 `<html data-theme>` 选色板，light 下文字/边框加深、选中态白字，保证 dark/light 双主题标签清晰可读。
> - 增量需求 §12 补充 3（2026-08 改稿）：✅ 已落地。单行报告标签（§12.2/决策36）：去掉两级导航/独立项目统计行，改为单行报告标签（项目前缀 + 报告ID + 分支别名 + 项目色），项目归属靠前缀 + 颜色双重标识。

---

## 0. 一句话定义

用户输入平台核对报告链接（+ 可选规则名）→ 工具展示该报告的规则汇总与逐条错误 → 用户在任一错误行点【审核结果】→ 前端把该行错误信息 + 规则顶层信息（规则名、模块等）+ 规则需求描述 + 脚本相对路径一并传给后端 → 后端起 Claude Agent，**Claude 不再回头调 rulecheck MCP**，仅连本地截图 MCP 去"现场开表 + 冻结ID列 + 滚到错误处 + 核验信息齐全 + 截图"，并在觉得需要时调用本地 `read_check_script` 工具按脚本相对路径读取检查脚本逻辑加强理解，结合以上信息生成发给策划的口语对话，连同截图一起返回展示。

---

## 1. 三层交互形态

| 层 | 触发 | 谁干活 | 展示 |
|---|---|---|---|
| 第一层 汇总 | 输入报告链接+可选规则名，点【拉取结果】 | **后端直连 rulecheck MCP**（不经过 Claude），按规则名过滤后透传 | 每条规则一个可折叠区块，字段：规则名、模块、错误数、执行时间、首次报错时间、创建人、测试负责人、是否通过 |
| 第二层 错误列表 | 点区块左侧【展开结果】 | 纯前端展开折叠（数据已在第一层拿到） | 该规则的 errorObj 列表，字段：配置表、字段（name）、错误信息 |
| 第三层 审核 | 点某条错误最右侧【审核结果】 | **Claude Agent SDK** 介入。前端把该行 errorObj + 规则顶层信息 + 规则需求描述 + 脚本相对路径传给后端，后端起 Claude；Claude 仅连本地截图 MCP 做核查+截图，按需调本地 `read_check_script` 读脚本逻辑 | 行内展开面板：上方进度流水，下方口语对话+截图 |

### 1.1 第一层细则
- **规则名可选**：填了 → 后端本地按 `rule_name` **精确匹配**返回对应规则；没填 → 返回全部规则。这是**拉取时的数据过滤**，在后端做，与结果区搜索框（见下）不同。
- **"是否通过"** 按 `error_count == 0` 判断。通过的规则**没有**【展开结果】按钮（无错误可展）。
- **规则详情懒加载**：第一层返回的 rules **不含** ruleDesc/scriptPath；点开规则弹窗时实时拉取（见 §5），按 appkey 全项目后端内存缓存。
- **滚动**：结果区（规则汇总列表）为唯一滚动区，结果过长时上下滚动。沿用布局铁律——根容器 100% 高 + overflow:hidden，仅结果区内滚动（CheckerView 结果区已 `overflow:auto`）。
- **搜索框（结果区顶部）**：拉取后的**前端本地即时过滤**展示，不经过后端。
  - 位置：结果区顶部、输入区下方。独立于输入区的"规则名输入框"（后者是拉取时过滤数据，两者语义不同）。
  - 匹配：**全字段聚合**——关键词（去首尾空格、大小写不敏感；`testLead` 数组 join 成字符串参与匹配）对 `rule_name`/`module`/`owner`/`testLead`/规则需求描述 任一包含即命中；纯数字关键词额外做 `error_count == 数字` 精确匹配（任一命中即显示该规则）；空关键词显示全部。
  - 交互：输入即时过滤，`debounce` ~200ms；带 **× 清空按钮**（清空恢复全部）；搜索框旁显示**"命中 N / 共 M"**。
  - 过滤后**只显示命中规则**，未命中隐藏；搜索时**折叠全部命中规则**（只显示第一层汇总，点【展开结果】再看错误列表）。

### 1.2 第二层细则
- 每条规则默认**折叠**。通过（`error_count==0`）的规则无展开按钮。
- 展开后每条 errorObj 一行，字段：配置表（`table_path`）、字段（`name`）、错误信息（`value`）。
- 每行最右侧有【审核结果】按钮。

### 1.3 第三层细则（审核）
- 点【审核结果】→ 该行**行内展开**面板：
  - 上半：进度流水（SSE `step` 事件渲染，带图标：开表✓ → 冻结ID列✓ → 跳转✓ → 核验✓ → 截图✓ → 生成对话✓）。
  - 下半：口语对话（一次性返回）+ 截图。
- **串行**：同时只允许一个审核驱动共享的隐藏表格实例。连点多条时，第 2 条起显示"排队中（前面还有 N 个）"，轮到再开始。
- **降级**：截图取不到时，`result.screenshot = null` + `screenshotReason`（Claude 兜底生成一句原因），前端显示原因文字 + 无图。
- 截图在行内面板用**缩略图**展示，点击放大/另存（避免宽图撑爆面板）。

---

## 2. 数据契约（真实 errorObj，替代阶段0 stub）

### 2.1 rulecheck MCP 返回的顶层结构
```
{
  "code": 0,
  "msg": "success",
  "data": [                          // 多个规则结果
    {
      "rule_name": "书籍资源检查-SourceBoss 引用检查",
      "rule_id": 1386,
      "rule_is_deleted": false,
      "module": ["书籍"],             // 模块
      "owner": "...",                  // 创建人
      "status": "fail",
      "note": {"fails": 89, "message": ""},
      "result": {
        "error_count": 89,             // 是否通过 = (error_count==0)
        "run_time": "...",            // 执行时间
        "first_detected_time": "...",  // 首次报错时间
        "author": [],                  // (汇总级,见下)
        "testLead": [],               // 测试负责人(汇总级)
        "rule_assigness": [{"id":10,"name":"...","email":"..."}],  // 规则负责人
        "content": {                   // 表名 → errorObj[]
          "RecipeBelong.txt": [ ... ]
        }
      }
    }
  ]
}
```

### 2.2 单条 errorObj 结构
| 字段 | 含义 | 备注 |
|---|---|---|
| `table_path` | 配置表名，可能纯文件名或带相对路径（`RecipeBelong.txt` / `client/ui/.../X.txt`） | 用于工作区根路径解析绝对路径 |
| `rowID` | **行号**，但脚本不规范：可能 `["291"]` / `[291]` / `[-1]`，字符串与数字混用 | `-1` = 某 ID 在表里找不到对应行；不能一见 -1 就跳过，要读 `value` 判断 |
| `name` | 被检查的列名/字段名 | 大部分时候就是被检查值的列，截图目标列；仍要结合 `value` 判断，不在表里要兜底 |
| `value` | 大段多行自然语言：含业务字段值（`BookID=50, BookName=《...》`）、问题陈述、`tab取值` 对照、根因 | Claude 理解 + 口语对话生成的唯一输入源 |
| `author` / `testLead` | 行级负责人（多为 null/[]） | |
| `desc_hash` | 去重哈希 | |

> ⚠️ 编码：样本文档 `errorObj.txt` 是双重 mojibake 损坏样本，**不代表运行时数据**。运行时 rulecheck MCP 应返回正确 UTF-8 JSON。实现时以真实 MCP 返回为准，不据损坏样本推断字段语义。

> ⚠️ stub 契约 `{id, table, field, row, message, severity}` **全部作废**，前端 store/组件要按上述真实结构改造。**无 severity 字段**，结果列表不分级，统一样式。

---

## 3. 全局设置

新增全局设置（用户可随时修改），存独立配置文件，含两项：

### 3.1 工作区根路径映射：`appkey → 本地根路径`
- appkey 从报告链接 path 段抠取（如 `https://rulecheck.testplus.cn/project/jw3qptqjb/summary?reportId=9229` → appkey=`jw3qptqjb`）。
- errorObj 的 `table_path`（纯文件名或相对路径）在工作区根路径下做文件名/相对路径匹配，解析出绝对路径，复用现有 `table_io.py` open → 落 Parquet 缓存 → 拿 tableId + columns。
- 命中唯一 → 直接用；命中多个 → 候选让 Claude/用户处理；命中零 → 报错"本地找不到该表"。

### 3.2 脚本库根目录（全局单一）
- 所有 appkey/项目共用一个脚本库根目录。
- 规则详情里的"脚本相对路径"拼接此根目录得到完整脚本路径，供 Claude 按需读取检查脚本逻辑（见 4.3 `read_check_script`）。
- 文件不存在/读不到时返回空 + `notFound: true`，不阻断审核。

---

## 4. 截图链路（核心难点）

### 4.1 进程拓扑
```
点【审核结果】:前端把 [errorObj + 规则顶层信息 + 规则需求描述 + 脚本相对路径 + appkey] 传后端
  ▼
Claude(Python sidecar, Agent SDK, glm-5.2[1M])   ← 错误信息经入参直接喂入,不回头调 rulecheck MCP
  │ ① 本地函数工具 read_check_script(scriptRelPath)(按需,觉得需要脚本逻辑时才调)
  │     → 用 [全局脚本库根 + scriptRelPath] 拼完整路径读脚本返回(不存在则 notFound)
  │ ② 调本地截图 MCP(HTTP,常驻 Tauri 内,端口写文件)现场操作表格+截图
  ▼
本地截图 MCP server(Rust/Tauri 壳)   ← 仅含"驱动 WebView + 截图"类工具,read_check_script 不在此
  │ emit Tauri event ──▶ React WebView
  │                        ├─ 隐藏存活的 TableView 实例执行冻结/滚动/截图
  │                        └─ html2canvas 截 AG Grid 根 div → base64
  │ ◀── Tauri event 回传 base64 ──
  ▼
Claude 拿截图 + errorObj.value + 规则需求描述(+按需脚本逻辑)生成口语对话 → 一起返回前端
```

### 4.2 截图方案：html2canvas 截 DOM
- 截 AG Grid 的根 div（真实样式 + 真实冻结/滚动状态），**不截窗口**（检查器与表格互斥全屏，截窗口会截到检查器自己）。
- 截图 = base64 → Rust → Claude。
- 因此**检查器激活时必须保持一个隐藏存活的 TableView 实例**（否则 AG Grid 没法冻结/滚动/截图）。
  - 承载方式：**z-index 藏后面**。当前 `App.tsx` 是 `active==="checker" ? CheckerView : 表格视图` 的互斥三元，需改为**两者都挂载**，检查器不透明背景 `z-index` 盖住表格；表格实例正常渲染像素（html2canvas 稳定可截），用户看不见。排除 `display:none`（截出来空白）。

### 4.3 Claude 的工具集
Claude 的工具来自**两个来源**，语义分离：

**A. 本地截图 MCP server（HTTP，常驻 Tauri 内）—— 仅"驱动隐藏 AG Grid + 截图"类工具（7 个）：**

| 工具 | 作用 | 入参 → 返回 |
|---|---|---|
| `open_table(table_path)` | 工作区根解析绝对路径，open 表 | → `{columns[], rowCount, idColCandidates[]}` |
| `get_columns(table_path)` | 只拿列名（判断 name 在不在、找 ID 列） | → `{columns[]}` |
| `search_cell(query)` | 全表搜某值定位行（rowID 不可信时回退） | → `{matches:[{rowIndex,colIndex,value}]}` |
| `freeze_column(colName)` | 冻结某列到左（复用现有 freezeColumn） | → `{ok}` |
| `goto_cell(rowID_or_rowIndex, colName?)` | 跳到某行某列，触发 infinite 加载 | → `{ok, cellValue}` |
| `get_viewport_info()` | 读当前视口可见行列/单元格值（**核验"信息齐全"用**） | → `{visibleCols[], visibleRows[], topLeftRow, focusedCell, cells:{...}}` |
| `screenshot()` | html2canvas 截当前 AG Grid 根 div | → `{imageBase64}` |

**B. Agent SDK 本地函数工具（不走 MCP）—— 文件读取类（1 个）：**

| 工具 | 作用 | 入参 → 返回 |
|---|---|---|
| `read_check_script(scriptRelPath)` | 用 [全局脚本库根 + scriptRelPath] 拼完整路径读检查脚本逻辑。Claude **按需**调，不需要时不调省 IO | → `{content, notFound}`（文件不存在/读不到时 `content=""`, `notFound=true`，不阻断审核） |

> 不把 `read_check_script` 塞进截图 MCP：截图 MCP 职责是"操作 WebView + 截图"，读文件与它无关，混进去破坏内聚。Agent SDK 本就支持"本地工具 + MCP 工具"混合给 Claude。
>
> 细粒度而非一把梭：把判断权交给 Claude，遇 `name` 不在表、`rowID=-1`、需不需要看脚本等由 Claude 自行决策，不前端硬编码。

### 4.4 截图 MCP 跨进程
- **HTTP MCP 常驻 Tauri 内**（不用 stdio spawn：spawn 的独立进程够不着 Tauri WebView，发不了 event、截不了 webview）。
- Rust↔前端往返用 **Tauri event 往返**（Rust emit 给前端执行，前端 emit 回 Rust，Rust await 回传）。
- 端口发现：Rust 起本地 HTTP MCP 端点，写 `%TEMP%/tauri-tool-ai-mcp-port.txt`，Python sidecar 读端口连。复用现有 sidecar 端口发现机制。

### 4.5 唯一ID列识别（截图"信息齐全"前提）
- **(c) 优先**：从 errorObj `value` 里 `列名=值` 形式反推主键列名（平台用主键值定位的行，主键列名大概率在 value 里）。
- **(a) 兜底**：value 里没有 → 扫 columns 找 `*ID`/`*id`/`编号`/`code` 启发式。
- 都找不到 → 不冻结，截图只截错误列，ID 用文字补在口语对话里。
- 备注列：扫 columns 找"备注/Note/Comment"启发式。

### 4.6 截图"信息齐全"判定标准（Claude 用 get_viewport_info 核验）
> 视口同时可见 → 唯一ID列（冻结在左）+ 错误行 + 错误列，且该行 ID 值、错误列值、备注列值（如有备注列）都在屏上 → 截图。不齐就再 freeze/goto 调整，齐了才截。

### 4.7 定位决策（"综合判断"的落地，Claude 编排）
1. **定表**：`table_path` → 工作区根匹配 → open。
2. **定行**：`rowID` 正整数 → 候选行号；`-1`/不可解析 → 弃用行号转用 value 业务值 search。**行号需校验**：跳到该行读实际内容与 value 业务字段值比对，对得上才采信，对不上回退 search。
3. **定列**：`name` 在 columns → 候选列；不在 → 从 value 文本猜；仍校验该列该行值与 value 是否自洽。
4. **冻结+滚动**：冻结唯一ID列 → goto 错误行+错误列 → get_viewport_info 核验齐全 → 不齐调整 → 齐了 screenshot。
5. **降级**：实在定位不了 → screenshot 返回 null + Claude 生成"错误信息不规范，无法定位截图"原因，仍生成口语对话。

---

## 5. 第一层 rulecheck MCP 调用
- **MCP 端点按环境选**（`checker/config.py` `MCP_ENDPOINTS`）：prod=`http://10.11.66.70:7072/mcp`，dev=`http://10.11.82.207:7000/mcp`。全局设置里有 env 切换。
- 报告链接只用来抠 `reportId`（query）和 `appkey`（path），不直接当 MCP URL。
- 后端调 MCP 工具按 `reportId` 拿全量 `data[]`（含每条规则的 errorObj 全量），**规则名过滤在后端本地做**（不依赖 MCP 支持过滤参数）。
- **规则详情懒加载（2026-08 改稿）**：拉取时**不再**补规则详情（desc/script_path），rules 里这两项为空。用户**点开规则弹窗时**才实时拉取：
  - 触发点：点开规则弹窗（`RuleDetailModal` 打开）时。
  - 接口：`GET /api/checker/rule-detail?appkey=<appkey>&ruleId=<ruleId>` → 返回 `{ruleDesc, scriptPath}`。
  - 缓存：**后端内存缓存**，按 **appkey 全项目**粒度——首次点开某 appkey 的任一规则时调 `get_all_rules_in_project(appkey)` 拿全项目详情填缓存，之后该 appkey 下所有规则（跨报告、跨标签）点开秒出。关闭应用进程退出即清，零额外清理代码。
  - 加载态：弹窗打开即触发，规则描述区 loading → 展示；命中缓存秒出无 loading。
  - 失败降级：MCP 不可达/拉取失败 → 弹窗照常显示 errorObj 列表（拉取时已有），描述区显示"规则详情加载失败：<原因>" + 可重试，不阻断弹窗。
  - 此改动保留性能优化思路：全项目一次拉取代逐条拉取（沿用 get_all_rules_in_project），只是从"拉取时预取"挪到"首次点开懒取"，MCP 调用次数反而更少。
- **分支识别（2026-08 新增，见 §12.1）**：拉取报告时顺带调 MCP `get_reports`，按 reportId 匹配取 branch。
- **无需鉴权**（内网信任）。
- rulecheck MCP 的调用**仅在第一层**发生；第三层审核 Claude 不再连 rulecheck MCP。

---

## 6. Claude 会话与凭证
- **运行时**：Python Claude Agent SDK，跑在现有 sidecar。
- **角色**：Claude = orchestrator，审核时**仅连本地截图 MCP**（驱动表格 + 截图）。错误信息经审核入参直接喂入，**不回头调 rulecheck MCP**；脚本逻辑经本地函数工具 `read_check_script` 按需读取。（推翻旧阶段 B "Claude 当 MCP server" 的设计，也推翻"Claude 审核时连 rulecheck MCP"的早期设想。）
- **凭证**：复用本机 `~/.claude/settings.json` 的 `env` 段（同事本机都有同样配置，零配置可分发）：
  - `ANTHROPIC_AUTH_TOKEN`（Bearer）
  - `ANTHROPIC_BASE_URL` = `http://120.92.138.34`（内网网关）
  - `ANTHROPIC_CUSTOM_HEADERS`（多行字符串，parse 成 dict：`x-ksc-company-code`/`ksyun-code-type`/`ksyun-code-version`/`User-Agent`/`Accept`）经 `default_headers` 注入
  - 注：网关后挂 GLM（glm-5.2）伪装 Anthropic 协议，tool use 已验证可用。
- **模型**：审核用 `glm-5.2[1M]`（长上下文）。
- **会话生命周期**：每次审核**新建无状态会话**，跑完销毁。系统提示词后端写死常量（开发者维护，不暴露用户配）。
- **会话日志**：
  - 目录 `D:\temp\tauri-checker\<errorObjId>_<时间戳>`。
  - 存：Claude 完整对话历史（JSONL）+ MCP 工具调用 JSON + 截图 PNG。
  - 销毁时机：**软件关闭时清掉 `tauri-checker` 目录**（运行期间保留供排查）。

---

## 7. SSE 事件协议（审核进度）
`POST /api/checker/audit` 返回 SSE 流。

**审核入参（前端点【审核结果】时发后端、后端喂 Claude）**：
- 该 errorObj：`table_path`、`rowID`、`name`、`value`、`desc_hash`
- 该规则顶层信息：`rule_name`、`rule_id`、`module`、`owner`、`note`、`status`
- 规则需求描述（MCP 规则详情直返）
- 脚本相对路径（MCP 规则详情直返；**只传路径，脚本内容由 Claude 按需 read_check_script 取**）
- appkey（用于工作区根路径解析）

**事件类型：**

| type | 何时推 | data |
|---|---|---|
| `queued` | 排队中 | `{position: N}` |
| `start` | Claude agent 起来 | `{errorObjId}` |
| `step` | 每个工具调用开始（含截图 MCP 7 工具 + read_check_script） | `{tool, desc}`（"正在打开配置表"… / "正在读取检查脚本"…） |
| `step_done` | 工具调用返回 | `{tool, result摘要}` |
| `result` | 全部完成 | `{conclusion: 口语对话, screenshot: base64\|null, screenshotReason: 原因\|null}` |
| `error` | 失败 | `{message}` |

- **中粒度**：推 step 流水（开表/冻结/跳转/核验/截图/读脚本(如有)），不推 Claude 中间思考片段。
- 口语对话**一次性返回**在 `result.conclusion`，不逐字流式。
- 后端做 SDK 原生事件 → 业务语义事件的映射层，不吐 raw 流。

---

## 8. 验收标准（每条可机器判定）

### 第一层
- [ ] 输入链接+点拉取 → 后端调 rulecheck MCP 拿 `data[]`，按规则名过滤，前端渲染汇总表格。
- [ ] 不填规则名返回全部；填了精确匹配返回对应规则。
- [ ] `error_count==0` 的规则无【展开结果】按钮。
- [ ] 汇总字段齐全：规则名、模块、错误数、执行时间、首次报错时间、创建人、测试负责人、是否通过。
- [ ] **规则详情懒加载**：第一层返回不含 ruleDesc/scriptPath；点开规则弹窗实时拉取（`/api/checker/rule-detail`），描述区 loading→展示；命中 appkey 缓存秒出。
- [ ] 规则详情失败 → 弹窗照常显示 errorObj，描述区"加载失败+重试"不阻断；关闭应用后端内存缓存清空。
- [ ] 结果过长时结果区可上下滚动（仅结果区内滚动，根容器不产生页面级滚动条）。
- [ ] 结果区顶部搜索框：全字段聚合（规则名/模块/创建人/测试负责人/规则需求任一包含即命中）；纯数字关键词额外匹配错误数精确值；大小写不敏感；debounce ~200ms；×清空恢复全部；显示"命中 N / 共 M"。
- [ ] 搜索过滤后只显示命中规则；搜索时折叠全部命中规则。

### 第二层
- [ ] 点【展开结果】→ 展开该规则 errorObj 列表，字段：配置表、字段、错误信息。
- [ ] 默认折叠。

### 第三层（审核）
- [ ] 点【审核结果】→ 行内展开，进度流水按 step 事件实时显示。
- [ ] 审核入参含 errorObj + 规则顶层信息 + 规则需求描述 + 脚本相对路径 + appkey；Claude 不回头调 rulecheck MCP。
- [ ] 串行：第二个审核点显示"排队中"。
- [ ] 完成后显示口语对话 + 截图缩略图（点开放大）。
- [ ] 截图取不到时显示原因文字 + 无图。
- [ ] 截图中视口同时可见：唯一ID列 + 错误行 + 错误列（+备注列如有）。
- [ ] `rowID=-1` 且 value 挖不出定位时，降级为只生成对话 + "无法定位截图"原因，不硬截错图。
- [ ] `name` 不在表 columns 时，结合 value 定位；实在不行兜底反馈。
- [ ] Claude 觉得需要脚本逻辑时调 `read_check_script`（用全局脚本库根 + 相对路径）；脚本不存在返回 notFound 不阻断。

### 凭证/分发/配置
- [ ] 读本机 `~/.claude/settings.json` 的 env 注入 SDK，零配置。
- [ ] token 不写进源码/不进 git。
- [ ] 全局设置含两项：appkey→本地根路径映射 + 全局单一脚本库根目录。

### 日志
- [ ] 每次审核建 `D:\temp\tauri-checker\<errorObjId>_<时间戳>`。
- [ ] 存对话历史 + MCP 调用 + 截图 PNG。
- [ ] 软件关闭时清目录。

---

## 9. 已确认的决策清单（备查）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 架构/运行时 | Claude Python Agent SDK 跑 sidecar，当 orchestrator（推翻旧阶段B server 设计）；审核时仅连本地截图 MCP，错误信息经入参喂入不回头调 rulecheck MCP |
| 2 | 截图桥归属 | Rust/Tauri 壳（能截 webview、能 emit 事件给前端） |
| 3 | 本地表来源 | 全局设置 appkey→本地根路径，table_path 在根下匹配解析绝对路径 |
| 4 | 挑选规则 | **作废**：改为用户在第二层手点【审核结果】逐条触发 |
| 5 | 检查点分组 | **作废**（随挑选规则作废） |
| 6 | 截图方案 | (B) html2canvas 截 AG Grid 根 div |
| 7 | 隐藏表格实例 | 检查器激活时保持隐藏存活实例 |
| 8 | 工具粒度 | (b) 细粒度 7 个 MCP 工具，Claude 自编排 |
| 9 | 新形态 | 链接+可选规则名→汇总→展开→逐条审核 |
| 10 | 第一层 Claude | 不经过 Claude，后端直连 MCP 透传 |
| 11 | 是否通过 | `error_count==0` |
| 12 | MCP 调用 | 端点固定 10.11.66.70:7072/mcp，链接抠 reportId+appkey，过滤后端本地做，无鉴权 |
| 13 | 执行模型 | SSE 流式，中粒度 step 事件 |
| 14 | 并发 | 串行（共享一个 AG Grid 实例不支持并发），排队显示 |
| 15 | 会话生命周期 | 每次新会话，跑完销毁，提示词后端写死 |
| 16 | 凭证 | 复用 ~/.claude/settings.json env 段（方法IV内网网关+自定义头），模型 glm-5.2[1M] |
| 17 | 跨进程 | 截图 MCP = HTTP MCP 常驻 Tauri 内，Tauri event 往返，端口写文件 Python 读 |
| 18 | 唯一ID列 | (c)value 反推优先 + (a)列名启发式兜底 |
| 19 | 定位决策 | 行号优先+业务值校验，对不上回退 search；-1 读 value 判断不硬跳过 |
| 20 | 日志 | D:\temp\tauri-checker\<id>_<ts>，软件关闭时销毁 |
| 21 | 隐藏实例承载 | z-index 藏后面（排除 display:none 截图空白） |
| 22 | 审核结果 UI | 行内展开，截图缩略图点开放大 |
| 23 | 口语对话 | 一次性返回，不逐字流式 |
| 24 | 规则详情来源 | 规则需求描述 MCP 直返；脚本相对路径 MCP 直返，只传路径不传内容。**2026-08 改稿：改为懒加载，拉取时不带，点开规则弹窗实时拉** |
| 25 | 检查脚本逻辑获取 | Claude 按需调本地函数工具 `read_check_script`（用全局脚本库根 + 相对路径），不塞进截图 MCP；不存在返回 notFound 不阻断 |
| 26 | 脚本库根目录 | 全局单一（所有 appkey 共用），与 appkey→项目根映射同级配置 |
| 27 | 结果区滚动 | 结果过长上下滚动，仅结果区内滚动（沿用根容器 overflow:hidden 铁律） |
| 28 | 结果区搜索框 | 前端本地即时过滤；全字段聚合（纯数字关键词额外精确匹配错误数）；只显示命中规则；搜索时折叠全部；debounce 200ms + ×清空 + 命中 N/共 M |
| 42 | 规则详情懒加载 | 拉取时不补详情；点开规则弹窗实时拉（`/api/checker/rule-detail?appkey&ruleId`）；后端内存缓存按 appkey 全项目，关闭应用即清；失败描述区提示+重试不阻断弹窗 |

---

## 10. 待办与风险

### 待办（实现时再定）
- [ ] 全局设置 UI 的具体形态（appkey→根路径表编辑 + 全局脚本库根，放在哪个入口）。
- [ ] rulecheck MCP 实际暴露的 tools 名（需 `list_tools` 探明）：取报告汇总的工具、取单条规则详情（含规则需求描述 + 脚本相对路径）的工具。
- [ ] html2canvas 对 AG Grid 复杂 DOM 的截图保真度验证。
- [ ] GLM 网关对 Agent SDK 多轮 tool_use 编排的兼容性实测。
- [ ] 串行排队的具体 UI（"排队中 N"显示位置、取消排队）。
- [ ] Claude 系统提示词的具体内容（工具使用顺序、核验标准、降级逻辑、何时该调 read_check_script）。
- [ ] read_check_script 的健壮性：相对路径拼接安全（防越界）、编码探测（脚本可能非 utf8）、大文件截断策略。

### 已知风险
- **GLM 经网关伪装 Anthropic 协议**：tool use 已验证可用，但 Agent SDK 的 sub-agent / 流式 tool_use 事件兼容度需实测。
- **table_path 路径形态不一**（纯文件名 vs 相对路径）：匹配逻辑要兼容两种。
- **rowID 字符串/数字混用 + -1**：解析要 robust。
- **截图 MCP 驱动隐藏实例**：AG Grid 在 z-index 后台时的冻结/滚动/截图时序（infinite row model 异步加载未加载块）需小心，goto 后要等行加载完再 get_viewport_info。

---

## 11. 项目代码规范（前端）

> 本节是跨模块通用的前端代码规范，不只针对配置检查器。新增/修改前端组件时必须遵守。

### 11.1 组件复用优先，禁止复制
- 同一交互形态（弹窗 / 表单 / 列表项 / 工具栏按钮 / 输入框带粘贴 等）只写一份，多处复用，**不复制粘贴**。
- 复用方式：抽公共组件或公共子组件，差异通过 `props` 配置；跨组件共享的状态用 store / 自定义 hook。
- 确实需要拆成多个组件时（职责差异大到不便合一），仍要保证它们**共用同一套样式**，不各自带一份。

### 11.2 样式集中管理，禁止就地复制内联 style
- 重复的样式不散落在各组件的内联 `style` 里，集中放到全局样式表 `src/theme.css`，用语义类名引用。
- 新增可复用 UI 块：先看 `theme.css` 有无现成类，没有就抽一个语义类，再各处引用，**不要就地复制内联 style**。
- 这条直接来自一次已踩的坑（见下反例）。

### 11.3 反例与正例（弹窗统一样式）

**反例（已发生）**：4 个弹窗（`CheckerSettingsModal` / `OpenConfigModal` / `CommitDetailModal` / `CheckerView.RuleDetailModal`）各自复制了同一份内联 `styles`，且误用 `styles.root`——antd v6 的 `styles.root` 作用于**全屏 `.ant-modal-root`**，而非可见卡片 `.ant-modal-container`。后果：
- 灰底 + 边框 + 圆角套到全屏容器 → 灰底溢满全屏
- 可见卡片没显式 padding → 文字顶格
- 关闭按钮按 antd 默认算到 `≈2px` → 卡在卡片边缘
- hover 背景叠在卡片与全屏灰底之间 → 层叠错位

**正例（已修复）**：抽一套全局样式到 `theme.css` 的 `.tt-modal` 类，4 个弹窗统一 `className="tt-modal"`，删掉各自重复的内联 `styles`。可见卡片改用 `.ant-modal-container` 正确选择器，显式给三段式 padding（header/body/footer 各自带）、关闭按钮内缩 12px、hover 用 accent-soft 单层底色。

> 新弹窗一律 `className="tt-modal"`，不要自带内联 `styles`。其他可复用 UI 块同理。

---

## 12. 增量需求（2026-08 grilling，三个新功能）

> 本节是 2026-08 grilling 确认的三个新功能，叠加在阶段 1/2.1/2.2 已落地实现之上。标注 ⏳ 的为待实现，其余为已确认需求。

### 12.1 分支识别（getReports）

**目标**：根据报告 id 识别该报告属于哪个 SVN 分支，取代"用户手填分支"（现状 `BUILTIN_BRANCHES` 手填）。

**MCP 接口**：`get_reports`（MCP 工具 `get_reports`，入参 `{projectId, start_time, end_time}`）。

```
入参示例:
{ "projectId": "JX3", "start_time": "2026-07-29", "end_time": "2026-08-04" }

返回数组每项:
{
  "id": 9269, "project_id": "JX3",
  "branch": "branches-rel/b_jx3_released_zhcn_hd",   ← 分支名,与 config.appkeyRoots 的 branch 格式一致
  "branch_alia": "发布分支",                          ← 分支别名(UI 显示用)
  "version": "1896039",
  "success_result_count": 178, "exception_result_count": 0, "fail_result_count": 7,
  "error_count": 93, "total_rule_count": 185, "total_table_count": 1918,
  "has_statistic": true, "create_time": "2026-07-29 05:43:20"
}
```

**识别流程**：
1. 拉取报告时顺带调 `get_reports({projectId=appkey, start=今天-7天, end=今天})`。
2. 在返回数组里按 `id == reportId` 匹配 → 命中 → 取 `branch` + `branch_alia`。
3. `get_appkey_root(appkey, branch)` 查本地根路径（branch 格式与 config 一致，无需映射层）。
4. 没命中（报告超 7 天 / 不属于该 projectId）→ **软降级**：回退 `get_appkey_root(appkey, "")` 默认分支；审核照跑，提示用户手填。

**UI**：报告标签旁/详情显示分支 `branch_alia`（如"发布分支"）。用户能确认识别对不对，错了可在设置里纠正。

> 实测（2026-08）：正式环境 MCP `get_reports` 已可用（真调 JX3 7/28~8/4 返回 30+ 篇）。**无需环境特殊处理**，全环境调 getReports；调用失败/匹配不到才降级。

### 12.2 多报告标签页

**目标**：支持同时查看多篇报告，标签页切换（类似表格查看器多 tab）。

**形态**：
- **单行报告标签**：顶部一行报告标签，每个标签 = 项目前缀 + 报告 ID + 分支别名（`JX3 · #9322 (发布分支)`）。**不再有两级导航**（去掉独立项目统计标签行）——项目归属靠标签上的项目前缀 + 项目色双重标识。
- **标签来源**：粘链接→拉取→该篇报告成为一个标签。开下一篇再粘链接再拉取 → 第二个标签。getReports 返回的报告数组**只用于分支识别，不全变标签**。
- **状态独立**：每标签的报告链接、规则名、拉取结果（rules）、第二层展开、第三层审核缓存**完全独立**，切换不丢。

**持久化**：只存标签**元信息**（报告 `id`/`appkey`/`branch`/`branch_alia`/链接），重启恢复空标签列表，点标签重新拉取。**不持久化** rules 全量 + 审核结果（量大、且审核结果定位是临时）。

**store 改造**：checkerStore 从"全局一份 rules"改成"按 reportId 键控的多份"。

**项目颜色分组（2026-08 grilling 补充）**：
- **目标**：多项目多报告时，报告标签的"归属哪个项目"一眼可辨（单行标签，靠项目前缀 + 项目色双重标识归属）。
- **方案 A：报告标签带项目前缀 + 项目色分组**。
- **项目色分配**：**首见顺序**分配固定 8 色序，超 8 个循环用灰。同一会话内某项目恒同色（第一个打开的项目=色1…），跨会话不强制固定某项目=某色。
- **双主题色板（2026-08 改稿）**：同一 8 色序按主题分两套，保证 dark/light 下都清晰：
  - **dark（深石墨底，亮显）**：电石绿 `#c8e663`、天青 `#6ab7c6`、琥珀橙 `#e8a33d`、玫瑰红 `#e07a7a`、淡紫 `#9a8ecf`、青绿 `#5fbf9a`、钢蓝 `#7a9bbf`、灰 `#9aa3aa`。
  - **light（浅底，加深至对比度 ≥4.5:1）**：电石绿 `#4a7d1f`、天青 `#1e7a8a`、琥珀橙 `#a05f00`、玫瑰红 `#a83232`、淡紫 `#5b4da3`、青绿 `#1f7a5c`、钢蓝 `#34567a`、灰 `#5a636b`。
  - 实现：`projectColor()` 读 `<html data-theme>` 选色板（`checkerStore.PROJECT_COLORS` / `PROJECT_COLORS_LIGHT`）；light 模式无法单色板复用（浅底上原暗饱和色文字对比度不足）。
- **颜色落在**：报告标签**边框 + 文字**用项目色，底色用该色 **12% 透明度**（同 `--accent-soft` 手法，不喧宾夺主）。
- **选中态**：选中标签 = **项目色实底**，文字色按主题（dark=深石墨 `#0e1113`，light=白 `#ffffff`），替换现统一电石绿实底。
- **标签文字顺序**：`JX3 · #9322 (发布分支)`——项目前缀 + 报告 ID + 分支别名（三者都保留）。

### 12.3 审核前 svn update 到最新

**目标**：每次审核，在读取本地配置表前先把配置表更到最新，避免用旧表核。

**链路**：点【审核结果】→ 后端在审核起点先 `svn update` 被核那张表 → 再起 Claude。update 作为一条 SSE `step` 事件推前端（"正在更新本地表"）。

**范围**：只更新被核那张表（单文件 `svn update <abspath>`）。不进 Claude 工具集（update 是硬前置，不该由 Claude 决策是否调）。

**失败处理（软降级+提示）**：
- E155007（非工作副本）→ 静默跳过（本地手改表不该 update）。
- 其他失败（网络/认证 E215004/E175013/锁）→ 提示但不阻断，审核用本地当前版本，结果带 update 状态信息。
- 实现细节：单文件 update 对"已版本控制文件"可行；表是新建未提交（E155010）时降级尝试父目录 update。

**svn.py 新增**：`svn_update(path)`（复用现有 `asyncio.subprocess` + `--non-interactive` 模式）。

---

## 13. 增量决策清单（备查，2026-08）

| # | 决策点 | 结论 |
|---|---|---|
| 29 | getReports 入参/返回 | `{projectId, start_time, end_time}` → 数组含 `id/project_id/branch/branch_alia/version/error_count` |
| 30 | 分支映射 | 平台 `branch` 与 config `appkeyRoots.branch` 格式一致，无需映射层 |
| 31 | 分支识别时机 | 拉取报告时顺带调 getReports，按 reportId 匹配取 branch |
| 32 | 时间范围 | 今天-7天 ~ 今天（够用，不回看超 7 天历史） |
| 33 | 匹配不到降级 | 回退手填默认分支（get_appkey_root(appkey,"")），软降级+提示，审核照跑 |
| 34 | 分支显示 | 报告标签/详情显示 branch_alia；错了可在设置纠正 |
| 35 | 标签来源 | 粘链接逐个成为标签；getReports 数组不全变标签 |
| 36 | 标签形态 | **单行报告标签**（去掉两级导航/项目统计行）；报告归属靠标签项目前缀 + 项目色双重标识 |
| 37 | 标签状态 | 各标签 rules/展开/审核缓存完全独立 |
| 38 | 标签持久化 | 只存元信息，重启恢复空标签列表，点标签重拉 |
| 39 | svn update 时机 | 后端审核起点做，不进 Claude 工具集，SSE step 事件展示 |
| 40 | svn update 范围 | 只更新被核那张表（单文件）；新建未提交降级父目录 |
| 41 | svn update 失败 | E155007 静默跳过；其他软降级+提示不阻断 |
| 42 | 项目颜色分组 | 报告标签带项目前缀（`JX3 · #9322 (发布分支)`）；项目色=首见顺序分配 8 色序超 8 循环灰；边框+文字用项目色、底色 12% 透明；选中态=项目色实底。**双主题色板**：dark 用暗饱和色，light 用加深色（`PROJECT_COLORS_LIGHT`），按 `<html data-theme>` 切换；选中文字 dark=深字、light=白字 |

---

## 14. 增量验收标准（每条可机器判定）

### 分支识别
- [ ] 拉取报告 → 后端调 getReports → 按 reportId 匹配 → 前端显示该报告 branch_alia。
- [ ] getReports 调用失败或匹配不到 → 回退默认分支 + 提示，审核照跑。
- [ ] 分支识别结果在标签/详情可见，设置里可纠正。

### 多报告标签页
- [ ] 单行报告标签，点标签切换该报告结果。
- [ ] 粘链接拉取 → 该报告成为一个标签；多个标签状态独立，切换不丢。
- [ ] 重启应用 → 恢复标签列表（元信息），点标签重新拉取。
- [ ] 报告标签显示项目前缀（`JX3 · #9322`）+ 分支别名；同项目标签同色、不同项目不同色（首见顺序 8 色）；选中标签 = 该项目色实底（dark=深字、light=白字）。
- [ ] dark 与 light 双主题下项目标签文字/边框对比度均达标（light 用加深色板），切换主题标签清晰可辨。

### svn update
- [ ] 点审核 → 后端先 svn update 被核表，SSE 推"正在更新本地表"step 事件。
- [ ] 非工作副本表 → 跳过 update 不报错。
- [ ] 其他 update 失败 → 审核照跑 + 提示，结果带 update 状态。
