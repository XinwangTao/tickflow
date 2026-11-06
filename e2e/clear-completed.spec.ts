import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import type { TickFlowApi } from '../src/shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

test('clear completed moves tasks to trash and empties the list view', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-clear-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    await page.evaluate(async () => {
      const list = await window.api.lists.create({ name: '清除完成 E2E', color: '#4c9aff' })
      for (const title of ['已完成 E2E A', '已完成 E2E B']) {
        const task = await window.api.tasks.create({ listId: list.id, title })
        await window.api.tasks.setStatus(task.id, 'completed')
      }
      await window.api.settings.set({ showCompleted: true })
    })
    await page.reload()
    await page.waitForSelector('.side-item', { timeout: 20_000 })
    await page.locator('.side-item', { hasText: '清除完成 E2E' }).click()
    await expect(page.locator('button[title="清除已完成"]')).toBeVisible()
    await page.locator('button[title="清除已完成"]').click()

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const completed = await window.api.tasks.query({ view: 'search', q: '已完成 E2E' })
          const trash = await window.api.tasks.query({ view: 'trash' })
          return {
            completed: completed.length,
            trash: trash.filter((task) => task.title.startsWith('已完成 E2E')).length
          }
        })
      )
      .toEqual({ completed: 0, trash: 2 })
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
