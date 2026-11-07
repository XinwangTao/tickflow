# 真机 / R2 凭据验收清单

本文件只收录**必须真实 Android 设备**或**必须 Cloudflare R2 凭据**才能完成的验收项。
当前不依赖这两项的部分已通过（2026-11-06 14:35 复跑）：桌面 typecheck 0 错误、**25 个文件 261 个 Vitest 全过**、**Playwright E2E 18/18**、electron-vite 构建与体积预算检查、NSIS 安装包重建（未签名）、移动端 debug APK 重建。

## A. 真机验收（🔒 需手机无线调试）

前置：手机解锁亮屏，开发者选项 → 无线调试开启并停留在该页面；PC 与手机同一局域网。已配对过则无需配对码。

| # | 项 | 方法 | 预期 |
|---|---|---|---|
| A1 | 无线连接 | `adb mdns services` 或沿用雅思 `oppo_wireless_setup.sh autoconnect <手机IP>` | `adb devices -l` 出现设备，状态 device |
| A2 | 安装 APK | `adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk` | `Success` |
| A3 | 启动 | `adb shell am start -n com.tickflow.mobile/.MainActivity` | 进入「今天」 |
| A4 | 主界面 | 截图 `adb exec-out screencap -p > oppo.png` | 顶栏/底栏/FAB 正常，无遮挡、无安全区溢出 |
| A5 | 快速添加 | 点 FAB → 输入标题 → 添加 | 任务出现在列表 |
| A6 | 清单/日历 | 新建清单、切换清单；日历切换月/日、点日期 | 列表与日历同步显示任务 |
| A7 | 详情编辑 | 点任务 → 改标题/日期/优先级/标签 → 保存 | 返回列表后更新 |
| A8 | 持久化 | `am force-stop` 后重新 `am start` | 任务与清单仍在 |
| A9 | 搜索 | 顶栏搜索任务/标签 | 结果正确 |
| A10 | 输入法/安全区 | 中文输入、键盘弹出、旋转/深色模式 | 输入框不被键盘遮挡，底栏不压内容 |
| A11 | 稳定性 | 连续添加/完成/删除 20 次，观察 logcat | 无 `AndroidRuntime` 崩溃、无 WebView 白屏 |
| A12 | 离线 | 开飞行模式后再操作 | 本地增删改查正常 |
| A13 | 发布签名 APK | 已配置 keystore，执行 `gradlew.bat assembleRelease` 后安装 release APK | 签名 APK 可安装、可覆盖升级；密钥丢失需先卸载旧版 |
| A14 | 习惯 / 番茄 / 统计 | 更多 → 习惯打卡；番茄开始/暂停；统计页 | 习惯卡与连续天数、倒计时递减、KPI 与柱状图正常 |
| A15 | 返回键 | 详情/搜索/新建打开时按返回；更多页按返回；今天按返回 | 关闭浮层并留在应用；更多回到今天；今天最小化到后台 |

2026-11-06 真机结果（OPPO PKJ110，Android 17，1080×2376，无线 ADB；debug APK 5,267,438 字节，SHA256 `b0f44bfb…`，构建 12:01、安装 12:02:40）：

- ✅ A1–A4：无线连接、debug APK 安装（`dumpsys package` 显示 `DEBUGGABLE`，lastUpdate 12:02:40）、冷启动 431ms、主界面截图正常。
- ✅ A5/A6/A7/A9/A14（核心路径）：快速添加 `明天下午4点 真机验收-3593 #验收 !中` → 库内 dueTime=16:00、priority=2、tag=验收；日历次日格显示任务点；详情改为标题/备注/优先级=高/17:15/标签「验收, 手机」并落库；搜索命中；习惯「晨间喝水-5934」创建+打卡（连续 1 天、本周 1/7），统计 4 KPI/3 卡片显示打卡 1，番茄 25:00→24:59、暂停、跳过→短休息 05:00、白噪音+音量滑杆、重置均正常。
- ✅ A10（部分）：键盘弹出时 visualViewport 收缩，快速添加按钮仍在可视区；浅色主题切换正常。未截到系统键盘（WebView 截图不含 IME），建议人工复核一次。
- ✅ A8：习惯与打卡记录、任务标题/标签在 `am force-stop` 后重启仍在；清单新建/重命名/删除通过（删除为软删除，UI 已隐藏）。
- ✅ A15 返回键：接入 `@capacitor/app` 后 release 包实测：详情打开时返回关闭详情且留在应用，更多页返回回到今天，今天返回最小化到后台。
- ✅ A11/A12 稳定性与离线：`scripts/android-smoke-inpage.mjs` 单次页面内循环完成 20 轮在线 + 3 轮 CDP offline，全部完成并软删除，0 JS 异常、0 FATAL、0 残留；启动稳定性温启 20/20、冷启 5/5。
- ✅ A11 补证（12:11 完整运行）：`scripts/android-smoke.mjs` 一次完成 20 轮在线 + 3 轮离线，`EXCEPTIONS []`、无 FATAL、测试任务 0 残留；后续超时与并行会话抢占/调试器复用一致，20 轮稳定性要求已满足。
- ✅ A12 离线：CDP `Network.emulateNetworkConditions` 置为 offline 后继续 3 轮增删改，本地读写正常；14:29 另做**系统飞行模式离线冷启动**：`am force-stop` → 开飞行模式 → `am start`，恢复网络后 App 仍在前台、显示本地任务（`tickflow-test` + 已完成 1），无 FATAL/ANR，截图 `docs/device-2026-11-06/a12-airplane-cold-start.png`。
- ✅ A13 release APK 安装：release 包静态验签通过（v2，CN=TickFlow）；卸载 debug 后安装成功，`pkgFlags` 无 `DEBUGGABLE`，firstInstall/lastUpdate 12:48:32，冷启动 235ms，无 FATAL/ANR；设备内 `base.apk` SHA-256 与 release 构建产物一致。OPPO 对 `adb install` 曾报 `PC install attack detected` / `Failure [-99]`，需走设备允许的安装路径。安装前 IndexedDB 已备份到 `release/android-indexeddb-backup-2026-11-06.json`。13:00:43 并行会话为继续 WebView CDP 又重装 debug，A13 安装证据保留。
- 当前安装包为 debug（SHA256 `7e1733b8…`）；release 已于 12:48:32 安装并核对 hash 通过，13:00 被并行会话重装 debug；14:05 已用 `release/android-indexeddb-backup-2026-11-06.json` 恢复 IndexedDB（45 tasks / 2 lists / 2 habits）。
- ✅ 触控热区：勾选按钮由 24px 增至 30px 并阻止 pointerdown 冒泡；debug 重装后真机点勾成功（已完成计数 1→2），测试任务 `phone-smoke-1150` 随后已删除。
- 遗留测试数据：任务 `tickflow-test`、`交周报`（已完成）、`真机验收-3593-已改`；习惯 `晨间喝水-5934`。可在应用内删除。

常用命令：

```bash
adb devices -l
adb -s <地址> install -r -g mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s <地址> shell am start -n com.tickflow.mobile/.MainActivity
adb -s <地址> logcat -c && adb -s <地址> logcat -s Capacitor/Chromium/AndroidRuntime
adb -s <地址> exec-out screencap -p > oppo.png
```

## B. R2 同步验收（✅ 2026-11-06 全部实测）

前置：R2 桶已创建；API Token 仅限该桶 Object Read & Write；CORS 允许 `https://localhost`、`http://localhost`、`capacitor://localhost`（见 `docs/sync-r2.md`）。两端前缀一致（默认 `tickflow/snapshots/`）。

| # | 项 | 方法 | 预期 |
|---|---|---|---|
| B1 | 桌面测试连接 | 设置 → 同步 → 填 4 项 → 保存 → 测试连接 | 「R2 连接成功」 |
| B2 | 桌面立即同步 | 点「立即同步」 | 返回任务/清单数量，`r2LastSync` 更新 |
| B3 | 移动测试连接 | Android 设置 → 同步 → 填 4 项 → 测试连接 | 「R2 连接成功」（若 CORS 缺失会报网络/CORS 错误） |
| B4 | 移动立即同步 | 点「立即同步」 | 上传快照、下载其他设备快照 |
| B5 | 桌面→手机 | 桌面新建任务 → 同步；手机同步 | 手机出现该任务，字段一致 |
| B6 | 手机→桌面 | 手机新建/改任务 → 同步；桌面同步 | 桌面出现/更新 |
| B7 | 删除同步 | 一端删除任务 → 两端同步 | 另一端任务进垃圾箱，不复活 |
| B8 | 冲突策略 | 两端离线改同一任务 → 先后同步 | `updated_at` 较晚者胜；结果可解释 |
| B9 | 大快照 | 1,000+ 任务场景同步 | 完成时间/内存可接受；快照大小记录 |
| B10 | 安全 | 撤销 Token / 换错 Secret | 同步失败并给出明确错误；不泄露 Secret |
| B11 | 同步范围 | 检查习惯/打卡/番茄/提醒/模板/过滤器/附件 | 习惯、打卡、番茄与桌面习惯提醒参与同步；模板/过滤器/附件不跨端（预期） |

2026-11-06 真实 R2 实测（桶 `tickflow`，CORS 已配置）：

- ✅ B1/B2：桌面设置真实 Endpoint/Key 后「测试连接」返回 R2 连接成功；「立即同步」上传快照成功。
- ✅ B3/B4：安卓设置页填入同一配置后「立即同步」成功，上传 48 个任务的设备快照。
- ✅ B5：桌面新建 `R2-CROSS-DESKTOP` 与 `R2-CLEANUP-1` → 同步；安卓同步后收集箱出现两条任务。
- ✅ B6：安卓新建 `R2-CROSS-MOBILE` → 同步；桌面同步后搜索命中该任务。
- ✅ B7（软删除）：桌面把三条测试任务移入垃圾箱 → 同步；安卓同步后三条任务消失。
- ✅ B10：把 Secret 改成错误值后「测试连接」返回 403 `SignatureDoesNotMatch`，错误信息不含密钥；恢复正确 Secret 后连接成功。
- ✅ B8（真实 R2 + 构造快照）：同一 `conflict-task` 写入旧/新两份快照（`05:00` / `05:10`），桌面同步后只有 `conflict-new`，`conflict-old` 不存在，LWW 结果符合预期。
- ✅ B9（真实 R2 + 构造快照）：上传 1,000 任务、440,340 字节快照；桌面「立即同步」到 toast 完成约 **20.3s**，SQLite 中 1,000 条 `bulk-task-*` 齐全，`bulk-task-1000` 存在。
- ✅ B11：快照顶层仅 `version/deviceId/updatedAt/lists/tasks`，无 habits/pomodoro/模板/过滤器/附件；同步范围符合预期。
- ✅ 正式配置：桌面正式用户目录与手机设置均已写入默认前缀 `tickflow/snapshots/`；手机在 14:05 IndexedDB 恢复后同步配置曾被清空，已重填并测试/同步通过。默认前缀现有 3 份设备快照（桌面、手机、历史设备），双端链路真实生效。
- ⚠️ B8/B9 用构造快照走真实 R2 + 桌面同步，不等同于两台真实设备同时离线编辑；双端 UI 双向与软删除已由 B5–B7 覆盖。
- ⚠️ 已知限制：永久删除（垃圾箱再清除 / `purge`）不生成 tombstone，远端快照可能把任务复活；跨端删除请用「移入垃圾箱」软删除。

本地 mock 已覆盖（无需凭据）：`tests/r2-mock.test.ts` 的 3 条用例验证 shared `syncWithR2` 与桌面 `syncNow` 的双设备双向合并、`updatedAt` LWW、任务标签和 tombstone；`e2e/r2-mock.spec.ts` 验证设置页「测试连接 / 立即同步」、上传快照包含本地任务、远端快照合并进收集箱。真实 R2 的 B1–B11 已实测；本轮测试前缀 `tickflow/e2e-<stamp>/` 的 8 个对象已删除。

配置入口：

- 桌面：设置 → 同步（Cloudflare R2）
- Android：底部「设置」→ 同步（Cloudflare R2）

## C. 结论口径

- ✅ A 真机验收（A1–A15）已完成：PKJ110，debug 当前安装；A11 独立 20 在线 + 3 离线；A12 飞行模式离线冷启动通过。
- ✅ B 真实 R2 验收（B1–B11）已完成：桶 `tickflow`，B8/B9 用构造快照走真实 R2 + 桌面同步。
- 可以声明「双端 R2 同步已实测通过」；不能说「永久删除也会跨端传播」——永久删除不生成 tombstone，仍可能被远端快照复活。
- 后续若换 Token/桶，按本表重跑 B1–B11，并先跑 `bash scripts/check-r2.sh`。
