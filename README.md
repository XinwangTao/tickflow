# 刻度清单 TickFlow

本地优先的任务管理应用。桌面端已交付核心任务管理、日历/四象限/看板（清单/优先级/日期分组）/时间线、子任务/提醒/习惯提醒/重复、习惯打卡、番茄专注（白噪音与 7 天专注图表）、统计、批量撤销、模板、自定义过滤器、标签管理、附件、通知中心、托盘、导入导出与 Windows 安装包；Android 端已用 Capacitor + React + Dexie 构建（含习惯/番茄/统计/已完成分组/白噪音），桌面/手机通过 Cloudflare R2 快照同步清单与任务。

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
npm test           # Vitest 全量用例（含依赖与打包边界检查）
npm run test:e2e   # Playwright Electron 冒烟
npm run dist       # build + check:bundle + Windows NSIS 安装包（release/）
npm run build      # 构建 out/
npm run check:bundle # 构建产物体积预算 + 主进程运行时依赖检查（见 docs/packaging.md）
npx electron .     # 运行构建产物
```

## 安装与分发

### Windows

1. 运行 `release/刻度清单 Setup 0.1.0.exe`
2. 安装包未签名，SmartScreen 可能提示“更多信息 → 仍要运行”
3. 数据写入 `%APPDATA%\tickflow`，卸载不会删除数据

### Android

- 正式安装包：`mobile/android/app/build/outputs/apk/release/app-release.apk`（已签名）
- 调试包：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- 首次安装需允许“安装未知应用”；后续升级必须使用同一 keystore，并递增 `versionCode`

### 校验产物

```bash
sha256sum -c release/SHA256SUMS.txt
```

## 数据位置

- 数据库：`%APPDATA%\tickflow\data\tickflow.db`
- 自动备份：`%APPDATA%\tickflow\backups`（每次启动一份，保留最近 5 份）
- 关闭窗口会隐藏到托盘，从托盘菜单「退出」才会真正退出
- 全局快捷键：`Ctrl+Shift+N` 唤起主窗口并聚焦快速添加

## Android

```bash
cd mobile
npm install
npm run apk
# APK：mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

真机安装与无线调试见 `docs/android.md`。

## 同步

桌面与 Android 使用 Cloudflare R2 快照同步（`updated_at` LWW + tombstone）。配置、CORS 与故障排查见 `docs/sync-r2.md`。

数据库使用 UUIDv7、`created_at/updated_at/deleted_at`、`device_id` 与 `change_log`，为 Android/桌面同步预留；同步使用 Cloudflare R2 快照 + `updated_at` 合并。

## 文档

- 发布验收报告：`docs/release-report.md`（版本、测试、产物哈希、已知限制）
- 版本变更：`CHANGELOG.md`
- 产品简报：`docs/product/tickflow_brief.md`
- 像素级清单：`docs/product/tickflow-pixel-checklist.md`
- 主流程图：`docs/archify/tickflow_workflow.html`（旁路 JSON 同名）
- 真机/R2 验收：`docs/device-r2-acceptance.md`
