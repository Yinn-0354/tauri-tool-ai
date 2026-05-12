# Tauri Tool AI — 设计文档

## 概述

面向公司内部同事的桌面效率工具箱，基于 Tauri 构建。集成表格数据展示、版本控制 Blame 可视化、AI Agent 对话等功能模块。

- **平台:** Windows
- **分发:** 自动更新（Tauri Updater + GitLab CI）
- **架构:** Tauri 壳 + React 前端 + Python FastAPI Sidecar

## 整体架构

```
┌──────────────────────────────────────────────────┐
│ Tauri 桌面壳                                       │
│  ┌─────────────────────┐  ┌─────────────────────┐│
│  │ React 前端 (WebView) │  │ Python FastAPI       ││
│  │ · Ant Design 6       │◀─▶│ · 数据读取 (多格式)  ││
│  │ · Zustand 状态管理    │HTTP│ · WPS API 集成      ││
│  │ · 表格/卡片/模板视图  │  │ · SVN/Git 操作      ││
│  │ · Blame 可视化       │  │ · AI API 代理       ││
│  └─────────────────────┘  └─────────────────────┘│
│                                 Tauri Rust 层      │
│                                 · 自动更新         │
│                                 · 系统托盘/窗口    │
└──────────────────────────────────────────────────┘
```

- **Tauri Rust 层:** 窗口管理、自动更新检查、系统级操作
- **React 前端:** 全部 UI 交互
- **Python FastAPI Sidecar:** 数据处理、外部 API 调用、SVN/Git 操作

## 通信方式

Python 以 Sidecar 方式启动，运行 FastAPI 服务在 `127.0.0.1` 随机端口。

- 前端 → Python: HTTP 请求 (fetch)
- Rust → Python: HTTP 请求 (reqwest)
- 支持 SSE 流式响应（AI 对话场景）
- 端口在启动时写入临时文件，Rust 读取后再传给前端

## 前端技术栈

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | UI 框架 |
| Ant Design 6 | 组件库（Table 等中后台组件） |
| Zustand | 轻量状态管理 |
| React Router | 路由 |
| Vite | 构建工具 |

### 大表格性能说明

预见到 Ant Design Table 在几万行 × 数百列场景下可能遇到性能瓶颈。先使用标准 Table 组件，后续如遇问题再引入虚拟滚动方案（如 react-window + 自定义渲染）。

## 应用布局

侧边栏导航 + 多标签页模式：

```
┌──────────┬──────────────────────────────────────┐
│ 模块导航  │ [📊 技能表.xlsx] [📝 Blame: config] [+] │
│          ├──────────────────────────────────────│
│ 📊 表格   │                                      │
│ 📝 Blame │         内容区域                       │
│ 🤖 AI    │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

- 左侧固定侧边栏：模块菜单
- 右侧多标签页：可同时打开多个视图
- 各模块可在标签内独立操作

## 功能模块

### 模块 1: 表格查看器

**布局:** 双区（左侧数据源 + 右侧数据视图）

**数据源支持:**
- 本地 Excel (.xlsx/.xls)
- 本地 CSV
- WPS 在线表格（通过 Python 调用 WPS API）
- 数据库表（MySQL/SQLite）

**视图模式切换:**
- 表格模式：可排序、可筛选列
- 卡片模式：按指定列分组展示
- 模板模式：自定义行渲染模板

**数据源面板:**
- 显示最近打开的文件/连接
- 支持添加、移除、刷新数据源
- 区分本地文件、远程 API、数据库连接

**版本跟踪集成:**
- 打开的文件如果是版本控制文件（SVN/Git），可开启 Blame 开关
- 开启后每行数据显示版本信息注释

### 模块 2: Blame 查看器

**独立模块:**
- 顶部：选择 VCS 类型（SVN/Git），输入文件路径或仓库 URL
- 主体：标准 Blame 视图，三栏布局

**Blame 视图布局:**
```
┌────────┬──────────────┬─────────────────────────┐
│ 版本号  │ 作者 · 时间   │ 文件内容（最新版本）      │
├────────┼──────────────┼─────────────────────────┤
│ r4521  │ 王五 · 11-20 │ local MAX_PLAYERS = 100 │
│ r4015  │ 李四 · 08-03 │ local DEFAULT_LEVEL = 1 │
│ r1002  │ 张三 · 2023  │ end                     │
└────────┴──────────────┴─────────────────────────┘
```

- 同一提交的连续行使用相同底色分组
- 鼠标悬停行显示完整提交信息（commit message）
- 支撑 SVN 和 Git 两种 VCS

**与表格查看器的关联:**
- 表格查看器中打开版本跟踪文件时，视图切换标签增加「Blame」选项卡
- 表格的每行可对应 Blame 版本信息（如果文件格式支持行映射）

### 模块 3: AI Agent（待定）

设计方向已讨论，待表格和 Blame 模块完成后细化：
- 独立 AI 对话面板
- 多 AI 接口切换（OpenAI / Anthropic / 内部接口）
- 从表格选中数据发送给 AI 分析
- 数据上下文区展示当前附带的数据片段
- 流式响应支持

## 自动更新

```
Git Push (main) → GitLab CI 构建 → 生成更新包 + JSON 清单
                                        ↓
                                   内部文件服务器
                                        ↓
                              客户端启动时检查 → 自动下载安装
```

- 使用 Tauri 内置 updater 插件
- GitLab CI 在每次 main 分支 push 后触发
- 构建 Windows 安装包 (.msi) + 更新清单 (JSON)
- 上传到内部文件服务器供客户端拉取
- 签名密钥用于验证更新包完整性

## 项目目录结构（规划）

```
tauri-tool-ai/
├── src/                    # React 前端
│   ├── components/         # 通用组件
│   ├── modules/            # 功能模块
│   │   ├── table-viewer/   # 表格查看器
│   │   ├── blame-viewer/   # Blame 查看器
│   │   └── ai-agent/       # AI Agent（待实现）
│   ├── stores/             # Zustand stores
│   ├── layouts/            # 布局组件
│   └── api/                # 前端 API 调用层
├── src-tauri/              # Tauri Rust 代码
│   ├── src/
│   │   └── main.rs         # 窗口管理、updater、Python 进程管理
│   └── Cargo.toml
├── python-backend/         # Python FastAPI Sidecar
│   ├── main.py             # FastAPI 入口
│   ├── readers/            # 数据源读取（Excel/CSV/WPS/DB）
│   ├── vcs/                # SVN/Git 操作
│   └── ai/                 # AI API 代理
├── package.json
├── vite.config.ts
└── README.md
```

## 技术决策记录

| 决策 | 选项 | 理由 |
|------|------|------|
| 架构 | Tauri + Python Sidecar | 复用现有 Python 代码和能力 |
| 通信 | HTTP (FastAPI) | 支持流式响应，前后端都可调用 |
| 前端框架 | React + Ant Design 6 | 中后台场景成熟，用户有 Vue 版经验 |
| 状态管理 | Zustand | 极简，无样板代码 |
| 自动更新 | Tauri Updater + GitLab CI | 内置方案，成熟稳定 |
| 模块布局 | 侧边栏 + 多标签 | 多任务并行，类 VS Code 体验 |
