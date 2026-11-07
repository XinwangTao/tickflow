# 真机 TODO（手机接入后按顺序验收）

> 本文件只记录**必须真实 Android 设备**才能完成的验收项。真机实测已授权（adb 无线调试，OPPO PKJ110），设备接入后按顺序勾选；桌面与浏览器同源验证已完成的项不再重复。

## 前置

- 手机 OPPO PKJ110 解锁亮屏，开发者选项 → 无线调试开启
- PC 与手机同一局域网；已配对过则直接 `adb connect`，否则先 `adb pair`
- 安装最新 debug：`adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- 或验证签名包：`adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk`

## TODO(device)

- [ ] TODO(device) 本地备份「导出 JSON」真机路径：确认 `navigator.canShare` 是否弹出系统分享面板；若走剪贴板，确认 Toast 与内容长度。导入已在真机验证。
- [ ] TODO(device) 最新 APK 的「查看用量」：确认云端份数/字节与桌面一致（上次实测 3 份 / 93.3 KB）。
- [ ] TODO(device) 最新 release 包覆盖安装/冷启动：当前手机曾装 debug，release 需先卸载（会清 IndexedDB），安装后核对 `pkgFlags` 无 `DEBUGGABLE`。
- [ ] TODO(device) 返回键回归：任务详情、快速添加、搜索、更多页、今天页五条路径。
- [ ] TODO(device) 习惯/番茄/统计与白噪音：新建、打卡、计时递减、统计图表、音量滑杆。
- [~] TODO(device) 习惯提醒：✅ 后台到点触发（16:22 设置，退到后台后收到「习惯提醒」通知）、✅ 点击通知回到「更多 → 习惯」、✅ 关闭提醒后待触发通知清空、✅ 未授权时习惯页提示并可跳系统设置；⏳ 锁屏到点、杀进程后到点、系统重启后到点、权限拒绝后恢复、手动改时区。备注：ColorOS 会把不精确闹钟标注为 +2d23h 调整，实测仍在目标时间约 1 分钟内送达，需按「精确闹钟 + 允许后台运行」引导。验证时为排除省电策略干扰，已执行 `adb shell cmd deviceidle whitelist +com.tickflow.mobile` 与 `am set-standby-bucket com.tickflow.mobile active`；换机/重装后需重新设置，或在系统「电池 → 应用耗电管理」中允许后台运行。
- [ ] TODO(device) 真实 R2 双端同步：桌面改任务 → 手机同步、手机改 → 桌面同步、删除不复活、错 Secret 报错。
- [ ] TODO(device) 习惯/番茄 R2：桌面打卡 → 手机同步；手机取消打卡 → 桌面不复活；番茄记录双端合并且不重复；桌面取消习惯提醒后不被旧快照复活。
- [ ] TODO(device) 多选批量：长按进入/退出、批量完成、批量删除二次确认、返回键退出选择、批量条在小屏与大字号下不遮挡底部导航。
- [ ] TODO(device) 搜索历史：中文输入法回车记录、点结果记录、清除按钮、杀进程重开后仍保留。
- [ ] TODO(device) 无线断连重连：关闭/重开无线调试后 `adb connect`，确认应用数据与 R2 配置仍在。
- [ ] TODO(device) 发布前 versionCode 递增：当前 `versionCode 1`，覆盖升级前需 +1 并重新 `assembleRelease`。

## 已由桌面/同源环境替代验证

- Android 备份导入：真机已验证 1 任务 + 1 习惯，IndexedDB 核实
- 桌面 R2 真实桶 B1–B11、用量 3 份 / 93.3 KB
- 备份创建/最近校验/全部校验/恢复逻辑（临时目录单测）
- 语音安装包脚本路径与 ASR 环境（打包版实测 ready）
