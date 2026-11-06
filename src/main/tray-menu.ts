import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

export function buildTrayMenuTemplate(
  win: BrowserWindow,
  onQuickAdd: () => void,
  onQuit: () => void,
  today: number
): MenuItemConstructorOptions[] {
  return [
    {
      label: '显示刻度清单',
      click: () => {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    },
    {
      label: '快速添加',
      click: () => {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        onQuickAdd()
      }
    },
    { type: 'separator' },
    { label: `今天 ${today} 条`, enabled: false },
    { type: 'separator' },
    { label: '退出', click: onQuit }
  ]
}
