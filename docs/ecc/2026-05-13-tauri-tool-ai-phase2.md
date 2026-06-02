# Tauri Tool AI — Phase 2 实现细节

**日期:** 2026-05-13
**状态:** 已完成

## 概述

Phase 2 完成了前端基础框架搭建：基于 Ant Design Layout 的侧边栏 + 多标签页布局、React Router 路由系统、Zustand 状态管理、Axios API 层、通用 UI 组件。

---

## 2.1 新增文件

```
src/
├── App.tsx                      # 根组件 (路由 + ConfigProvider + ErrorBoundary)
├── App.css                      # 全局布局样式
├── main.tsx                     # React 入口 (未变)
│
├── layouts/
│   └── AppLayout.tsx            # 主布局 (Sider + Tabs + Outlet)
│
├── stores/
│   ├── appStore.ts              # 全局状态 (后端端口/连接)
│   ├── tabStore.ts              # 多标签页管理 (open/close/active)
│   ├── tableViewerStore.ts      # 表格查看器状态 (占位)
│   └── blameStore.ts            # Blame 状态 (占位)
│
├── api/
│   ├── client.ts                # Axios 实例 (动态 baseURL)
│   ├── table.ts                 # 表格 API (sources/load/data)
│   └── blame.ts                 # Blame API (fetchBlame)
│
├── components/
│   ├── Loading.tsx              # Spin 加载包装
│   ├── ErrorBoundary.tsx        # 错误边界 + 重试
│   └── Empty.tsx                # 空状态
│
└── modules/
    ├── table-viewer/index.tsx   # 表格查看器 (占位)
    ├── blame-viewer/index.tsx   # Blame 查看器 (占位)
    └── ai-agent/index.tsx       # AI Agent (占位)
```

---

## 2.2 布局架构

```
┌──────────────────────────────────────────────────────┐
│ Sider (200px, dark)         │ Content                │
│                              │ ┌─────────────────────┤
│  Tauri Tool AI               │ │ [📊 表格查看器] [x]  │
│                              │ │ [📝 Blame查看器] [x]│
│  ● 表格查看器                 │ ├─────────────────────┤
│  ● Blame 查看器              │ │                     │
│  ● AI Agent                  │ │   <Outlet />        │
│                              │ │   (模块内容区域)     │
│                              │ │                     │
└──────────────────────────────┴───────────────────────┘
```

- **Sider:** Ant Design Layout.Sider，深色主题，3 个菜单项点击导航
- **Tabs:** `editable-card` 类型，支持关闭标签
- **Outlet:** React Router v7 `<Outlet />` 渲染当前路由对应模块
- **Menu 选中态**与**Tab activeKey** 联动

---

## 2.3 路由设计

| 路径 | 组件 | 说明 |
|------|------|------|
| `/table-viewer` | `TableViewerModule` | 表格查看器 |
| `/blame-viewer` | `BlameViewerModule` | Blame 查看器 |
| `/ai-agent` | `AiAgentModule` | AI Agent |
| `*` | `Navigate → /table-viewer` | 默认重定向 |

---

## 2.4 状态管理 (Zustand)

### appStore — 全局状态
- `backendPort` / `backendUrl`: 后端地址，由 Rust 命令 `get_backend_url` 设置
- `isConnected`: 后端连接状态
- Phase 2 阶段 store 已定义，Phase 3+ 在组件中接入

### tabStore — 标签页管理
- `tabs[]`: 已打开的标签列表 (`{ key, label, closable }`)
- `activeKey`: 当前激活标签
- `openTab()`: 打开标签（已存在则直接激活）
- `closeTab()`: 关闭标签（自动切换相邻标签）
- `setActiveKey()`: 切换激活标签

### tableViewerStore / blameStore
- Phase 3/4 的功能状态占位，当前 API 已定义

---

## 2.5 API 层

### client.ts
- Axios 实例，超时 30 秒
- `setBaseUrl(url)` 动态设置 baseURL，由 appStore 驱动

### table.ts
- `fetchSources()` — GET /api/table/sources
- `loadTable(source, sheet?)` — POST /api/table/load
- `fetchData(tableId, page, pageSize)` — GET /api/table/data/:id

### blame.ts
- `fetchBlame(vcs, path)` — POST /api/vcs/blame

---

## 2.6 通用组件

| 组件 | 功能 |
|------|------|
| `Loading` | Ant Design Spin 居中包装 |
| `ErrorBoundary` | Class 组件错误捕获 + Result 错误页 + 重试按钮 |
| `Empty` | Ant Design Empty 封装 |

---

## 2.7 验证统计

| 检查项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | 通过 |
| `npx vite build` | 通过 (3065 modules, 645KB) |
| `cargo check` | 通过 |

---

## 2.8 关键决策

- **Ant Design ConfigProvider + zhCN**: 全局中文化
- **ErrorBoundary 包裹 BrowserRouter**: 路由级的错误也能捕获
- **react-router-dom v7 传统模式**: 使用 `BrowserRouter` + `Routes` API，未用 Remix 风格
- **Tabs 与路由双向绑定**: 点击 Menu → navigate → useEffect 打开/激活 Tab；点击 Tab → setActiveKey → navigate
- **Chunk size warning**: 645KB 未拆分，Phase 3+ 可配置 manualChunks

---

## 下一步: Phase 3

Phase 3 将实现表格查看器完整功能：Python 端多格式读取 API (Excel/CSV)、前端数据源面板、三种视图模式 (表格/卡片/模板)。
