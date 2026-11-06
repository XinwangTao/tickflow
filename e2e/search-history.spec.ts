import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

test('search remembers recent terms and can clear them', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-search-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    await page.evaluate(async () => {
      const lists = await window.api.lists.list()
      const inbox = lists.find((list) => list.isInbox)
      if (inbox) {
        const now = new Date()
        const pad = (value: number) => String(value).padStart(2, '0')
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        await window.api.tasks.create({
          listId: inbox.id,
          title: '搜索历史 E2E',
          dueDate: today,
          allDay: true
        })
      }
    })
    await page.reload()
    await page.waitForSelector('.task-row', { timeout: 20_000 })

    const openSearch = async () => {
      await page.locator('button[title*="搜索"]').first().click()
      await page.waitForSelector('.search-input')
    }

    await openSearch()
    await page.locator('.search-input').fill('搜索历史')
    await expect(page.locator('.search-result')).toHaveCount(1, { timeout: 10_000 })
    await page.locator('.search-result').click()
    await page.keyboard.press('Escape')

    await openSearch()
    await expect(page.locator('.search-recent-item')).toContainText('搜索历史')
    await page.locator('.search-recent-item').click()
    await expect(page.locator('.search-input')).toHaveValue('搜索历史')
    await page.locator('.search-input').fill('')
    await expect(page.locator('.search-recent-head button')).toBeVisible()
    await page.locator('.search-recent-head button').click()
    await expect(page.locator('.search-recent-item')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
