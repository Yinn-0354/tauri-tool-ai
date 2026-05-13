# Tauri Tool AI — 实施计划

## Context

构建面向内部同事的 Windows 桌面效率工具箱，基于 Tauri + React + Python FastAPI Sidecar 架构。
这是全新项目（空仓库），需要从脚手架开始搭建。

### 当前环境

| 工具 | 状态 |
|------|------|
| Node v22.22.1 + npm 10.9.4 | 已就绪 |
| Python 3.11.1 + pip 22.3.1 | 已就绪 |
| Rust + Cargo | **未安装** |
| Tauri CLI | **未安装** |

## 实施阶段

### Phase 0: 环境准备

1. 安装 Rust: `winget install Rustlang.Rustup` 或访问 https://rustup.rs
2. 安装 Tauri CLI: `cargo install tauri-cli --version "^2"`
3. 验证: `cargo tauri --version`

### Phase 1: 项目脚手架搭建

**1.1 初始化 Tauri 项目**
```bash
npm create tauri-app@latest tauri-tool-ai -- --template react-ts --manager npm
```
使用 react-ts 模板，Vite 作为构建工具。

**1.2 安装前端依赖**
```bash
npm install antd@6 zustand react-router-dom axios @ant-design/icons
```

**1.3 配置 Vite**
- `vite.config.ts`: 路径别名 `@/` → `src/`
- 开发环境 Python backend 代理 → `http://127.0.0.1:8765`

**1.4 配置 Tauri**
- `tauri.conf.json`: 窗口标题 "Tauri Tool AI"、大小 1400x900
- 启用 updater 插件
- 配置 sidecar 声明（python-backend 二进制）

**1.5 Python FastAPI Sidecar 骨架**
```
python-backend/
├── main.py          # FastAPI 入口，随机端口，写入端口文件
├── readers/
│   ├── __init__.py
│   ├── excel.py     # openpyxl 读取
│   ├── csv.py       # csv 读取
│   └── db.py        # MySQL/SQLite (aiomysql/aiosqlite)
├── vcs/
│   ├── __init__.py
│   ├── svn.py       # svn blame --xml
│   └── git.py       # git blame --porcelain
├── ai/
│   ├── __init__.py
│   └── proxy.py     # AI API 代理 (openai/requests)
└── requirements.txt
```
- FastAPI 服务启动在 `127.0.0.1:0`（随机端口）
- 启动后将端口写入 `{TEMP}/tauri-tool-ai-port.txt`
- 提供 `/health` 端点供 Rust 健康检查

**1.6 Rust 进程管理 (src-tauri/src/main.rs)**
- 应用启动时 spawn Python sidecar 进程
- 轮询端口文件（最多等待 10 秒）
- 通过 Tauri command 暴露端口给前端
- 应用关闭时 kill sidecar 进程
- 窗口管理、系统托盘（可选）

### Phase 2: 前端基础框架

**2.1 布局组件** (`src/layouts/AppLayout.tsx`)
- 左侧: 固定宽度侧边栏（模块导航图标 + 文字）
- 右侧: 多标签页容器
- 使用 Ant Design Layout 组件

**2.2 路由** (`src/App.tsx`)
```
/               → 重定向到 /table-viewer
/table-viewer   → TableViewerModule
/blame-viewer   → BlameViewerModule
/ai-agent       → AiAgentModule (placeholder)
```

**2.3 Zustand Stores**
- `src/stores/appStore.ts` — 全局状态（端口号、连接状态）
- `src/stores/tabStore.ts` — 标签页管理（openTabs, activeTab）
- `src/stores/tableViewerStore.ts` — 表格查看器状态
- `src/stores/blameStore.ts` — Blame 状态

**2.4 API 层** (`src/api/`)
- `src/api/client.ts` — axios 实例，baseURL 从 appStore 获取
- `src/api/table.ts` — 数据源 API
- `src/api/blame.ts` — Blame API

**2.5 通用组件** (`src/components/`)
- `Loading.tsx` — Spin 包装
- `ErrorBoundary.tsx` — 错误边界
- `Empty.tsx` — 空状态

### Phase 3: 表格查看器

**3.1 Python 后端 API**
- `GET /api/table/sources` — 获取数据源列表
- `POST /api/table/load` — 加载数据 `{source: "file://path" | "wps://id" | "db://...", sheet?: "Sheet1"}`
- `GET /api/table/data/{id}` — 分页获取数据 `?page=1&pageSize=100&sort=col&order=asc`
- `POST /api/table/save-view` — 保存视图配置

**3.2 前端: 数据源面板** (`src/modules/table-viewer/SourcePanel.tsx`)
- 左侧面板，显示已添加的数据源列表
- "添加"按钮弹出 Modal，选择类型（本地文件/WPS/数据库）
- 最近打开列表（localStorage）
- 每个数据源支持：打开、刷新、移除

**3.3 前端: 表格视图** (`src/modules/table-viewer/TableView.tsx`)
- Ant Design Table，antd 6 的 Table 组件
- 列排序、列筛选（column filters）
- 分页（后端分页，pageSize 可调）
- 列宽拖拽调整

**3.4 前端: 卡片视图** (`src/modules/table-viewer/CardView.tsx`)
- 按指定列分组，Card 展示每组数据
- 可选择分组列

**3.5 前端: 模板模式** (`src/modules/table-viewer/TemplateView.tsx`)
- 第一版用简单的行模板字符串（占位符替换）
- 后续可扩展为自定义 JSX 模板

**3.6 视图模式切换**
- Segmented 组件切换表格/卡片/模板
- 切换时保持当前数据源

### Phase 4: Blame 查看器

**4.1 Python 后端: SVN Blame**
- `POST /api/vcs/blame` — `{vcs: "svn", path: "/repo/path/file.lua"}`
- 执行 `svn blame --xml` 解析 XML 输出
- 返回: `[{revision, author, date, line_number, content}]`

**4.2 Python 后端: Git Blame**
- `POST /api/vcs/blame` — `{vcs: "git", path: "/repo/path/file.go"}`
- 执行 `git blame --porcelain` 解析输出
- 返回格式同上

**4.3 前端: Blame 视图** (`src/modules/blame-viewer/BlameView.tsx`)
- 顶部: VCS 类型选择 (Radio: SVN/Git) + 文件路径输入框 + 查询按钮
- 主体: 三栏布局
  - 左栏 (80px): 版本号，mono 字体
  - 中栏 (180px): 作者 + 时间，小号字体
  - 右栏 (flex): 文件内容，等宽字体
- 同一版本的连续行使用相同底色（交替 2-3 种浅色）
- 鼠标悬停行 → Tooltip 显示完整 commit message

**4.4 与表格查看器关联**
- 表格查看器加载版本控制文件时，标签栏出现 "Blame" 子标签
- 切换到 Blame 子标签时，携带当前文件路径

### Phase 5: 自动更新

**5.1 Tauri Updater 配置**
```json
// tauri.conf.json
"updater": {
  "active": true,
  "endpoints": ["http://localhost:8080/update/{{target}}/{{current_version}}"],
  "pubkey": "<签名公钥>"
}
```

**5.2 本地更新服务器**
- Python 简单 HTTP 服务器 + 静态文件
- 目录结构:
  ```
  update-server/
  ├── update/
  │   └── x86_64-pc-windows-msvc/
  │       ├── 0.1.0.json    # 更新清单
  │       └── 0.1.0.msi     # 安装包
  ```
- JSON 清单格式: `{"version": "0.1.0", "notes": "...", "pub_date": "...", "url": "...", "signature": "..."}`

**5.3 GitLab CI** (`.gitlab-ci.yml`)
- main 分支 push 触发
- Stage 1: 构建 (cargo build --release + npm run build)
- Stage 2: 签名 + 打包 (.msi + .msi.zip)
- Stage 3: 生成更新清单 JSON
- Stage 4: 上传到文件服务器

### Phase 6: AI Agent（待 Phase 3+4 完成后再细化）

---

## 关键文件路径

### 前端
- `src/main.tsx` — React 入口
- `src/App.tsx` — 路由配置
- `src/layouts/AppLayout.tsx` — 主布局
- `src/stores/` — Zustand stores
- `src/api/client.ts` — API 客户端
- `src/modules/table-viewer/` — 表格查看器模块
- `src/modules/blame-viewer/` — Blame 模块
- `src/modules/ai-agent/` — AI Agent (占位)

### Rust
- `src-tauri/src/main.rs` — 进程管理 + Tauri commands
- `src-tauri/Cargo.toml` — 依赖
- `src-tauri/tauri.conf.json` — Tauri 配置

### Python
- `python-backend/main.py` — FastAPI 入口
- `python-backend/readers/` — 数据源读取
- `python-backend/vcs/` — SVN/Git 操作
- `python-backend/requirements.txt` — Python 依赖

---

## 验证

每个 Phase 完成后的验证方式:

1. **Phase 0**: `cargo tauri --version` 输出版本号
2. **Phase 1**: `cargo tauri dev` 启动成功，窗口显示 React 页面
3. **Phase 2**: 页面显示侧边栏 + 标签页布局，路由切换正常
4. **Phase 3**: 加载 Excel/CSV 文件，表格展示数据，三种视图可切换
5. **Phase 4**: 输入 SVN/Git 路径，显示 Blame 视图
6. **Phase 5**: 构建 .msi + 本地更新服务器响应更新检查
