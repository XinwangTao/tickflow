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

test('start focus opens pomodoro with the task preselected', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-focus-'))
  const env = { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  const app = await electron.launch({ args: ['.'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })
    const taskId = await page.evaluate(async () => {
      const lists = await window.api.lists.list()
      const inbox = lists.find((list) => list.isInbox)
      if (!inbox) return ''
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const task = await window.api.tasks.create({
        listId: inbox.id,
        title: '专注 E2E 任务',
        dueDate: today,
        allDay: true
      })
      return task.id
    })
    await page.reload()
    await page.waitForSelector('.task-row', { timeout: 20_000 })
    const row = page.locator('.task-row', { hasText: '专注 E2E 任务' }).first()
    await row.locator('.task-more .icon-btn').click()
    await row.locator('.task-menu-action', { hasText: '开始专注' }).click()

    await expect(page.locator('.main-title')).toHaveText('番茄专注')
    await expect(page.locator('.pomodoro-side select')).toHaveValue(taskId)
    await expect(page.locator('.pomodoro-task-label')).toHaveText('专注 E2E 任务')
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
