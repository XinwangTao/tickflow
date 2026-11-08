# TickFlow 迭代计划

> 主线：桌面端体验与性能 → 数据与同步可靠性 → Android 功能对等 → 真机验收。
> 规则：每轮只做排第一的未完成项，做到可验证；手机端实测已授权（adb 无线调试，设备接入后执行），无法在桌面同源环境验证的项统一记录到 `docs/TODO-device.md`，不阻塞主线。

## 状态基线（2026-11-07）

- 类型检查通过；Vitest 42 个文件 / 538 项；Playwright Electron E2E 36 条；打包版冒烟通过
- 桌面端功能清单（`docs/product/tickflow-pixel-checklist.md`）除「评论」外全部完成
- R2 真实桶 B1–B11 通过（3 份快照 / 93.3 KB）；同步范围扩展后已用 mock 双端验证，真实桶与真机复验列入 `docs/TODO-device.md`
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
5. ✅ 同步范围扩展：习惯 / 打卡 / 番茄 / 习惯提醒（2026-11-07，L1，按 `sync_scope_workflow` 实现）
   - 快照保持 `version: 1` + 可选数组：`habits` / `habitLogs` / `pomodoroSessions` / `habitReminders`；旧客户端忽略、旧快照缺失按空处理
   - 合并：习惯按 id + `updatedAt`；打卡按 `(habitId, logDate)`；提醒按 `habitId`；番茄按 id 并集；取消打卡/提醒写 tombstone
   - 迁移 v7：`habit_logs` / `habit_reminders` 增加 `deleted_at`；桌面写回顺序为习惯 → 打卡/提醒，单事务
   - 安卓：`buildSnapshot`/`applySnapshot` 覆盖习惯/打卡/番茄；取消打卡改 tombstone；习惯提醒仅桌面同步，安卓保留但不展示
   - 测试：`tests/sync.test.ts`（+5）、`tests/desktop-sync.test.ts`（+3）、`tests/mobile-sync.test.ts`（2）、`e2e/r2-habits.spec.ts`（双端合并 + 回传快照）
   - 真机复验项已追加到 `docs/TODO-device.md`
6. ✅ Android 功能对齐（L0）
   - ✅ 多选批量完成 / 删除（2026-11-07）：长按任务或顶栏「多选」进入，批量条完成/删除（删除二次确认），返回键退出
   - ✅ 搜索历史（2026-11-07）：回车或打开结果即记录，最多 5 条、大小写去重、可清空；localStorage 持久化，刷新/重启仍在
   - 验证：`npm run check:mobile-web` 覆盖长按、批量完成/删除、搜索历史记录/清空/刷新后保留；Vitest 新增 3 + 4 项
7. ✅ Android 习惯提醒（2026-11-07，L2，按 `mobile_habit_reminders_workflow` 实现）
   - `@capacitor/local-notifications` 8.3.1；每习惯每天一次，复用已同步的 `habitReminders`
   - 习惯页铃铛设置 HH:MM；保存后检查/申请通知权限并重排；关闭写 tombstone 并取消通知
   - 通知 id 用 habitId 稳定哈希；启动、同步成功、删除习惯后调用 `reconcileHabitNotifications` 对账
   - 点击通知回到「更多 → 习惯」；Web/预览环境返回 unsupported，不申请权限
   - 验证：`tests/mobile-habit-reminder-time.test.ts`（4）、`tests/mobile-sync.test.ts`（+2）、`tests/mobile-notifications-web.test.ts`（1）；`check:mobile-web` 覆盖提醒保存/刷新保留/关闭；debug/release APK 构建通过
   - 真机（2026-11-07 16:2x，PKJ110 / Android 17，debug 16:20:55 安装）：铃铛设置 16:22 → 通知渠道 `habit-reminders` 建立、AlarmManager 注册；应用退到后台后到点收到系统通知「习惯提醒 / 该打卡「晨间喝水-5934」了」；点通知打开「更多 → 习惯」；关闭提醒后待触发通知清空。截图 `docs/device-2026-11-07/`。
   - 修正：`isExactNotification` / `isExactMandatory` 属于通知对象而非 `schedule` 内字段；改为按 `checkExactNotificationSetting()` 结果决定是否排精确闹钟，未授权时退回不精确并在习惯页提示「可能明显延迟」+「去开启」，避免插件每次启动都跳系统设置页。
   - 剩余真机项（锁屏到点、杀进程后到点、系统重启、权限拒绝恢复、时区）在 `docs/TODO-device.md`
8. 🟡 真机验收（PKJ110 已接入，按 `docs/TODO-device.md` 顺序执行）
   - ✅ 2026-11-07 16:38–16:51，debug 0.1.0（versionCode 1，安装 16:51:23）：导出 JSON 走剪贴板（80.1 KB，无系统分享面板）、查看用量 3 份 / 107.7 KB、返回键五路径全过、番茄页与同步说明文案正常
   - 截图：`docs/device-acceptance-2026-11-07/`（01–26）；安装脚本 `F:/projects/_agent-runs/android-deploy.sh`
   - 待验：release 覆盖安装（需卸载，会清 IndexedDB）、真实 R2 双端、习惯/番茄 R2、多选批量、搜索历史、无线重连、versionCode 递增；习惯提醒剩余触发场景见 `TODO-device.md`

## 复盘状态（第 60 轮，2026-11-07）

- **已完成（本区间）**：首屏拆包（-43%）、任务行键盘操作、800 任务渲染基线、同步可靠性调度（防抖/单飞/退避/错误可见）、同步范围扩展（习惯/打卡/番茄/提醒 + tombstone）、Android 多选批量与搜索历史、Android 习惯提醒（本地通知 + 权限 + 对账）、MIT 许可证与 CI、永久删除确认、Android 二次确认改自绘（2026-11-08）
- **可离线队列**：空
- **2026-11-08 AI 迭代**：统计页新增「AI 周复盘」——把近 7 天完成/新建/逾期/专注时长交给 AI，
  输出总结、做得好、风险、下周建议；AI 关闭或失败时用 `ruleWeeklyReview` 本地降级，不空白。
  代码：`shared/ai.ts`（类型/提示词/校验/降级）、`main/ai.ts`（weeklyReviewWithAi）、
  IPC `ai:weekly`、`AiWeeklyReview.tsx`；测试 `tests/ai-weekly.test.ts`（3 项）。
- **2026-11-08 离线迭代**：移动端三处 `window.confirm`（批量删除 / 删除清单 / 删除习惯）改为自绘 `ConfirmSheet`
  - 新增 `mobile/src/ConfirmSheet.tsx`（`useConfirm` 返回 `ask` + `dialog`，Promise 化、连续触发按取消收尾），`styles.css` 补 `.confirm-card` / `.btn-danger`
  - 桌面端原有 `ConfirmDialog` 不动；移动端弹层改为居中卡片（深色主题一致、中文按钮）
  - `scripts/mobile-web-check.mjs` 覆盖取消与确认两条路径（取消后任务/多选不变，确认后删除并收起多选条）
  - 验证：`mobile` 构建通过（tsc + vite）、`npm run check:mobile-web` 通过
- **长尾离线池**：空
- **阻塞（写明解除条件）**：
  - release 覆盖安装：需卸载 debug（会清 IndexedDB），待用户确认后执行
  - 真实 R2 双端同步：需桌面端同时在线改数据，按 `docs/TODO-device.md` 逐项验收

## 明确不做

- 评论、共享清单/协作：首版 Out of Scope
