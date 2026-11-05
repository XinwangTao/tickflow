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

## 习惯 / 番茄 / 统计

底部导航「更多」页提供三个分段：

- 习惯：新建、今日打卡、7 天视图、连续/最长连续/本周次数、删除
- 番茄：25 分钟专注 / 5 分钟短休息 / 4 个番茄后 15 分钟长休息，支持暂停、跳过、重置、白噪音（Web Audio 生成，可调音量）
- 统计：近 7/30 天完成、近 7 天专注分钟与打卡，7 天柱状图和数据表

这三类数据保存在手机 IndexedDB 本地（Dexie v2 表 `habits` / `habitLogs` / `pomodoroSessions`），**不参与 R2 快照同步**；桌面与安卓目前只同步清单和任务。

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
- 两端使用固定收集箱 ID `00000000-0000-7000-8000-000000000001`
- R2 桶必须配置 CORS（`https://localhost`）
- debug APK 未签名发布版；正式分发前需配置签名
