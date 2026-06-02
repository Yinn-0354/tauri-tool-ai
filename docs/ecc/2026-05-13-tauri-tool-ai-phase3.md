# Tauri Tool AI — Phase 3 实现细节

**日期:** 2026-05-13
**状态:** 进行中

## 概述

Phase 3 实现了表格查看器完整功能：Python 端 Excel/CSV 读取 + 数据源 CRUD API，前端数据源面板（添加/删除/刷新）、三种视图模式（表格/卡片/模板）及相互切换。

---

## 3.1 Python 后端 API

### 新增端点 (5 个)

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/table/sources` | 获取全部数据源列表 |
| `POST` | `/api/table/sources` | 添加数据源 `{name, type, path}` |
| `DELETE` | `/api/table/sources/{id}` | 删除数据源 |
| `POST` | `/api/table/load` | 加载数据源 `{sourceId, sheet?}` |
| `GET` | `/api/table/data/{id}` | 分页查询 `?page&pageSize` |

### 新增文件

```
python-backend/
├── main.py               # 重写: 添加所有 API 路由 + 数据模型
├── readers/
│   ├── excel.py          # openpyxl 读取 Excel (单表/多表)
│   └── csv.py            # csv.reader 读取 CSV
└── sources.json          # 数据源持久化文件
```

### 数据流

```
[前端] → POST /api/table/sources → sources.json (持久化)
[前端] → POST /api/table/load → 文件读取 → loaded_tables (内存缓存)
[前端] → GET /api/table/data/{id} → 内存缓存 → 分页返回
```

### sources.json 格式

```json
[
  {
    "id": "08791dc1615d",
    "name": "技能表.xlsx",
    "type": "file",
    "path": "C:/Users/admin/Desktop/技能表.xlsx",
    "addedAt": "2026-05-13T16:00:00"
  }
]
```

---

## 3.2 前端数据源面板

### 文件

```
src/modules/table-viewer/
├── index.tsx              # 模块主入口 (双栏布局 + Segmented 切换)
├── SourcePanel.tsx         # 左侧面板: 数据源列表 + 添加/刷新/删除
├── AddSourceModal.tsx      # 添加数据源弹窗 (名称/类型/路径)
├── TableView.tsx           # 表格视图
├── CardView.tsx            # 卡片视图
├── TemplateView.tsx        # 模板视图
│
src/api/table.ts            # 更新: CRUD + load + fetchData
src/stores/tableViewerStore.ts  # 更新: viewMode + currentTable + template
```

### SourcePanel 功能

| 操作 | 说明 |
|------|------|
| 添加 | Modal 表单 → `POST /api/table/sources` → 列表刷新 |
| 删除 | 右侧删除按钮 → Popconfirm 确认 → `DELETE /api/table/sources/{id}` |
| 选中 | 点击数据源 → `POST /api/table/load` → 加载数据到右侧视图 |
| 刷新 | 工具栏刷新按钮 → 重新 `GET /api/table/sources` |

### 三种视图

| 视图 | 文件 | 功能 |
|------|------|------|
| 表格 | `TableView.tsx` | Ant Design Table, 列排序, 后端分页 (50/100/200/500 可选) |
| 卡片 | `CardView.tsx` | Select 选分组列, Card 分组展示, 每组最多 50 条预览 |
| 模板 | `TemplateView.tsx` | TextArea 输入模板, `{列名}` / `{*}` 占位符替换, 500 行渲染 |

### 视图切换

- Ant Design `Segmented` 组件: 表格 | 卡片 | 模板
- 切换时保持当前已加载数据 (currentTable 在 store 中)
- 顶部栏显示: 文件名 — N 行 M 列 + 刷新按钮

---

## 3.3 验证统计

| 检查项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | 通过 |
| `npx vite build` | 通过 (3126 modules, 1.1MB) |
| `cargo check` | 通过 |
| Python CRUD 测试 | 通过 (POST/GET/DELETE all OK) |

---

## 3.4 关键决策

- **数据源持久化**: JSON 文件 (sources.json) 而非 SQLite，Phase 1 保持简单
- **表格数据**: 内存缓存 (loaded_tables dict)，不落盘；应用重启后需重新加载
- **卡片视图**: 一次性拉取全部数据 (最多 5000 行)，因为需要全量分组
- **模板视图**: 纯字符串替换引擎，`{*}` 展开为所有列值
- **未实现**: WPS 在线表格读取、数据库连接 (Phase 3 先支持本地文件)

---

## 下一步: Phase 4

Phase 4 将实现 Blame 查看器: Python 端 SVN/Git blame 解析、前端三栏 Blame 视图、与表格查看器联动。
