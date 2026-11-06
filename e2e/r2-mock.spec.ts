import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BUCKET = 'test-bucket'
const INBOX = '00000000-0000-7000-8000-000000000001'
const REMOTE_KEY = 'tickflow/snapshots/remote-device.json'
const objects = new Map<string, string>()
let server: Server
let endpoint = ''

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function remoteSnapshot(): string {
  const now = '2026-11-06T05:00:00.000Z'
  return JSON.stringify({
    version: 1,
    deviceId: 'remote-device',
    updatedAt: now,
    lists: [
      {
        id: INBOX,
        name: '收集箱',
        color: '#f5c542',
        emoji: null,
        sortOrder: 0,
        isInbox: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      }
    ],
    tasks: [
      {
        id: 'remote-task-1',
        listId: INBOX,
        parentId: null,
        title: '来自远端快照',
        notes: 'R2 mock',
        status: 'open',
        priority: 1,
        dueDate: null,
        dueTime: null,
        allDay: true,
        startDate: null,
        recurrence: null,
        pinned: false,
        sortOrder: 0,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        tagNames: ['远端']
      }
    ]
  })
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const contents = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => `<Contents><Key>${escapeXml(key)}</Key></Contents>`)
        .join('')
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${contents}</ListBucketResult>`
      )
      return
    }
    const key = decodeURIComponent(url.pathname).split('/').slice(2).join('/')
    if (request.method === 'GET') {
      const body = objects.get(key)
      if (body == null) {
        response.writeHead(404)
        response.end()
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(body)
      }
      return
    }
    if (request.method === 'PUT') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        objects.set(key, body)
        response.writeHead(200)
        response.end()
      })
      return
    }
    response.writeHead(405)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  endpoint = `http://127.0.0.1:${address.port}`
  objects.set(REMOTE_KEY, remoteSnapshot())
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('R2 设置页：测试连接、立即同步并合并远端快照', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'tickflow-r2-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: 'F:/projects/tickflow',
    env: { ...process.env, TICKFLOW_USER_DATA: userData } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    // 先建一个本地任务，确认上传快照包含它。
    await page.locator('.quick-add-input').fill('本地同步任务')
    await page.locator('.quick-add-input').press('Enter')
    await expect(page.locator('.task-row', { hasText: '本地同步任务' })).toBeVisible()

    await page.locator('.rail-item[title="设置"]').click()
    await expect(page.locator('.modal h2', { hasText: '设置' })).toBeVisible()

    const field = (label: string) =>
      page.locator('.sync-grid .field', { hasText: label }).locator('input')
    await field('Endpoint').fill(endpoint)
    await field('Bucket').fill(BUCKET)
    await field('Access Key ID').fill('test-key')
    await field('Secret Access Key').fill('test-secret')

    const syncSection = page.locator('.settings-section', { hasText: '同步（Cloudflare R2）' })
    await syncSection.getByRole('button', { name: '测试连接' }).click()
    await expect(page.locator('.toast')).toContainText('R2 连接成功')

    await syncSection.getByRole('button', { name: '立即同步' }).click()
    await expect(page.locator('.toast')).toContainText('同步完成', { timeout: 15_000 })
    await expect(page.locator('.toast')).toContainText('下载 1 份快照')

    // 快照已上传到 mock，且包含本地任务。
    const uploaded = [...objects.entries()].filter(([key]) => key !== REMOTE_KEY)
    expect(uploaded).toHaveLength(1)
    const payload = JSON.parse(uploaded[0]![1]) as {
      tasks: Array<{ title: string }>
    }
    expect(payload.tasks.some((task) => task.title === '本地同步任务')).toBe(true)

    // 关闭设置，回到收集箱查看远端任务已合并。
    await page.keyboard.press('Escape')
    await page.locator('.rail-item[title="收集箱"]').click()
    await expect(page.locator('.task-row', { hasText: '来自远端快照' })).toBeVisible()
    await expect(page.locator('.task-row', { hasText: '本地同步任务' })).toBeVisible()
  } finally {
    await app.close()
  }
})
