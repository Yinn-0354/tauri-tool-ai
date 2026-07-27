# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

面向内部同事的 **Windows 桌面效率工具箱**，基于 **Tauri 2 + React 前端 + Python FastAPI Sidecar** 架构。

应用名（`tauri.conf.json` productName）：**配置表检查工具**。最终目标是把游戏配置表的查看、SVN 追溯与 AI 规则检查做成统一桌面工具。

**当前实际模块**（以 `src/components/Sidebar.tsx` 为准）：
- **表格查看器**（`active="table"`，✅ 已实现）：AG Grid 百万行虚拟渲染，支持 `.xlsx/.xls/.tab/.txt/.tsv`；**SVN Blame 是其内置子功能**（工具栏按钮开关，非独立模块）。
- **配置检查器**（第二个图标，⏳ 占位未实现）：置灰 + tooltip"敬请期待"。
- **AI Agent 对话面板**：未实现（后端 `mcp` 依赖已预留，无对应前端组件与端点）。

> ⚠️ 架构历史：项目经历过一次重构。初版（Ant Design Table + pandas + 分页 + `src/modules/` / `src/api/` / `src/stores/` 架构）在 `a9fa006` 后被**孤儿分支重置**（`f599b58`），自 `592885a` 起以 **AG Grid + polars** 重新实现，旧代码与旧文档（含 `docs/ecc/` 计划目录）已全部丢弃。**当前 HEAD 为 `466c3d1`，一切以源码现状为准，勿引用已废弃的 `src/modules`、`src/api`、`src/stores` 路径或"三大模块/分页/Ant Design Table/自动更新/系统托盘"等旧描述。**

## 开发环境

| 工具 | 版本/要求 |
|------|-----------|
| Node | 22.22.1+ |
| Python | 3.11.1+ |
| Rust | 1.95.0 (MSVC 工具链)；`Cargo.toml` 下限 `rust-version = 1.77.2` |
| Tauri CLI | 2.11.1 |
| VS Build Tools | 2022 (提供 MSVC 链接器) |

- Rust 工具链：`stable-x86_64-pc-windows-msvc`
- MSVC 链接器由 VS Build Tools 2022 提供，不能使用 Git for Windows 自带的 GNU `link.exe`

## 技术架构

```
Tauri 桌面壳 (Rust, src-tauri/src/lib.rs)
├── 启动 Python sidecar：`python main.py`（CREATE_NO_WINDOW，无控制台窗口）
├── 端口发现：轮询 %TEMP%/tauri-tool-ai-port.txt（200ms × 75 = 15s 上限），读到端口后 TcpStream 探活防旧端口
├── 日志：sidecar stdout/stderr → %LOCALAPPDATA%/tauri-tool-ai/logs/backend.log
├── 退出：taskkill /F /T /PID 杀进程树（防 uvicorn 子进程残留）
├── Tauri commands：get_backend_url、get_backend_log
└── 插件：dialog、fs、log
        │ invoke("get_backend_url")
        ▼
React 前端 (WebView, Vite + TypeScript, src/)
├── AG Grid 32（infinite row model 百万行虚拟渲染）做表格
├── Ant Design 6（暗色，Carbon Terminal 配色 #c8e663/#0e1113）做壳 UI（非表格）
├── Zustand 5 状态（src/store/tableStore、navStore）
└── HTTP：axios / fetch → Python API
        │
        ▼
Python FastAPI Sidecar (python-backend/main.py，随机端口写文件)
├── /api/health
├── /api/table/{open,data,config,search}     表格（polars + Parquet 缓存）
└── /api/vcs/{blame,blame/clear,log}          SVN blame / log
```

### 端点契约
- `POST /api/table/open` `{path, headerRow?, skipRows?}` → `{tableId, rowCount, columns}`，落 Parquet 缓存
- `GET /api/table/data`（按 tableId 切片取行，含 sort）
- `GET/POST /api/table/config` 表头/跳过行记忆（`table-config.json`）
- `POST /api/table/search` 全表搜索
- `POST /api/vcs/blame` `{sourceId}` svn blame（BASE）
- `POST /api/vcs/log` svn log 提交详情
- 无 AI/SSE 端点（AI 模块未实现）

### 关键文件
- `python-backend/table_io.py`：polars 解析 + Parquet 缓存（`tableId=sha1(path|mtime|size)`，缓存 `%LOCALAPPDATA%/tauri-tool-ai/cache/<tableId>.parquet`，mtime/size 一致即 mmap `scan_parquet` 命中）
- `python-backend/table_config.py`：表头/跳过行记忆
- `python-backend/vcs/svn.py`：svn blame / log
- `src/grid/TableView.tsx`：AG Grid 表格主体，对外暴露 `loadBlame / exportCsv / search / jumpTo`（`TableViewHandle`）
- `src/grid/datasource.ts`：infinite row model 按需取页
- `src/grid/blame.ts`：svn blame 取数 + 作者稳定着色
- `src/components/`：Sidebar / Toolbar / EmptyState / OpenConfigModal / CommitDetailModal
- `src/store/{tableStore,navStore}.ts`：Zustand 状态
- `src/App.tsx`：入口，invoke 后端地址 + 打开表流程（openDialog → 预填 config → OpenConfigModal → open + config）

## 常用命令

```bash
# 开发（推荐，自动启动桌面窗口 + 前端 + Python 后端）
cargo tauri dev

# 仅前端开发（不启动桌面窗口）
npm run dev

# 构建
npm run build        # 前端
cargo tauri build    # 桌面安装包

# Python 后端（通常由 cargo tauri dev 自动启动）
cd python-backend && pip install -r requirements.txt && python main.py

# 验证
cargo tauri --version
```

### 开发环境说明
- **推荐 `cargo tauri dev`**：先跑 `beforeDevCommand`（`npm run dev`）起 Vite，再编译 Rust 启动桌面应用；Rust `setup` 启动 sidecar 并轮询端口文件，就绪后 `get_backend_url` 传给前端。
- 支持热重载：前端/后端改动自动刷新，Rust 改动自动重编译。
- sidecar 日志在 `%LOCALAPPDATA%/tauri-tool-ai/logs/backend.log`（前端可通过 `get_backend_log` 命令取尾部）。

## 关键架构决策

- **Sidecar 而非嵌入**：Python 作为独立 FastAPI 进程，通过 HTTP 与前端/Rust 通信。桌面壳只管进程生命周期与端口发现，业务全在 Python + React。
- **端口发现**：Python 启动后写 `%TEMP%/tauri-tool-ai-port.txt`，Rust 轮询读取并探活端口，通过 Tauri command 传给前端。
- **AG Grid 虚拟渲染**：百万行级表格用 `infinite row model`，前端 DOM 只持可视页，后端按 `tableId` 切片返回；Parquet 缓存让二次打开近乎零解析。
- **Parquet 缓存键**：`sha1(path|mtime|size)`，文件未改动直接 mmap 命中，改动自动重解析，无需主动失效。
- **无自动更新 / 无系统托盘 / 无多标签页**：Rust 层未集成 Tauri Updater、无托盘代码，侧边栏为单视图图标导航（非多标签页容器）。这些是早期规划项，按需再引入。

## 目录结构

```
tauri-tool-ai/
├── src-tauri/                  Rust 桌面壳
│   ├── Cargo.toml              依赖 tauri 2 + plugin-dialog/fs/log
│   ├── tauri.conf.json         productName=配置表检查工具, 1400×900, CSP=null
│   └── src/{lib.rs, main.rs}   sidecar 启动/端口发现/日志/退出清理
├── python-backend/             FastAPI sidecar
│   ├── main.py                端口写入 + 路由
│   ├── table_io.py             polars 解析 + Parquet 缓存 + 取行
│   ├── table_config.py        表头/跳过行记忆
│   ├── probe.py
│   ├── requirements.txt
│   └── vcs/{__init__.py, svn.py}
├── src/                        React 前端
│   ├── App.tsx                入口
│   ├── main.tsx, agGridSetup.ts, fonts.ts, theme.css, vite-env.d.ts
│   ├── grid/                  AG Grid 表格 + blame（TableView/datasource/blame）
│   ├── components/             Sidebar / Toolbar / EmptyState / OpenConfigModal / CommitDetailModal
│   └── store/                  tableStore / navStore（Zustand）
├── package.json, vite.config.ts, tsconfig*.json, index.html
└── .gitignore
```

## 项目状态

表格查看器主线功能已较完善（百万行虚拟渲染、Parquet 缓存、后端排序、表头/跳过行记忆、全表查找高亮跳转、右键菜单冻结、列宽自适应、CSV 导出、SVN blame 可开关 + 提交详情）。

近期提交（`git log`）：
- `466c3d1` 右键菜单（复制/冻结至此行/列/行此列）+ 冻结样式 + 列宽自适应
- `041266c` 表头行/跳过行指定 + 记忆 + 全表查找高亮跳转
- `d5aa588` 后端 sort + 列级排序索引缓存，前端列头排序
- `e505d0e` 前端 Carbon Terminal 重做 + svn log 提交详情
- `42c59e1` polars 大表解析 + Parquet 缓存 + ag-Grid 百万行虚拟渲染

## 已知待办

- [ ] **配置检查器模块**：侧边栏已占位（`src/components/Sidebar.tsx`），需实现 AI 规则检查主体；后端 `mcp` 依赖已预留。
- [ ] **AI Agent 对话面板**：前后端均未实现，需新增 SSE 流式端点与前端对话组件。
- [ ] **Git blame**：`vcs/` 当前仅 SVN，Git 未实现。
- [ ] 自动更新 / 系统托盘 / 多标签页容器：早期规划项，按需引入。
