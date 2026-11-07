# TickFlow 迭代计划

> 主线：桌面端体验与性能 → 数据与同步可靠性 → Android 功能对等 → 真机验收。
> 规则：每轮只做排第一的未完成项，做到可验证；本阶段禁止手机端实测（adb / 无线调试 / 装机 / 模拟器），必须上机的项目一律写进 `docs/TODO-device.md`，不停下来等。

## 状态基线（2026-11-07）

- 类型检查通过；Vitest 38 个文件 / 517 项；Playwright Electron E2E 35 条；打包版冒烟通过
- 桌面端功能清单（`docs/product/tickflow-pixel-checklist.md`）除「评论」外全部完成
- R2 真实桶 B1–B11 通过，当前 3 份快照 / 93.3 KB，处于免费额度内
- Android 功能已落地，真机复验项集中记录在 `docs/TODO-device.md`

## 待办（按优先级）

1. ✅ 渲染首屏拆包与抽屉动画去 framer-motion（2026-11-07）
   - 非首屏视图（日历/看板/时间线/四象限/习惯/番茄/统计/模板）与搜索/设置/快捷键弹层改为 `React.lazy` + `Suspense`
   - 任务详情抽屉改用 CSS 动画与父级 presence 逻辑，移除 framer-motion 依赖
   - 结果：首屏入口 JS 1382.37 KB → 789.34 KB（-43%），renderer 总 JS 1382.37 KB → 969.8 KB（-30%），预算 1400 KB
2. ✅ 任务列表键盘可达性（2026-11-07，L0）
   - 任务行聚焦后：空格切换完成、↑/↓ 移动焦点、Enter 打开详情、Delete 移入垃圾箱（可撤销）
   - 行内按钮按键不再冒泡触发整行操作；快捷键帮助同步补充三项
   - 新增 `e2e/task-keyboard.spec.ts` 覆盖焦点移动、完成、详情、删除与撤销
3. ✅ 长列表渲染基线（2026-11-07，L0，暂不虚拟化）
   - 隔离数据目录实测 800 任务：重载到 800 行全部可用约 190ms（页内 170ms），脚本 `npm run perf:list -- 800`
   - 结论：当前 TaskList 规模足够，不引入虚拟滚动；后续任务数超过 2000 再复测
4. ✅ 同步可靠性增强（2026-11-07，L1，按 `sync_reliability_workflow` 实现）
   - 本地写入（清单/任务/标签）→ 3 秒防抖 → 闸门（autoSync 且配置完整）→ 单飞执行
   - 失败退避 5s / 15s / 45s，最多 3 次；新写入或手动同步重置计数
   - 手动/启动同步走同一调度器；成功写 `r2LastSync`、失败写 `r2LastError` 并在设置页显示
   - 后台同步成功后自动刷新列表与设置；远端有合并时提示，常规自动同步不弹成功 toast
   - 代码：`src/main/sync-scheduler.ts`、`src/main/db/change-log.ts`、`src/main/index.ts`、`src/main/ipc.ts`、`src/renderer/src/App.tsx`、`SettingsDialog.tsx`
   - 测试：`tests/sync-scheduler.test.ts`（6 项）+ `e2e/auto-sync-debounce.spec.ts`（防抖/单次上传/失败可见）
5. ⬜ 同步范围扩展：习惯 / 番茄 / 习惯提醒（L1，需先出流程图并确认）
6. 🟡 Android 功能对齐（L0）
   - ✅ 多选批量完成 / 删除（2026-11-07）：长按任务或顶栏「多选」进入，批量条完成/删除（删除二次确认），返回键退出
   - 验证：`npm run check:mobile-web`（Electron 加载移动端构建）覆盖长按、多选计数、批量完成、批量删除；Vitest 新增 3 项
   - ⬜ 搜索历史
7. ⬜ Android 习惯提醒（L2，需先出流程图并确认）
8. ⬜ 真机验收（阻塞，禁止本阶段执行）
   - 见 `docs/TODO-device.md`：备份导出分享面板、用量核对、release 覆盖安装、返回键五路径、习惯/番茄/统计、真实 R2 双端、无线重连、versionCode 递增

## 明确不做

- 评论、共享清单/协作：首版 Out of Scope
