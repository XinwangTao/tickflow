import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('永久删除前提示跨端复活风险，取消不删除、确认才删除', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'tickflow-purge-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: 'F:/projects/tickflow',
    env: { ...process.env, TICKFLOW_USER_DATA: userData } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    await page.locator('.quick-add-input').fill('永久删除确认测试')
    await page.locator('.quick-add-input').press('Enter')
    const row = page.locator('.task-row', { hasText: '永久删除确认测试' })
    await expect(row).toBeVisible()

    // 先软删除到垃圾箱
    await row.hover()
    await row.locator('.task-actions .icon-btn.danger[aria-label="删除任务"]').evaluate((el) => (el as HTMLElement).click())
    await expect(row).toBeHidden()

    await page.locator('.side-item[title="垃圾箱"]').click()
    const trashRow = page.locator('.task-row', { hasText: '永久删除确认测试' })
    await expect(trashRow).toBeVisible()

    // 取消：保留任务
    await trashRow.locator('.task-actions [aria-label="永久删除"]').evaluate((el) => (el as HTMLElement).click())
    const dialog = page.locator('.modal[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('永久删除任务')
    await expect(dialog).toContainText('不会生成跨端删除标记')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await expect(trashRow).toBeVisible()

    // 确认：真正永久删除
    await trashRow.locator('.task-actions [aria-label="永久删除"]').evaluate((el) => (el as HTMLElement).click())
    await page.locator('.modal[role="dialog"]').getByRole('button', { name: '仍然永久删除' }).click()
    await expect(trashRow).toBeHidden()
    await expect(page.locator('.toast')).toContainText('任务已永久删除')
  } finally {
    await app.close()
  }
})
