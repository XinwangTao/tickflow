# 刻度清单 TickFlow

本地优先的任务管理桌面应用。P4 已交付核心任务管理、日历/四象限/看板/时间线、子任务/提醒/重复、习惯打卡、番茄专注、统计、批量撤销、模板、自定义过滤器、托盘、导入导出与 Windows 安装包；下一步是 Android 端 + Cloudflare R2 同步。

## 技术栈

- Electron 45 + React 19 + TypeScript 5.9
- Vite 8 / electron-vite 6
- `node:sqlite`（Electron 自带 Node 24，无需 native 编译）
- Zustand、framer-motion、dnd（原生 HTML5 拖拽）、自研中文快速添加解析器

## 开发与验证

```bash
npm install
npm run dev        # 开发模式（Vite + Electron）
npm run typecheck  # 主进程 + 渲染进程类型检查
npm test           # Vitest（35 个用例）
npm run test:e2e   # Playwright Electron 冒烟
npm run dist       # Windows NSIS 安装包（release/）
npm run build      # 构建 out/
npx electron .     # 运行构建产物
```

## 数据位置

- 数据库：`%APPDATA%\tickflow\data\tickflow.db`
- 自动备份：`%APPDATA%\tickflow\backups`（每次启动一份，保留最近 5 份）
- 关闭窗口会隐藏到托盘，从托盘菜单「退出」才会真正退出
- 全局快捷键：`Ctrl+Shift+N` 唤起主窗口并聚焦快速添加

数据库使用 UUIDv7、`created_at/updated_at/deleted_at`、`device_id` 与 `change_log`，为 Android/桌面同步预留；同步使用 Cloudflare R2 快照 + `updated_at` 合并。

## 文档

- 产品简报：`docs/product/tickflow_brief.md`
- 主流程图：`docs/archify/tickflow_workflow.html`（旁路 JSON 同名）
