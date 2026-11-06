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

test('empty trash permanently removes trashed tasks after confirmation', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-trash-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    await page.evaluate(async () => {
      const lists = await window.api.lists.list()
      const inbox = lists.find((list) => list.isInbox)
      if (!inbox) return
      for (const title of ['垃圾箱 E2E A', '垃圾箱 E2E B']) {
        const task = await window.api.tasks.create({ listId: inbox.id, title })
        await window.api.tasks.remove(task.id)
      }
    })
    await page.reload()
    await page.waitForSelector('.side-item', { timeout: 20_000 })
    await page.locator('.side-item', { hasText: '垃圾箱' }).click()
    await expect(page.locator('.task-row')).toHaveCount(2)
    await page.locator('button[title="清空垃圾箱"]').click()
    await expect(page.locator('.modal-header h2')).toHaveText('清空垃圾箱')
    await page.locator('.modal-actions .btn-danger').click()

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'trash' })
          return rows.filter((task) => task.title.startsWith('垃圾箱 E2E')).length
        })
      )
      .toBe(0)
    await expect(page.locator('.task-row')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
