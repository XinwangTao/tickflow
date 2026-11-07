# TickFlow 项目约定

## 常用命令

- 开发：`npm run dev`；构建：`npm run build`；打包：`npm run dist`
- 回归：`npm run typecheck && npx vitest run && npm run test:e2e && npm run check:bundle`
- 移动端：`cd mobile && npm run build`；无真机 UI 校验：`npm run check:mobile-web`；APK：`cd mobile && npm run apk`（release 见 `docs/android.md`）
- 列表性能基线：`npm run perf:list -- 800`

## 测试约定

- Electron E2E 一律使用独立 `TICKFLOW_USER_DATA` 临时目录，禁止读写真实用户数据；结束后清理。
- 移动端数据层单测用 `fake-indexeddb`（见 `tests/mobile-*.test.ts`）。
- 新增设置字段优先做成可选（`?`），避免大量既有测试夹具需要同步修改。
- 定时/防抖逻辑用 `vi.useFakeTimers()` 测，不写真实等待。

## 同步约定

- 同步范围只含清单、任务、任务标签；LWW + tombstone 规则不变。
- 写入经 `change_log` 触发 3 秒防抖；单飞、失败 5/15/45 秒退避最多 3 次（`src/main/sync-scheduler.ts`）。
- 同步相关流程真源：`docs/archify/sync_reliability_workflow.html`、`sync_scope_workflow.html`；改流程先改图并确认。

## 构建与产物

- 打包体积预算：main 220 KB、preload 16 KB、renderer JS 1400 KB、CSS 90 KB。
- 非首屏视图用 `React.lazy`；不要重新引入 framer-motion。
- 重建安装包/APK 后更新 `release/SHA256SUMS.txt` 用 LF 换行，并跑 `sha256sum -c`。

## 真机与并行

- 真机实测已授权（OPPO PKJ110，adb 无线调试）；设备未接入时把必须上机的项写进 `docs/TODO-device.md`，不停等。
- 存在并行会话时只 `git add` 自己改的文件，不要 `git add -A`；不还原他人未提交改动。
- 复盘按 `docs/retro-routine.md` 六步执行。
