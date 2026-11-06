#!/usr/bin/env node
// 任务列表渲染基线：创建 N 个任务后重载，统计从重载到全部行可用的耗时。
// 用法：npm run perf:list -- 800
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const count = Number(process.argv[2] ?? 800)
const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-perf-'))
const env = { ...process.env, TICKFLOW_USER_DATA: dataDir }
const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.main-title', { timeout: 30_000 })
  await page.evaluate(async (total) => {
    const lists = await window.api.lists.list()
    const inbox = lists.find((list) => list.isInbox)
    if (!inbox) throw new Error('缺少收集箱')
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    for (let i = 0; i < total; i += 50) {
      await Promise.all(
        Array.from({ length: Math.min(50, total - i) }, (_, offset) =>
          window.api.tasks.create({
            listId: inbox.id,
            title: `性能任务 ${i + offset}`,
            dueDate: today,
            allDay: true
          })
        )
      )
    }
  }, count)

  await page.addInitScript(() => {
    window.__perfStart = performance.now()
  })
  const started = Date.now()
  await page.reload()
  await page.waitForFunction(
    (total) => document.querySelectorAll('.task-row').length >= total,
    count,
    { timeout: 60_000 }
  )
  const wallMs = Date.now() - started
  const pageMs = await page.evaluate(() => performance.now() - (window.__perfStart ?? 0))
  console.log(
    `任务数 ${count}：重载到全部行可用 ${wallMs}ms（页内 ${Math.round(pageMs)}ms）`
  )
} finally {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
