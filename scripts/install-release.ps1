# 安装 TickFlow release APK（带数据丢失门禁）
# 用法：
#   powershell -File scripts/install-release.ps1 -DryRun
#   powershell -File scripts/install-release.ps1 -ConfirmDataLoss
# 说明：debug 与 release 签名不同，覆盖安装前必须卸载 debug，会清空 IndexedDB。
param(
    [string]$Apk = "$PSScriptRoot\..\mobile\android\app\build\outputs\apk\release\app-release.apk",
    [string]$Serial = '',
    [switch]$ConfirmDataLoss,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Package = 'com.tickflow.mobile'

function Invoke-Adb {
    param([string[]]$Arguments)
    if ($Serial) { & adb -s $Serial @Arguments } else { & adb @Arguments }
}

if (-not (Test-Path $Apk)) {
    Write-Host "未找到 release APK：$Apk"
    Write-Host '请先执行：cd mobile; npm run apk'
    exit 1
}
if (-not $Serial) {
    $Serial = (& adb devices |
        Select-String '^\S+\s+device$' |
        ForEach-Object { ($_.Line -split '\s+')[0] } |
        Select-Object -First 1)
}
if (-not $Serial) {
    Write-Host '没有在线的 adb 设备；先运行 scripts/android-wireless.ps1 或 adb connect。'
    exit 1
}

$installed = ((Invoke-Adb @('shell', 'pm', 'path', $Package)) -join "`n") -match '^package:'
$dump = if ($installed) { (Invoke-Adb @('shell', 'dumpsys', 'package', $Package)) -join "`n" } else { '' }
$isDebug = $dump -match 'DEBUGGABLE'
$isRelease = $installed -and -not $isDebug

Write-Host "设备：$Serial"
Write-Host "当前安装：$(if ($installed) { if ($isDebug) { 'debug' } else { 'release' } } else { '无' })"
Write-Host "release APK：$Apk"

if ($DryRun) {
    Write-Host ''
    if ($installed -and $isDebug) {
        Write-Host '计划：adb uninstall com.tickflow.mobile（会清数据）→ adb install release → 启动校验'
        Write-Host '实际执行需加 -ConfirmDataLoss。'
    } elseif ($isRelease) {
        Write-Host '计划：已安装 release，直接启动校验'
    } else {
        Write-Host '计划：adb install release → 启动校验'
    }
    exit 0
}

if ($installed -and $isDebug -and -not $ConfirmDataLoss) {
    Write-Host ''
    Write-Host '拒绝执行：已安装 debug，安装 release 必须先卸载 debug，会清空 IndexedDB（任务/习惯/番茄）。'
    Write-Host '确认接受数据丢失后，加 -ConfirmDataLoss 重跑；只查看计划用 -DryRun。'
    exit 2
}

if ($installed -and $isDebug) {
    Write-Host '卸载 debug（清空应用数据）...'
    Invoke-Adb @('uninstall', $Package) | Out-Host
}

Write-Host '安装 release...'
$output = Invoke-Adb @('install', $Apk) 2>&1
$output | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '安装未完成。OPPO 可能弹出“未知来源”确认页：请在手机上点“继续安装”，然后重跑本脚本。'
    exit 1
}

Write-Host '启动并校验...'
Invoke-Adb @('shell', 'am', 'start', '-W', '-n', "$Package/.MainActivity") | Out-Host
Start-Sleep -Seconds 2
$verify = (Invoke-Adb @('shell', 'dumpsys', 'package', $Package)) -join "`n"
if ($verify -match 'DEBUGGABLE') {
    Write-Host '校验失败：安装包仍为 DEBUGGABLE。'
    exit 1
}
Write-Host 'release 安装与启动校验通过（pkgFlags 不含 DEBUGGABLE）。'

