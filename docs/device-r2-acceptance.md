# 真机 / R2 凭据验收清单

本文件只收录**必须真实 Android 设备**或**必须 Cloudflare R2 凭据**才能完成的验收项。
当前不依赖这两项的部分已通过：桌面 typecheck、44 个 Vitest、Playwright E2E、NSIS 安装包、打包版冒烟；移动端 Web 手机视口全流程、debug APK 构建。

## A. 真机验收（🔒 需手机无线调试）

前置：手机解锁亮屏，开发者选项 → 无线调试开启并停留在该页面；PC 与手机同一局域网。已配对过则无需配对码。

| # | 项 | 方法 | 预期 |
|---|---|---|---|
| A1 | 无线连接 | `adb mdns services` 或沿用雅思 `oppo_wireless_setup.sh autoconnect <手机IP>` | `adb devices -l` 出现设备，状态 device |
| A2 | 安装 APK | `adb -s <地址> install -r -g mobile/android/app/build/outputs/apk/debug/app-debug.apk` | `Success` |
| A3 | 启动 | `adb -s <地址> shell am start -n com.tickflow.mobile/.MainActivity` | 进入「今天」 |
| A4 | 主界面 | 截图 `adb exec-out screencap -p > oppo.png` | 顶栏/底栏/FAB 正常，无遮挡、无安全区溢出 |
| A5 | 快速添加 | 点 FAB → 输入 `明天下午3点 交周报 #工作 !高` → 添加 | 任务出现在对应日期，标签/优先级正确 |
| A6 | 清单/日历 | 新建清单、切换清单；日历切换月/日、点日期 | 列表与日历同步显示任务 |
| A7 | 详情编辑 | 点任务 → 改标题/日期/优先级/标签 → 保存 | 返回列表后更新 |
| A8 | 持久化 | `am force-stop` 后重新 `am start` | 任务与清单仍在 |
| A9 | 搜索 | 顶栏搜索任务/标签 | 结果正确 |
| A10 | 输入法/安全区 | 中文输入、键盘弹出、旋转/深色模式 | 输入框不被键盘遮挡，底栏不压内容 |
| A11 | 稳定性 | 连续添加/完成/删除 20 次，观察 logcat | 无 `AndroidRuntime` 崩溃、无 WebView 白屏 |
| A12 | 离线 | 开飞行模式后再操作 | 本地增删改查正常 |
| A13 | 发布签名 | 配置 keystore 后 `assembleRelease` | release APK 可安装（当前仅 debug） |

常用命令：

```bash
adb devices -l
adb -s <地址> install -r -g mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s <地址> shell am start -n com.tickflow.mobile/.MainActivity
adb -s <地址> logcat -c && adb -s <地址> logcat -s Capacitor/Chromium/AndroidRuntime
adb -s <地址> exec-out screencap -p > oppo.png
```

## B. R2 同步验收（🔒 需 Endpoint/Bucket/Access Key/Secret + 桶 CORS）

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
| B11 | 同步范围 | 检查习惯/番茄/模板/过滤器 | 目前只同步清单、任务与任务标签；其他不跨端（预期） |

配置入口：

- 桌面：设置 → 同步（Cloudflare R2）
- Android：底部「设置」→ 同步（Cloudflare R2）

## C. 结论口径

- 在 A/B 完成前，只能说「桌面与移动端代码、构建、本地功能已验收」，不能说「双端同步已实测通过」。
- A/B 完成后，把本表结果补进对应行，并更新 `docs/product/tickflow-pixel-checklist.md` 的 🔒 状态。
