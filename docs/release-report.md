# 刻度清单 TickFlow — 发布验收报告

- 版本：0.1.0
- 日期：2026-11-06
- 范围：Windows 桌面端 + Android（Capacitor）+ Cloudflare R2 快照同步

## 验证结果

| 项 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过（main / preload / renderer） |
| Vitest | 36 个文件 / 492 项全部通过 |
| Playwright Electron E2E | 25 条通过（含日历行内添加、日历 AI 草稿、关闭到托盘、自启最小化、关于弹窗、R2 mock 同步；每个用例使用独立 `TICKFLOW_USER_DATA` 临时目录，不读写真实数据） |
| 构建体积预算 | 通过：main 196.4 KB / 220 KB，preload 9.2 KB / 16 KB，renderer JS 1337.9 KB / 1400 KB，CSS 71.3 KB / 90 KB |
| 桌面安装包 | NSIS 重建成功，117 MB，未签名 |
| Android debug APK | 5.0 MB，`com.tickflow.mobile`，minSdk 24 / targetSdk 36 |
| Android release APK | 3.6 MB，已用本地 keystore 签名并通过 `apksigner verify` |
| 真机（OPPO PKJ110 / Android 17） | 安装、冷启动、快速添加、详情、搜索、清单 CRUD、习惯/番茄/统计、键盘安全区、浅色主题、返回键、20+3 轮稳定性、飞行模式冷启动通过 |
| R2 真实桶 | B1–B11 通过：双端双向、软删除、LWW、1000 任务快照、错 Secret 403；当前 3 份快照 / 93.3 KB |
| 安全 | JSON 导出剔除 R2/AI 凭据；桌面 R2/AI 密钥使用 `safeStorage` 加密落库并自动迁移旧明文 |

## 产物

| 产物 | 大小 | SHA-256 |
|---|---|---|
| `release/刻度清单 Setup 0.1.0.exe` | 121,681,483 B | `75779b1c0c5868231c45ebd4faa471e96667b0ecfd8d6412259b1b3f1926c8a5` |
| `mobile/android/app/build/outputs/apk/debug/app-debug.apk` | 5,273,455 B | `aa21b481f9f57f8130536350b13df1568ce7c87a80c749f6f97a867e9648b658` |
| `mobile/android/app/build/outputs/apk/release/app-release.apk` | 3,797,709 B | `0cce780270a46c039ba6a5bdfaf15d056c2998e80838862220d192ad77dee042` |

校验文件：`release/SHA256SUMS.txt`（`sha256sum -c` 可直接复核）

## 复现命令

```bash
cd F:/projects/tickflow
npm run typecheck
npm test
npm run test:e2e
npm run dist

cd mobile
npm run apk
cd android && gradlew.bat assembleRelease
```

## 已知限制

- NSIS 安装包未签名，Windows SmartScreen 可能提示；发布前应配置代码签名证书。
- Android 目前是 `versionCode 1 / versionName 0.1.0`；后续发版需递增 versionCode 才能覆盖升级。
- R2 只同步清单、任务与任务标签；附件、习惯、番茄、模板、过滤器、习惯提醒仍为本地数据。
- R2 免费额度已核对：单快照 5 MiB 上限、每设备一个对象覆盖写，正常使用远低于 10 GB / 100 万 Class A / 1000 万 Class B。
- 评论/共享清单属于首版明确不做范围。
- 开机自启与启动最小化只在安装版写入系统启动项；开发模式不写。
- R2 Token 曾在 Obsidian vault 以明文出现，建议在 Cloudflare 撤销并轮换为仅限 `tickflow` 桶的新 Token。

## 相关文档

- 功能与像素清单：`docs/product/tickflow-pixel-checklist.md`
- 真机 / R2 验收：`docs/device-r2-acceptance.md`
- R2 配置与免费额度：`docs/sync-r2.md`
- Android 构建/真机/冒烟：`docs/android.md`
