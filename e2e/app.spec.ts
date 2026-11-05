import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { TickFlowApi } from '../src/shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

test('desktop smoke: preload API and all main views render', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

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
    await app.close()
  }
})
