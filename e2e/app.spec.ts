import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import type { TickFlowApi } from '../src/shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

/**
 * 每个用例使用独立的数据目录：既不会读写真实用户数据，也不会和其他正在运行的
 * TickFlow 实例抢单实例锁；默认数据目录被占用时 Electron 会直接退出。
 */
async function launchIsolatedApp(): Promise<{
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-app-'))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    return {
      app,
      page,
      close: async () => {
        await app.close().catch(() => undefined)
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    }
  } catch (error) {
    await app.close().catch(() => undefined)
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    throw error
  }
}

test('desktop smoke: preload API and all main views render', async () => {
  const { page, close } = await launchIsolatedApp()
  try {
    const info = await page.evaluate(() => window.api.app.info())
    expect(info.platform).toBe('win32')
    expect(info.version).toBeTruthy()

    await expect(page.locator('.main-title')).toHaveText('今天')

    await page.locator('.rail-item[title="日历"]').click()
    await expect(page.locator('.calendar-grid')).toBeVisible()
    await expect(page.locator('.calendar-cell')).toHaveCount(42)

    await page.locator('.rail-item[title="四象限"]').click()
    await expect(page.locator('.matrix-quadrant')).toHaveCount(4)

    await page.locator('.rail-item[title="番茄专注"]').click()
    await expect(page.locator('.pomodoro-time')).toBeVisible()
    await expect(page.locator('.pomodoro-controls .btn-primary')).toHaveText(/开始/)

    await page.locator('.rail-item[title="习惯"]').click()
    await expect(page.locator('.habits')).toBeVisible()

    await page.locator('.rail-item[title="统计"]').click()
    await expect(page.locator('.kpi-row')).toBeVisible()
    await expect(page.locator('.chart-card')).toHaveCount(6)

    await page.locator('.rail-item[title="今天"]').click()
    await expect(page.locator('.quick-add-input')).toBeVisible()
  } finally {
    await close()
  }
})

test('close-to-tray hides the window and show restores it', async () => {
  const { app, page, close } = await launchIsolatedApp()
  try {
    const visibleAfterClose = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      win.close()
      return win.isVisible()
    })
    expect(visibleAfterClose).toBe(false)

    const visibleAfterShow = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      win.show()
      return win.isVisible()
    })
    expect(visibleAfterShow).toBe(true)
  } finally {
    await close()
  }
})


test('autostart + startMinimized keeps the window hidden', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-startup-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  try {
    const first = await electron.launch({ args: ['.'], env })
    const page = await first.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    await page.evaluate(async () => {
      await window.api.settings.set({ autoLaunch: true, startMinimized: true })
    })
    await first.close()

    const second = await electron.launch({ args: ['.', '--autostart'], env })
    try {
      const visible = await second.evaluate(async ({ BrowserWindow }) => {
        for (let index = 0; index < 50; index += 1) {
          const win = BrowserWindow.getAllWindows()[0]
          if (win) return win.isVisible()
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return null
      })
      expect(visible).toBe(false)
    } finally {
      await second.close().catch(() => undefined)
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})


test('about dialog shows version and data directory', async () => {
  const { page, close } = await launchIsolatedApp()
  try {
    await page.locator('.rail-bottom button[title="关于"]').click()
    await expect(page.locator('.modal-header h2')).toHaveText('关于刻度清单')
    await expect(page.locator('.about-hero h3')).toHaveText('刻度清单 TickFlow')
    await expect(page.locator('.about-meta')).toContainText('版本 0.1.0')
    await expect(page.locator('.modal .settings-path')).not.toBeEmpty()
    await expect(page.getByRole('button', { name: '打开数据目录' })).toBeVisible()
    await expect(page.getByRole('button', { name: '立即备份' })).toBeVisible()
    await page.locator('.modal-header .icon-btn').click()
    await expect(page.locator('.modal-header h2')).toHaveCount(0)
  } finally {
    await close()
  }
})


test('shortcut help opens with question mark and closes with Escape', async () => {
  const { page, close } = await launchIsolatedApp()
  try {
    await page.locator('.main-title').click()
    await page.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
    })
    await expect(page.locator('.modal-header h2')).toHaveText('快捷键')
    await expect(page.locator('.shortcut-row')).toHaveCount(10)
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-header h2')).toHaveCount(0)
  } finally {
    await close()
  }
})
