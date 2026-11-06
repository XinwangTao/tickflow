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

test('batch priority and due date apply to all selected tasks', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-batch-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    await page.evaluate(async () => {
      const lists = await window.api.lists.list()
      const inbox = lists.find((list) => list.isInbox)
      if (!inbox) return
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      for (const title of ['批量E2E A', '批量E2E B']) {
        await window.api.tasks.create({ listId: inbox.id, title, dueDate: today, allDay: true })
      }
    })
    await page.reload()
    await page.waitForSelector('.task-row', { timeout: 20_000 })

    const selectAll = async () => {
      await page.locator('button[title="多选任务"]').click()
      await page.locator('.batch-bar .btn', { hasText: '全选' }).click()
    }

    await selectAll()
    await page.locator('select[aria-label="批量设置优先级"]').selectOption('3')
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'all' })
          return rows.filter((row) => row.title.startsWith('批量E2E')).map((row) => row.priority)
        })
      )
      .toEqual([3, 3])

    await selectAll()
    await page.locator('select[aria-label="批量设置截止日期"]').selectOption('tomorrow')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const pad = (value: number) => String(value).padStart(2, '0')
    const expected = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(
      tomorrow.getDate()
    )}`
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'all' })
          return rows.filter((row) => row.title.startsWith('批量E2E')).map((row) => row.dueDate)
        })
      )
      .toEqual([expected, expected])
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
