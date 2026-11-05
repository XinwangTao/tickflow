# 无线调试：连接手机并安装/启动刻度清单
# 使用前：手机开发者选项 -> 无线调试 -> 开启；首次需 adb pair
$ErrorActionPreference = 'Stop'
$apk = 'F:\projects\tickflow\mobile\android\app\build\outputs\apk\debug\app-debug.apk'

Write-Host '=== 当前 adb 设备 ==='
adb devices

Write-Host '=== mDNS 无线调试服务 ==='
$mdns = adb mdns services
$mdns

$connect = $mdns | Select-String '_adb-tls-connect\._tcp' | ForEach-Object {
  ($_.Line -split '\s+')[-1]
} | Select-Object -First 1

if ($connect) {
  Write-Host "连接无线设备 $connect"
  adb connect $connect
} else {
  Write-Host '未发现 _adb-tls-connect._tcp。'
  Write-Host '请在手机开发者选项 -> 无线调试中开启，并确认电脑和手机在同一局域网。'
  Write-Host '首次配对：adb pair <手机IP>:<配对端口> <6位配对码>'
}

Write-Host '=== 连接后设备 ==='
adb devices

if (-not (Test-Path $apk)) {
  Write-Host "未找到 APK：$apk"
  Write-Host '请先执行：cd mobile; npm run apk'
  exit 1
}

Write-Host "安装 $apk"
adb install -r $apk

Write-Host '启动刻度清单'
adb shell monkey -p com.tickflow.mobile -c android.intent.category.LAUNCHER 1
