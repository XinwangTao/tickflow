// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { buildTrayMenuTemplate } from '../src/main/tray-menu'

function fakeWindow(minimized = false) {
  const win = {
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
  return win as unknown as BrowserWindow & typeof win
}

function click(item: MenuItemConstructorOptions | undefined): void {
  if (!item || typeof item.click !== 'function') throw new Error('missing click handler')
  ;(item.click as () => void)()
}

describe('tray menu', () => {
  it('菜单包含显示、快速添加、今日计数与退出', () => {
    const template = buildTrayMenuTemplate(fakeWindow(), vi.fn(), vi.fn(), 3)
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      '显示刻度清单',
      '快速添加',
      'separator',
      '今天 3 条',
      'separator',
      '退出'
    ])
    expect(template[3]?.enabled).toBe(false)
  })

  it('显示与快速添加会恢复窗口并聚焦', () => {
    const win = fakeWindow(true)
    const quickAdd = vi.fn()
    const quit = vi.fn()
    const template = buildTrayMenuTemplate(win, quickAdd, quit, 0)

    click(template[0])
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)

    click(template[1])
    expect(quickAdd).toHaveBeenCalledTimes(1)
    click(template[5])
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
