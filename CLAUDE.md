# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

面向内部同事的 Windows 桌面效率工具箱，基于 **Tauri 2 + React 前端 + Python FastAPI Sidecar** 架构。

三大功能模块：表格查看器（Excel/CSV/WPS/DB）、Blame 查看器（SVN/Git）、AI Agent 对话面板。

## 开发环境

| 工具 | 版本/要求 |
|------|-----------|
| Node | 22.22.1+ |
| Python | 3.11.1+ |
| Rust | 1.95.0 (MSVC 工具链) |
| Tauri CLI | 2.11.1 |
| VS Build Tools | 2022 (提供 MSVC 链接器) |

- Rust 工具链: `stable-x86_64-pc-windows-msvc`
- MSVC 链接器由 VS Build Tools 2022 提供，不能使用 Git for Windows 自带的 GNU `link.exe`

## 技术架构

```
Tauri 桌面壳 (Rust)
├── React 前端 (WebView, Vite + TypeScript)
│   ├── Ant Design 6 (UI 组件)
│   ├── Zustand (状态管理)
│   └── Axios → Python HTTP API
├── Python FastAPI Sidecar (独立进程)
│   ├── 随机端口启动，端口号写入临时文件
│   └── Rust 读取端口后传给前端
└── Rust 层: 窗口管理、自动更新、系统托盘
```

## 常用命令（规划）

```bash
# 开发模式
npm run dev          # 或 cargo tauri dev

# 构建
npm run build        # 或 cargo tauri build

# Python 后端
cd python-backend && pip install -r requirements.txt && python main.py

# 验证
cargo tauri --version
```

## 关键架构决策

- **Sidecar 而非嵌入**: Python 作为独立 FastAPI 进程运行，通过 HTTP 与前端/Rust 通信，支持 SSE 流式响应（AI 对话场景）
- **端口发现**: Python 启动后写入 `{TEMP}/tauri-tool-ai-port.txt`，Rust 轮询读取后通过 Tauri command 传递给前端
- **多标签页布局**: 侧边栏模块导航 + 多标签页容器，类 VS Code 体验
- **大表格处理**: 先使用 Ant Design Table 标准组件，后续按需引入 react-window 虚拟滚动
- **自动更新**: Tauri Updater 插件 + GitLab CI 构建 `.msi` + 更新清单 JSON

## 已知待办

- [ ] Ant Design 6 的 `List` 组件已废弃，官方将用 `Listy` 组件替代，目前 `Listy` 仍在测试中未上线。等正式发布后替换 `SourcePanel.tsx` 中的 `List` 用法。

## 项目状态

项目处于 **Phase 3 进行中**（表格查看器功能完善中）。Phase 1 实现细节见 `docs/ecc/2026-05-13-tauri-tool-ai-phase1.md`，Phase 2 见 `docs/ecc/2026-05-13-tauri-tool-ai-phase2.md`，实施计划见 `docs/ecc/2026-05-12-tauri-tool-ai-plan.md`。
