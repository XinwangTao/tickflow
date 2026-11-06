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

test('duplicate task keeps fields and appends suffix', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-duplicate-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    const today = await page.evaluate(async () => {
      const lists = await window.api.lists.list()
      const inbox = lists.find((list) => list.isInbox)
      if (!inbox) return ''
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      await window.api.tasks.create({
        listId: inbox.id,
        title: '复制 E2E 源',
        notes: '保留备注',
        priority: 2,
        dueDate: key,
        startDate: key,
        allDay: true,
        tagNames: ['工作']
      })
      return key
    })
    await page.reload()
    await page.waitForSelector('.task-row', { timeout: 20_000 })
    const row = page.locator('.task-row', { hasText: '复制 E2E 源' }).first()
    await row.locator('.task-more .icon-btn').click()
    await row.locator('.task-menu-action', { hasText: '复制任务' }).click()

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'search', q: '复制 E2E 源 副本' })
          return rows.map((row) => ({
            title: row.title,
            notes: row.notes,
            priority: row.priority,
            dueDate: row.dueDate,
            startDate: row.startDate,
            tags: row.tags.map((tag) => tag.name)
          }))
        })
      )
      .toEqual([
        {
          title: '复制 E2E 源 副本',
          notes: '保留备注',
          priority: 2,
          dueDate: today,
          startDate: today,
          tags: ['工作']
        }
      ])
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
