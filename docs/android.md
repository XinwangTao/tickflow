# Android 端

- 位置：`mobile/`，Capacitor 8 + React 19 + Vite + Dexie（IndexedDB）
- 包名：`com.tickflow.mobile`，应用名：`刻度清单`
- 同步：Cloudflare R2 快照，见 `docs/sync-r2.md`

## 环境

本机已验证：

- Java 21（`JAVA_HOME=E:\JAVA`）
- Android SDK：`C:\Users\<用户>\AppData\Local\Android\Sdk`（platform 34/36、build-tools 36）
- Gradle 8.13（`F:\cache\gradle` 缓存；wrapper 已指向 8.13）
- adb 37

## 构建

```bash
cd mobile
npm install
npm run build
npx cap sync android
cd android
gradlew.bat assembleDebug
```

产物：

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

本机已构建：约 4.9MB。

## 安装

USB 或无线 adb：

```bash
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.tickflow.mobile -c android.intent.category.LAUNCHER 1
```

## 无线调试（次日真机）

手机：开发者选项 → 无线调试 → 开启；首次需要配对码。

电脑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-wireless.ps1
```

脚本会：

1. 列出 `adb mdns services`
2. 自动连接 `_adb-tls-connect._tcp` 服务
3. `adb install -r` APK
4. 启动应用

首次配对时先执行：

```bash
adb pair <手机IP>:<配对端口> <6位配对码>
```

## 真机冒烟

设备在线、安装 debug 包并开启 WebView 调试后：

```bash
npm run test:android -- --cycles=20 --offline=3
```

脚本会：

1. 确认 adb 设备在线并启动 `com.tickflow.mobile`
2. 通过 `adb forward` 连接 WebView DevTools
3. 在真机执行 N 轮「快速添加 → 勾选完成 → 详情删除」
4. 用 CDP 离线模拟再跑若干轮
5. 检查 JS 异常与 `logcat` 中的 `FATAL EXCEPTION`，失败时退出码非 0

参数：`--cycles`、`--offline`、`--serial`、`--port`。要求安装 debug 包（release 默认不开 WebView 调试），测试任务会在结束后删除。

## 习惯 / 番茄 / 统计

底部导航「更多」页提供三个分段：

- 习惯：新建、今日打卡、7 天视图、连续/最长连续/本周次数、删除
- 习惯每日提醒：桌面用系统通知 + 通知中心；安卓用 `@capacitor/local-notifications` 注册每日本地通知，支持权限申请、启动/同步后对账、点击回到习惯页（真机触发待验收）
- 番茄：25 分钟专注 / 5 分钟短休息 / 4 个番茄后 15 分钟长休息，支持暂停、跳过、重置、白噪音（Web Audio 生成，可调音量）
- 统计：近 7/30 天完成、近 7 天专注分钟与打卡，7 天柱状图和数据表

这三类数据保存在手机 IndexedDB（Dexie 表 `habits` / `habitLogs` / `pomodoroSessions`）。自 2026-11-07 起参与 R2 快照同步：打卡按 `(habitId, logDate)` 去重，取消打卡写 tombstone；习惯提醒仅桌面端同步与提醒，安卓端暂不使用。

## 本地备份

设置页「本地备份」支持：

- 导出 JSON：优先调用系统分享面板，不支持时复制到剪贴板；包含清单、任务、习惯、习惯打卡、番茄记录，R2/AI 凭据不写入
- 导入 JSON：粘贴备份内容后按 ID 合并，已存在记录跳过，不删除现有数据

习惯/番茄不参与 R2 同步，换机或清数据前建议先导出一份。

## 发布签名

已生成自用发布密钥（不提交到 git）：

- Keystore：`mobile/android/keystore/tickflow-release.jks`
- 凭据：`mobile/android/keystore.properties`（`storeFile` / `storePassword` / `keyAlias=tickflow` / `keyPassword`）
- 证书：`CN=TickFlow, OU=Personal, O=TickFlow, L=Local, ST=Local, C=CN`，RSA 2048，有效期 10000 天
- `.gitignore` 已排除 `keystore/`、`keystore.properties`、`*.jks`

构建：

```bash
cd mobile/android
gradlew.bat assembleRelease
```

产物：`mobile/android/app/build/outputs/apk/release/app-release.apk`（约 3.7MB，已签名）。

`keystore` 与 `keystore.properties` 必须单独备份；丢失后无法覆盖安装已发布版本。更换密钥等于更换应用签名，需要先卸载旧版。

## 注意

- Android 端首次启动会创建本地 IndexedDB；R2 配置在「设置 → 同步」中填写
- 2026-11-06 真机验收（PKJ110）：安装、冷启动、新建任务、杀进程重启持久化、快速添加中文解析、日历、详情编辑、搜索、清单 CRUD、习惯打卡、番茄计时、统计、键盘安全区、浅色主题通过；release APK 已于 12:48:32 安装验证（非 DEBUGGABLE，冷启动 235ms，无 FATAL/ANR）；13:00 并行会话为 CDP 重装 debug，14:05 已恢复 IndexedDB 备份；A11 于 13:32 独立跑通 **20 轮在线 + 3 轮离线**（exit 0，`leftovers=0`，无 FATAL/ANR）；A12 飞行模式离线冷启动于 14:29 通过；真实 R2 B1–B11 已通过（桶 `tickflow`）；14:43 debug APK 重建（5,271,896 字节，SHA256 `d02db33f…`），14:44:27 覆盖安装保留数据，新包 20+3 冒烟 PASS。详见 [device-verification-2026-11-06.md](device-verification-2026-11-06.md)
- 两端使用固定收集箱 ID `00000000-0000-7000-8000-000000000001`
- 返回键由 `@capacitor/app` 接管：先关闭详情/快速添加/搜索/菜单，再回到「今天」，最后最小化到后台；release 包已真机验证
- R2 桶必须配置 CORS（`https://localhost`）
- debug APK 未签名发布版；正式分发前需配置签名

## safe-area（2026-11-06）

- `capacitor.config.ts` 设置 `plugins.SystemBars.insetsHandling = "native"`，避免启动期 CSS 变量注入报错；App 使用 `env(safe-area-inset-*)`。
- 重新 `npm run apk` + `adb install -r` 后，logcat 中 `Error injecting safe area CSS` 计数为 0。

## release 安装脚本

`scripts/install-release.ps1` 带数据丢失门禁：

```powershell
# 只看计划（不卸载、不清数据）
powershell -File scripts/install-release.ps1 -DryRun

# 实际安装（会卸载 debug 并清空 IndexedDB）
powershell -File scripts/install-release.ps1 -ConfirmDataLoss
```

debug 与 release 证书不同，覆盖安装会签名冲突；脚本在检测到 debug 且未加 `-ConfirmDataLoss` 时直接 exit 2。OPPO 还可能在手机上弹“未知来源 → 继续安装”，需手动确认。
