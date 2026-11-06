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

test('task rows support Space, arrow keys and Delete', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-keyboard-'))
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
      for (const title of ['键盘E2E A', '键盘E2E B']) {
        await window.api.tasks.create({ listId: inbox.id, title, dueDate: today, allDay: true })
      }
    })
    await page.reload()
    await page.waitForSelector('.task-row', { timeout: 20_000 })

    const rowA = page.locator('.task-row', { hasText: '键盘E2E A' })
    const rowB = page.locator('.task-row', { hasText: '键盘E2E B' })
    const title = async (): Promise<string> =>
      (await page.evaluate(
        () => document.activeElement?.querySelector('.task-title')?.textContent ?? ''
      )) as string

    await rowB.focus()
    await expect(rowB).toBeFocused()

    // ↓ / ↑ 在任务行之间移动焦点。
    await page.keyboard.press('ArrowDown')
    await expect(rowA).toBeFocused()
    expect(await title()).toBe('键盘E2E A')
    await page.keyboard.press('ArrowUp')
    await expect(rowB).toBeFocused()

    // Enter 打开详情，Esc 关闭。
    await page.keyboard.press('Enter')
    await expect(page.locator('.detail-drawer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-drawer')).toHaveCount(0)

    // 空格切换完成状态。
    await rowA.focus()
    await page.keyboard.press('Space')
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'completed' })
          return rows.some((row) => row.title === '键盘E2E A')
        })
      )
      .toBe(true)

    // Delete 移入垃圾箱，并可通过 toast 撤销。
    await rowB.focus()
    await page.keyboard.press('Delete')
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'trash' })
          return rows.some((row) => row.title === '键盘E2E B')
        })
      )
      .toBe(true)
    await expect(page.locator('.toast')).toContainText('已删除「键盘E2E B」')
    await page.locator('.toast-action').click()
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const rows = await window.api.tasks.query({ view: 'trash' })
          return rows.some((row) => row.title === '键盘E2E B')
        })
      )
      .toBe(false)
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
