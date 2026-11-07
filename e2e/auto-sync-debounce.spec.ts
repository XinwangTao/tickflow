import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TickFlowApi } from '../src/shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

const BUCKET = 'debounce-bucket'
let server: Server
let endpoint = ''
let putCount = 0
const objects = new Map<string, string>()

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const contents = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => `<Contents><Key>${key}</Key></Contents>`)
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
        putCount += 1
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
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('变更后 3 秒防抖自动同步，多次写入只上传一次', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'tickflow-autosync-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: 'F:/projects/tickflow',
    env: { ...process.env, TICKFLOW_USER_DATA: userData } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    await page.locator('.rail-item[title="设置"]').click()
    await expect(page.locator('.modal h2', { hasText: '设置' })).toBeVisible()

    const field = (label: string) =>
      page.locator('.sync-grid .field', { hasText: label }).locator('input')
    await field('Endpoint').fill(endpoint)
    await field('Bucket').fill(BUCKET)
    await field('Access Key ID').fill('test-key')
    await field('Secret Access Key').fill('test-secret')

    const switchRow = page.locator('.settings-row', { hasText: '启动时自动同步' })
    await switchRow.locator('button.switch').click()
    await expect(switchRow.locator('button.switch')).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: '保存配置' }).click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('.quick-add-input')

    // 等启动同步落定，避免把启动那次 PUT 算进防抖窗口。
    await page.waitForTimeout(4000)
    putCount = 0

    // 连续添加三条任务，验证防抖窗口内不会提前同步。
    for (const title of ['防抖 A', '防抖 B', '防抖 C']) {
      await page.locator('.quick-add-input').fill(title)
      await page.locator('.quick-add-input').press('Enter')
      await expect(page.locator('.task-row', { hasText: title })).toBeVisible()
    }
    await page.waitForTimeout(1500)
    expect(putCount).toBe(0)

    await expect.poll(() => putCount, { timeout: 15_000 }).toBe(1)
    await page.waitForTimeout(2000)
    expect(putCount).toBe(1)

    const uploaded = [...objects.values()][0] ?? ''
    const payload = JSON.parse(uploaded) as { tasks: Array<{ title: string }> }
    expect(
      ['防抖 A', '防抖 B', '防抖 C'].every((title) =>
        payload.tasks.some((task) => task.title === title)
      )
    ).toBe(true)

    const settings = await page.evaluate(() => window.api.settings.get())
    expect(settings.r2LastSync).toBeTruthy()
    expect(settings.r2LastError).toBe('')
  } finally {
    await app.close()
  }
})

test('自动同步失败时在设置页显示原因', async () => {
  test.setTimeout(60_000)
  const putBefore = putCount
  const userData = mkdtempSync(join(tmpdir(), 'tickflow-autosync-fail-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: 'F:/projects/tickflow',
    env: { ...process.env, TICKFLOW_USER_DATA: userData } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.main-title', { timeout: 20_000 })

    await page.locator('.rail-item[title="设置"]').click()
    await expect(page.locator('.modal h2', { hasText: '设置' })).toBeVisible()
    const field = (label: string) =>
      page.locator('.sync-grid .field', { hasText: label }).locator('input')
    await field('Endpoint').fill('http://127.0.0.1:9')
    await field('Bucket').fill(BUCKET)
    await field('Access Key ID').fill('test-key')
    await field('Secret Access Key').fill('test-secret')
    const switchRow = page.locator('.settings-row', { hasText: '启动时自动同步' })
    await switchRow.locator('button.switch').click()
    await page.getByRole('button', { name: '保存配置' }).click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('.quick-add-input')

    // 写一条任务触发防抖同步，失败原因应写回设置。
    await page.locator('.quick-add-input').fill('失败路径任务')
    await page.locator('.quick-add-input').press('Enter')

    await expect
      .poll(
        async () =>
          page.evaluate(async () => (await window.api.settings.get()).r2LastError ?? ''),
        { timeout: 20_000 }
      )
      .not.toBe('')

    await page.locator('.rail-item[title="设置"]').click()
    await expect(page.locator('.settings-error')).toContainText('上次同步失败')
    expect(putCount).toBe(putBefore)
  } finally {
    await app.close()
  }
})
