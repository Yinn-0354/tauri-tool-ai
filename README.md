# tauri-tool-ai

面向内部同事的 **Windows 桌面效率工具箱**，基于 **Tauri 2 + React 前端 + Python FastAPI Sidecar** 架构。

应用名（`tauri.conf.json` productName）：**配置表检查工具**。最终目标是把游戏配置表的查看、SVN 追溯与 AI 规则检查做成统一桌面工具；当前已落地底层的数据查看与版本追溯能力，AI 检查为后续模块。

## 当前功能

| 模块 | 状态 | 说明 |
|------|------|------|
| 表格查看器 | ✅ 已实现 | AG Grid 百万行虚拟渲染，支持 `.xlsx/.xls/.tab/.txt/.tsv` |
| SVN Blame | ✅ 已实现（表格查看器内子功能） | 行级 blame + 作者着色 + 提交详情（svn log） |
| 配置检查器 | ⏳ 占位未实现 | 侧边栏第二个图标，置灰"敬请期待" |
| AI Agent 对话面板 | ⏳ 未实现 | 后端 `mcp` 依赖已预留，前端与端点均未实现 |

### 表格查看器（`src/grid/`）
- **百万行虚拟渲染**：AG Grid `infinite row model`，按需向 sidecar 取页，DOM 只渲染可视区。
- **解析与缓存**：后端 polars 解析，首次解析后落盘 Parquet 缓存（`%LOCALAPPDATA%/tauri-tool-ai/cache/<tableId>.parquet`），`tableId = sha1(path|mtime|size)`，文件 mtime/size 一致即 `scan_parquet`（mmap）命中。
  - `.xlsx/.xls` → `pl.read_excel(engine="calamine")`（fastexcel 路径）
  - `.tab/.txt/.tsv` → `polars read_csv(separator="\t")`，utf8-lossy + 编码重探测
- **排序**：后端 sort + 列级排序索引缓存，前端列头点击排序。
- **表头行 / 跳过行**：打开文件时可指定，配置记忆到 `table-config.json`，下次打开自动预填。
- **全表查找**：高亮所有匹配并跳转。
- **右键菜单**：复制单元格、冻结至此行 / 至此列 / 行此列；冻结样式；列宽自适应。
- **导出**：CSV（ag-Grid CsvExportModule）。

### SVN Blame（`src/grid/blame.ts` + `python-backend/vcs/svn.py`）
- 工具栏"获取 Blame"按钮可开关，blame 信息渲染到表格行首 gutter。
- `svn blame`（默认 BASE 版本）取行元信息，作者稳定着色（同一作者同一颜色）。
- 点击 blame 行 → `CommitInfoModal` 展示 `svn log` 提交详情。
- 仅支持 SVN；Git blame 未实现。

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面壳 | Tauri 2（Rust） | `tauri` 2 + `tauri-plugin-dialog/fs/log` 2 |
| 前端框架 | React + TypeScript | React 19，TS ~5.7 |
| 构建 | Vite | 6 |
| 表格 | AG Grid Community | 32（client-side / infinite-row-model / csv-export / styles / react） |
| UI 组件 | Ant Design | 6（暗色主题，Carbon Terminal 配色） |
| 图标 | @ant-design/icons | 6 |
| 状态管理 | Zustand | 5 |
| HTTP | axios / fetch | axios 1 |
| Tauri API | @tauri-apps/api、plugin-dialog | 2 |
| 后端 | Python FastAPI + uvicorn | fastapi ≥0.137，uvicorn[standard] ≥0.49 |
| 数据层 | polars + fastexcel/calamine | polars ≥1.0，fastexcel ≥0.7，python-calamine ≥0.8 |
| 编码探测 | chardet / charset-normalizer | — |
| 写 Excel | xlsxwriter | ≥3.0 |
| 预留 | mcp | ≥1.0（AI 模块未实现） |
| 字体 | IBM Plex Sans / Mono | @fontsource |

## 架构

```
Tauri 桌面壳 (Rust, src-tauri/src/lib.rs)
├── 启动 Python sidecar：`python main.py`（CREATE_NO_WINDOW，无控制台窗口）
├── 端口发现：轮询 %TEMP%/tauri-tool-ai-port.txt（200ms × 75 = 15s 上限）
│   读到端口后探活（TcpStream connect），防上次残留旧端口
├── 日志：sidecar stdout/stderr 重定向到 %LOCALAPPDATA%/tauri-tool-ai/logs/backend.log
├── 退出：taskkill /F /T /PID 杀 sidecar 进程树（防 uvicorn 子进程残留）
├── Tauri commands：get_backend_url、get_backend_log
└── 插件：dialog、fs、log
        │
        ▼ invoke("get_backend_url")
React 前端 (WebView, src/)
├── App.tsx：invoke 拿后端地址 → openDialog 选文件 → /api/table/config 预填
│   → OpenConfigModal → POST /api/table/open + /api/table/config
├── AG Grid 表格（src/grid/TableView.tsx + datasource.ts 按需取页）
├── Ant Design 暗色壳（Sidebar/Toolbar/Modal）
└── Zustand 状态（src/store/tableStore、navStore）
        │
        ▼ HTTP (fetch / axios)
Python FastAPI Sidecar (python-backend/main.py，随机端口)
├── /api/health
├── /api/table/open      打开表 → polars 解析 + Parquet 缓存 + 返回 schema/rowCount
├── /api/table/data      按需取行（lazy scan + sort + slice）
├── /api/table/config    GET/POST 表头/跳过行记忆
├── /api/table/search    全表搜索
├── /api/vcs/blame       svn blame（BASE）
├── /api/vcs/blame/clear
└── /api/vcs/log        svn log 提交详情
```

**关键决策**：
- **Sidecar 而非嵌入**：Python 作为独立 FastAPI 进程，通过 HTTP 与前端/Rust 通信；桌面壳只负责进程生命周期与端口发现，业务全在 Python + React。
- **AG Grid 虚拟渲染**：百万行级表格用 `infinite row model`，前端 DOM 只持可视页，后端按 `tableId` 切片返回，Parquet 缓存让二次打开近乎零解析。
- **Parquet 缓存键**：`sha1(path|mtime|size)`，文件未改动直接 mmap 命中，改动则重新解析，无需主动失效。

## 目录结构

```
tauri-tool-ai/
├── src-tauri/                  Rust 桌面壳
│   ├── Cargo.toml
│   ├── tauri.conf.json          productName=配置表检查工具, 1400×900, CSP=null
│   └── src/{lib.rs, main.rs}    sidecar 启动/端口发现/日志/退出清理
├── python-backend/             FastAPI sidecar
│   ├── main.py                 端口写入 + 路由
│   ├── table_io.py             polars 解析 + Parquet 缓存 + 取行
│   ├── table_config.py         表头/跳过行记忆 (table-config.json)
│   ├── probe.py
│   ├── requirements.txt
│   └── vcs/{__init__.py, svn.py}   svn blame / log
├── src/                        React 前端
│   ├── App.tsx                 入口：拿后端地址 + 打开表流程
│   ├── main.tsx, agGridSetup.ts, fonts.ts, theme.css, vite-env.d.ts
│   ├── grid/                   AG Grid 表格 + blame
│   │   ├── TableView.tsx       表格主体（loadBlame/exportCsv/search/jumpTo）
│   │   ├── datasource.ts       infinite row model 取页
│   │   └── blame.ts           svn blame 取数 + 作者着色
│   ├── components/             Sidebar / Toolbar / EmptyState / OpenConfigModal / CommitDetailModal
│   └── store/                  tableStore / navStore（Zustand）
├── package.json, vite.config.ts, tsconfig*.json, index.html
└── .gitignore
```

## 开发与构建

```bash
# 开发（推荐）：自动启动桌面窗口 + 前端 + Python sidecar
cargo tauri dev

# 仅前端开发（不启动桌面窗口，后端需手动起）
npm run dev

# 构建
npm run build        # 前端
cargo tauri build    # 桌面安装包

# 单独跑 Python 后端（通常由 cargo tauri dev 自动启动）
cd python-backend && pip install -r requirements.txt && python main.py
```

`cargo tauri dev` 会先执行 `beforeDevCommand`（`npm run dev`）起 Vite，再编译 Rust 启动桌面应用；Rust `setup` 阶段启动 Python sidecar 并轮询端口文件，就绪后通过 `get_backend_url` 传给前端。支持热重载（前端/后端代码改动自动刷新，Rust 改动自动重编译）。

## 开发进度与计划

项目经历过一次架构重构：初版（Ant Design Table + pandas + 分页 + `src/modules/` 分页架构）在 `a9fa006` 后被**孤儿分支重置**（`f599b58`），自 `592885a` 起以 AG Grid + polars 重新实现，当前 HEAD 为 `466c3d1`。

### 已完成阶段
1. **脚手架**：Tauri 2 壳 + Python FastAPI sidecar 最小闭环（`592885a`）
2. **大表解析**：polars 解析 + Parquet 缓存 + AG Grid 百万行虚拟渲染（`42c59e1`，`ffc0294` 修复）
3. **Blame 可开关** + sidecar 日志接文件（`2f3f05f`）
4. **Carbon Terminal 配色重做** + svn log 提交详情（`e505d0e`）
5. **后端排序** + 列级排序索引缓存 + 前端列头排序（`d5aa588`）
6. **表头/跳过行指定 + 记忆** + 全表查找高亮跳转（`041266c`）
7. **右键菜单**（复制/冻结至此行/列/行此列）+ 冻结样式 + 列宽自适应（`466c3d1`）

### 后续计划（未实现）
- **配置检查器模块**：侧边栏已占位（`src/components/Sidebar.tsx` 第二个图标），需实现 AI 规则检查主体；后端 `mcp` 依赖已预留。
- **AI Agent 对话面板**：旧规划中的第三个模块，前后端均未实现。
- **自动更新 / 系统托盘 / 多标签页容器**：早期规划提及，当前 Rust 层未集成 Tauri Updater、无托盘代码、侧边栏为单视图图标导航，均待后续按需引入。

> 注：项目无独立计划文档目录（早期 `docs/ecc/` 随旧架构一并丢弃）。进度以上述 git 提交历史与源码现状为准。
