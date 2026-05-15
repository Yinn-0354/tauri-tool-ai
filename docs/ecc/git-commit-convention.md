# Git 提交信息规范

本项目采用 **中文 Conventional Commits** 格式。

## 格式

```
<type>(<scope>): <中文简短描述>

<中文详细说明（可选，多行）>
```

## Type

| Type | 用途 |
|------|------|
| `feat` | 新功能模块 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `build` | 项目脚手架、构建配置、依赖变更 |
| `refactor` | 代码重构（不改变功能） |
| `chore` | 杂项维护（CI、工具配置等） |
| `style` | 格式调整（空格、缩进等，不影响逻辑） |
| `test` | 测试相关变更 |

## Scope

| Scope | 对应内容 |
|-------|---------|
| `tauri` | `src-tauri/` Rust 代码 |
| `frontend` | `src/` React/TypeScript/Vite 代码 |
| `python` | `python-backend/` FastAPI 代码 |
| `docs` | 设计/计划/文档 |
| 省略 | 跨层变更（多 scope 一起改） |

## 示例

```
feat(frontend): 实现表格查看器数据源面板

- 添加文件、WPS、数据库三种数据源类型
- 支持最近打开列表 (localStorage)
- 数据源右键菜单操作

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

```
build: 搭建 Tauri + React + Python FastAPI 项目脚手架

- 初始化前端骨架
- 配置 Tauri 2 窗口
- 创建 Python 后端
```

```
fix(python): 处理 Excel 文件编码错误导致崩溃的问题
```

## 版本标签（强制）

**每次提交必须附带 `git tag`，CI/CD 流水线依赖 tag 触发构建。**
未打 tag 的提交不得推送到远程仓库。

版本号遵循 **语义化版本** (`v<主>.<次>.<修订>`)：

| Phase | 版本号 | 说明 |
|-------|--------|------|
| Phase 0 | — | 环境准备，无可提交代码 |
| Phase 1 | `v0.1.0` | 项目脚手架搭建 |
| Phase 2 | `v0.2.0` | 前端基础框架 |
| Phase 3 | `v0.3.0` | 表格查看器 |
| Phase 4 | `v0.4.0` | Blame 查看器 |
| Phase 5 | `v0.5.0` | 自动更新 |
| Phase 6 | `v0.6.0` | AI Agent |
| 修订 | `v0.X.1+` | Bug 修复或小改动 |

```bash
git tag -a "v0.1.0" -m "Phase 1: 项目脚手架搭建完成"
git push origin v0.1.0
```

## 构建环境（提交信息尾注）

提交信息末尾附带当前构建所用工具版本号：

```
---
Env: Node 22.22.1 | Rust 1.95.0 | Tauri CLI 2.11.1 | Python 3.11.1
```

## 完整提交示例

```
feat(frontend): 实现表格查看器数据源面板

- 添加文件、WPS、数据库三种数据源类型
- 支持最近打开列表 (localStorage)
- 数据源右键菜单操作

---
Env: Node 22.22.1 | Rust 1.95.0 | Tauri CLI 2.11.1 | Python 3.11.1

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

## 说明

- **标题**用中文，简洁描述本次变更的核心内容
- **Type 和 Scope** 保持英文，兼容 Conventional Commits 工具链
- **详细说明**用中文，列出关键变更点
- **Env 行**记录构建工具版本，方便回溯构建环境
- 签名行 `Co-Authored-By` 由工具自动追加
