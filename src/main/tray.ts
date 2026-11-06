import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { getDb } from './db'
import { getCounts } from './db/tasks'
import { buildTrayMenuTemplate } from './tray-menu'

let tray: Tray | null = null
let timer: NodeJS.Timeout | null = null

const FALLBACK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export function setupTray(win: BrowserWindow, onQuickAdd: () => void): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(app.getAppPath(), 'resources', 'tray.png')
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(FALLBACK_PNG) : image)
  tray.setToolTip('刻度清单')

  const rebuild = (): void => {
    let today = 0
    try {
      today = getCounts(getDb()).today
    } catch {
      today = 0
    }
    tray?.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate(win, onQuickAdd, () => app.quit(), today)
      )
    )
  }

  rebuild()
  tray.on('click', () => {
    if (win.isVisible() && win.isFocused()) {
      win.hide()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  timer = setInterval(rebuild, 60_000)
}

export function destroyTray(): void {
  if (timer) clearInterval(timer)
  timer = null
  tray?.destroy()
  tray = null
}
