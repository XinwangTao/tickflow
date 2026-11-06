import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

test('calendar day panel adds a task from natural language and can undo', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-calendar-add-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    await page.locator('.rail-item[title="日历"]').click()
    await expect(page.locator('.calendar-grid')).toBeVisible()

    const input = page.locator('input[aria-label="日历添加任务标题"]')
    await page.locator('.calendar-day-panel .calendar-add-btn').click()
    await expect(input).toBeFocused()

    await input.fill('9点 日历行内添加 E2E #工作')
    const preview = page.locator('.calendar-add-preview')
    await expect(preview).toContainText('09:00')
    await expect(preview).toContainText('#工作')

    await page.locator('.calendar-add-form').getByRole('button', { name: '添加' }).click()

    const panel = page.locator('.calendar-day-panel-body')
    await expect(panel).toContainText('日历行内添加 E2E', { timeout: 10_000 })
    await expect(input).toHaveCount(0)

    await page.locator('.toast-action').click()
    await expect(panel).not.toContainText('日历行内添加 E2E', { timeout: 10_000 })
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
