#!/usr/bin/env node
// 无真机 UI 校验：用 Electron 加载移动端 Web 构建，验证多选、批量完成与批量删除。
// 用法：npm run check:mobile-web（需先 cd mobile && npm run build）
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-mobile-ui-'))
const port = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port: freePort } = probe.address()
    probe.close(() => resolve(freePort))
  })
})
const mainFile = join(dataDir, 'main.cjs')
writeFileSync(
  mainFile,
  `const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.env.TF_USER_DATA)
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 430, height: 900, webPreferences: { contextIsolation: true } })
  win.loadURL('http://127.0.0.1:${port}/')
})
app.on('window-all-closed', () => app.quit())
`
)

const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(port), '--strictPort'], {
  cwd: join(root, 'mobile'),
  shell: true,
  stdio: 'ignore'
})

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('vite preview 未启动')
}

let app
try {
  await waitServer()
  app = await electron.launch({ args: [mainFile], env: { ...process.env, TF_USER_DATA: dataDir } })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await page.waitForSelector('.bottom-nav', { timeout: 30_000 })

  const addTask = async (title) => {
    await page.locator('.fab').click()
    await page.waitForSelector('.quick-input')
    await page.locator('.quick-input').fill(title)
    await page.keyboard.press('Enter')
    await expect(page.locator('.quick-input')).toHaveCount(0)
    await expect(page.locator('.task-row', { hasText: title })).toBeVisible()
  }

  await addTask('多选 A')
  await addTask('多选 B')
  await expect(page.getByLabel('多选任务')).toBeVisible()

  // 长按进入多选并选中第一项。
  const first = page.locator('.task-row', { hasText: '多选 A' })
  const box = await first.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  await expect(page.locator('.batch-bar')).toBeVisible()
  await expect(page.locator('.batch-count')).toHaveText('已选 1 项')

  await page.locator('.task-row', { hasText: '多选 B' }).click()
  await expect(page.locator('.batch-count')).toHaveText('已选 2 项')

  await page.locator('.batch-btn', { hasText: '完成' }).click()
  await expect(page.locator('.batch-bar')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(0)

  await addTask('待删除任务')
  await page.getByLabel('多选任务').click()
  await expect(page.locator('.batch-count')).toHaveText('已选 0 项')
  await page.locator('.task-row', { hasText: '待删除任务' }).click()
  await expect(page.locator('.batch-count')).toHaveText('已选 1 项')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.batch-btn.danger').click()
  await expect(page.locator('.batch-bar')).toHaveCount(0)
  await expect(page.locator('.task-row')).toHaveCount(0)

  // 搜索历史：回车记录、清除、刷新后仍保留。
  await addTask('搜索历史任务')
  await page.getByLabel('搜索').click()
  await page.locator('.quick-input').fill('搜索历史')
  await page.locator('.quick-input').press('Enter')
  await expect(page.locator('.task-row', { hasText: '搜索历史任务' })).toBeVisible()
  await page.getByLabel('关闭').click()

  await page.getByLabel('搜索').click()
  await expect(page.locator('.recent-chip', { hasText: '搜索历史' })).toHaveCount(1)
  await page.locator('.recent-head .text-btn').click()
  await expect(page.locator('.recent-chip')).toHaveCount(0)

  await page.locator('.quick-input').fill('持久化搜索')
  await page.locator('.quick-input').press('Enter')
  await page.getByLabel('关闭').click()
  await page.reload()
  await page.waitForSelector('.bottom-nav', { timeout: 30_000 })
  await page.getByLabel('搜索').click()
  await expect(page.locator('.recent-chip', { hasText: '持久化搜索' })).toHaveCount(1)

  console.log('移动端多选 / 批量完成 / 批量删除 / 搜索历史校验通过')
} finally {
  if (app) await app.close()
  server.kill()
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
