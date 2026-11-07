import { app, BrowserWindow, session, globalShortcut, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IPC } from '@shared/ipc'
import { closeDatabase, getDb, initDatabase } from './db'
import {
  SECRET_PREFIX,
  getSettings,
  isSealedSecret,
  setSecretCodec,
  setSettings
} from './db/settings'
import { registerIpc } from './ipc'
import { startReminderScheduler, stopReminderScheduler } from './reminders'
import { getSyncConfig, isSyncConfigured, syncNow } from './sync'
import { SyncScheduler } from './sync-scheduler'
import { setChangeListener } from './db/change-log'
import { destroyTray, setupTray } from './tray'

// 测试/便携运行时可指定独立数据目录，避免 E2E 写入真实用户数据库与备份。
// 必须在 requestSingleInstanceLock 与 initDatabase 之前生效。
const userDataOverride = process.env['TICKFLOW_USER_DATA']?.trim()
if (userDataOverride) {
  const dir = resolve(userDataOverride)
  mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
}

let mainWindow: BrowserWindow | null = null
let syncScheduler: SyncScheduler | null = null
let isQuitting = false
const launchedByAutostart = process.argv.includes('--autostart')

function quickAdd(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send(IPC.appQuickAddEvent)
}

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    roundedCorners: true,
    backgroundColor: '#1e1f22',
    title: '刻度清单',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (launchedByAutostart && getSettings(getDb()).startMinimized) return
    mainWindow?.show()
  })
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC.winMaximizedEvent, true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC.winMaximizedEvent, false)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow) {
      startReminderScheduler(mainWindow)
      setTimeout(() => {
        if (!mainWindow) return
        void syncScheduler?.runStartup().catch(() => undefined)
      }, 2500)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function configureSecretCodec(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    setSecretCodec({
      seal(value) {
        return SECRET_PREFIX + safeStorage.encryptString(value).toString('base64')
      },
      open(value) {
        return safeStorage.decryptString(
          Buffer.from(value.slice(SECRET_PREFIX.length), 'base64')
        )
      }
    })
    return true
  } catch (error) {
    console.warn('[tickflow] 系统加密不可用，敏感设置将保持明文：', error)
    return false
  }
}

function migratePlaintextSecrets(): void {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT key, value FROM settings WHERE key IN ('r2AccessKeyId', 'r2SecretAccessKey', 'aiToken')"
    )
    .all() as Array<{ key: string; value: string }>
  if (!rows.some((row) => row.value && !isSealedSecret(String(row.value)))) return
  const settings = getSettings(db)
  setSettings(db, {
    r2AccessKeyId: settings.r2AccessKeyId,
    r2SecretAccessKey: settings.r2SecretAccessKey,
    aiToken: settings.aiToken
  })
}

function applyAutoLaunch(): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({
      openAtLogin: getSettings(getDb()).autoLaunch,
      args: ['--autostart']
    })
  } catch (error) {
    console.warn('[tickflow] 应用开机自启设置失败：', error)
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.tickflow.app')
    // 语音快速添加要拿麦克风；只放行 media，其余权限保持默认拒绝。
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media')
    })
    initDatabase()
    if (configureSecretCodec()) migratePlaintextSecrets()
    applyAutoLaunch()
    syncScheduler = new SyncScheduler({
      sync: () => syncNow(getDb()),
      isAutoEnabled: () => {
        const settings = getSettings(getDb())
        return Boolean(settings.r2AutoSync) && isSyncConfigured(getSyncConfig(getDb()))
      },
      notify: (result) => {
        setSettings(getDb(), result.ok ? { r2LastError: '' } : { r2LastError: result.message })
        mainWindow?.webContents.send(IPC.syncResultEvent, result)
      }
    })
    setChangeListener((entityType) => {
      if (entityType === 'list' || entityType === 'task' || entityType === 'tag') {
        syncScheduler?.schedule()
      }
    })
    registerIpc(syncScheduler)
    createWindow()

    if (mainWindow) {
      setupTray(mainWindow, quickAdd)
    }
    const registered = globalShortcut.register('CommandOrControl+Shift+N', quickAdd)
    if (!registered) {
      console.warn('[tickflow] 全局快捷键 CommandOrControl+Shift+N 注册失败')
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else {
        mainWindow?.show()
        mainWindow?.focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopReminderScheduler()
    syncScheduler?.stop()
    setChangeListener(null)
    closeDatabase()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    destroyTray()
  })
}
