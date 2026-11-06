import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IPC } from '@shared/ipc'
import { closeDatabase, getDb, initDatabase } from './db'
import { registerIpc } from './ipc'
import { startReminderScheduler, stopReminderScheduler } from './reminders'
import { autoSync } from './sync'
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
let isQuitting = false

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
        void autoSync(getDb())
          .then((result) => {
            if (result) mainWindow?.webContents.send(IPC.syncResultEvent, result)
          })
          .catch(() => undefined)
      }, 2500)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
    initDatabase()
    registerIpc()
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
    closeDatabase()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    destroyTray()
  })
}
