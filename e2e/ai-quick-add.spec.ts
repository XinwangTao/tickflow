import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AI_DEFAULT_MODEL,
  AI_QUICK_ADD_MAX_TOKENS,
  AI_SUBTASKS_MAX_TOKENS,
  AI_SUMMARY_MAX_TOKENS
} from '../src/shared/ai'

/**
 * AI 结果的桌面端 E2E：
 * - 只连本机 127.0.0.1 的假网关，不访问外网；
 * - 每次启动使用独立 TICKFLOW_USER_DATA，绝不写真实用户数据库；
 * - 覆盖「AI 草稿可编辑 → 添加 → 撤销」与「5xx 自动重试 → 规则降级 → 撤销」。
 */

interface RecordedRequest {
  method: string
  path: string
  model: string | null
  maxTokens: number | null
  authorization: string | null
  body: Record<string, unknown>
}

interface FakeGateway {
  baseUrl: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

type GatewayReply = { status: number; body: unknown; delayMs?: number }

type GatewayHandler = (request: RecordedRequest, index: number) => GatewayReply

async function startFakeGateway(handler: GatewayHandler): Promise<FakeGateway> {
  const requests: RecordedRequest[] = []

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: Record<string, unknown> = {}
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        model: typeof parsed['model'] === 'string' ? (parsed['model'] as string) : null,
        maxTokens:
          typeof parsed['max_tokens'] === 'number' ? (parsed['max_tokens'] as number) : null,
        authorization:
          typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : null,
        body: parsed
      }
      requests.push(recorded)

      const reply = handler(recorded, requests.length - 1)
      // delayMs 用来模拟推理模型的长响应，让「取消」有机会在返回之前发生。
      const send = (): void => {
        try {
          res.writeHead(reply.status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(reply.body))
        } catch {
          // 请求已被客户端中止，连接可能已关闭，忽略写入失败。
        }
      }
      if (reply.delayMs) setTimeout(send, reply.delayMs)
      else send()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('假网关未能获取端口')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

function anthropicReply(text: string, stopReason = 'end_turn'): unknown {
  return {
    id: 'msg_tickflow_e2e',
    type: 'message',
    role: 'assistant',
    model: AI_DEFAULT_MODEL,
    content: [{ type: 'text', text }],
    stop_reason: stopReason
  }
}

function localDateKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

interface LaunchedApp {
  app: ElectronApplication
  page: Page
  dataDir: string
  close: () => Promise<void>
}

interface IsolatedAiSettings {
  aiEnabled?: boolean
  aiTimeoutMs?: number
}

async function launchIsolatedApp(
  gatewayUrl: string,
  overrides: IsolatedAiSettings = {}
): Promise<LaunchedApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'tickflow-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TICKFLOW_USER_DATA: dataDir } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.main-title', { timeout: 30_000 })

  // 真实设置链路：写入独立数据库后重载 renderer，让 store 读到假网关地址。
  await page.evaluate(
    async (config) => {
      await window.api.settings.set(config)
    },
    {
      aiEnabled: true,
      aiBaseUrl: gatewayUrl,
      aiModel: AI_DEFAULT_MODEL,
      aiToken: '',
      aiTimeoutMs: 5000,
      ...overrides
    }
  )
  await page.reload()
  await page.waitForSelector('.main-title', { timeout: 30_000 })

  return {
    app,
    page,
    dataDir,
    close: async () => {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

async function allTaskTitles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const tasks = await window.api.tasks.query({ view: 'all' })
    return tasks.map((task) => task.title)
  })
}

test.describe('AI 快速添加结果', () => {
  test('草稿可编辑，添加后可从 toast 撤销', async () => {
    const dueDate = localDateKey()
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        '```json\n' +
          JSON.stringify({
            title: '交周报',
            dueDate,
            dueTime: '15:00',
            allDay: false,
            priority: 3,
            tags: ['工作', '重点'],
            listName: null,
            recurrence: null
          }) +
          '\n```'
      )
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const input = page.locator('.quick-add-input')
      await input.fill('明天下午3点交周报')
      await page.locator('.quick-add-ai').click()

      const draft = page.getByRole('dialog', { name: 'AI 解析结果' })
      await expect(draft).toBeVisible()
      await expect(draft.getByLabel('AI 任务标题')).toHaveValue('交周报')
      await expect(draft.getByLabel('AI 截止日期')).toHaveValue(dueDate)
      await expect(draft.getByLabel('AI 截止时间')).toHaveValue('15:00')
      await expect(draft.getByLabel('AI 优先级')).toHaveValue('3')

      // 草稿展示期间不写库。
      expect(await allTaskTitles(page)).toEqual([])

      // 编辑标题与优先级后再添加。
      await draft.getByLabel('AI 任务标题').fill('交周报（终稿）')
      await draft.getByLabel('AI 优先级').selectOption('2')
      await draft.getByRole('button', { name: '添加', exact: true }).click()

      await expect(draft).toHaveCount(0)
      await expect(page.locator('.task-title', { hasText: '交周报（终稿）' })).toBeVisible()
      expect(await allTaskTitles(page)).toEqual(['交周报（终稿）'])

      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 已添加「交周报（终稿）」')
      await toast.locator('.toast-action').click()

      await expect.poll(() => allTaskTitles(page)).toEqual([])

      // 请求契约：只发到本机假网关的 /v1/messages，模型 ID 逐字一致。
      expect(gateway.requests).toHaveLength(1)
      expect(gateway.requests[0].method).toBe('POST')
      expect(gateway.requests[0].path).toBe('/v1/messages')
      expect(gateway.requests[0].model).toBe(AI_DEFAULT_MODEL)
      expect(gateway.requests[0].maxTokens).toBe(AI_QUICK_ADD_MAX_TOKENS)
      expect(gateway.requests[0].authorization).toBeNull()
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('服务 5xx 时自动重试一次，失败后按规则创建且可撤销', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 500,
      body: { type: 'error', error: { type: 'api_error', message: 'mock upstream exploded' } }
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      await page.locator('.quick-add-input').fill('写周报 #重点')
      await page.locator('.quick-add-ai').click()

      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 未能解析，已按规则添加「写周报」', {
        timeout: 15_000
      })
      await expect(toast).toContainText('AI 服务繁忙')
      await expect(toast).toContainText('已自动重试 1 次')
      await expect(page.getByRole('dialog', { name: 'AI 解析结果' })).toHaveCount(0)
      expect(gateway.requests).toHaveLength(2)

      await expect(page.locator('.task-title', { hasText: '写周报' })).toBeVisible()
      expect(await allTaskTitles(page)).toEqual(['写周报'])

      await toast.locator('.toast-action').click()
      await expect.poll(() => allTaskTitles(page)).toEqual([])
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('今日总结使用 AI 结果并展示重点与建议', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        '```json\n' +
          JSON.stringify({
            summary: '今天还有 2 项任务待完成，建议先处理高优先级事项。',
            highlights: ['《交周报》优先级最高', '已完成 1 项'],
            suggestions: ['先花 25 分钟处理交周报', '把剩余任务拆成更小的步骤']
          }) +
          '\n```'
      )
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const card = page.locator('.ai-summary-card')
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: '生成' }).click()

      await expect(card.locator('.ai-summary-text')).toHaveText(
        '今天还有 2 项任务待完成，建议先处理高优先级事项。'
      )
      await expect(card.locator('.ai-summary-list li')).toHaveText([
        '《交周报》优先级最高',
        '已完成 1 项',
        '先花 25 分钟处理交周报',
        '把剩余任务拆成更小的步骤'
      ])
      // 来源是 AI 时不显示“已回落到本地统计”的说明。
      await expect(card.locator('.ai-summary-note')).toHaveCount(0)

      expect(gateway.requests).toHaveLength(1)
      expect(gateway.requests[0].path).toBe('/v1/messages')
      expect(gateway.requests[0].model).toBe(AI_DEFAULT_MODEL)
      expect(gateway.requests[0].maxTokens).toBe(AI_SUMMARY_MAX_TOKENS)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('AI 拆解子任务先展示可编辑草稿，确认添加后可批量撤销', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({
          subtasks: [
            { title: '整理季度数据', priority: 2 },
            { title: '撰写复盘结论', priority: 0 }
          ]
        })
      )
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      // 先用普通回车（规则解析）建主任务，再进入详情面板。
      await page.locator('.quick-add-input').fill('准备季度复盘')
      await page.locator('.quick-add-input').press('Enter')
      await page.locator('.task-row', { hasText: '准备季度复盘' }).click()

      const drawer = page.getByLabel('任务详情')
      await expect(drawer).toBeVisible()
      await drawer.getByLabel('AI 拆解子任务').click()

      const draft = drawer.getByRole('group', { name: 'AI 拆解结果' })
      await expect(draft).toBeVisible()
      await expect(draft.getByLabel('子任务标题 1')).toHaveValue('整理季度数据')
      await expect(draft.getByLabel('子任务标题 2')).toHaveValue('撰写复盘结论')
      // 草稿展示期间不写库。
      await expect(drawer.locator('.subtask-title')).toHaveCount(0)

      // 改标题、取消勾选第二条，只添加选中的一条。
      await draft.getByLabel('子任务标题 1').fill('整理季度原始数据')
      await draft.getByLabel('选择子任务 2').uncheck()
      await draft.getByRole('button', { name: /添加选中/ }).click()

      await expect(draft).toHaveCount(0)
      await expect(drawer.locator('.subtask-title')).toHaveText(['整理季度原始数据'])
      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 已添加 1 个子任务')

      await toast.locator('.toast-action').click()
      await expect(drawer.locator('.subtask-title')).toHaveCount(0)

      // 只请求一次拆解接口，预算使用子任务专用 max_tokens。
      expect(gateway.requests).toHaveLength(1)
      expect(gateway.requests[0].path).toBe('/v1/messages')
      expect(gateway.requests[0].model).toBe(AI_DEFAULT_MODEL)
      expect(gateway.requests[0].maxTokens).toBe(AI_SUBTASKS_MAX_TOKENS)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('取消 AI 解析后不弹草稿，迟到的响应也不会写库', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({
          title: '迟到的任务',
          dueDate: null,
          dueTime: null,
          allDay: true,
          priority: 0,
          tags: [],
          listName: null,
          recurrence: null
        })
      ),
      // 模拟推理模型的长响应：留出足够时间点「取消」。
      delayMs: 2500
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const input = page.locator('.quick-add-input')
      await input.fill('明天下午3点交周报')
      await page.locator('.quick-add-ai').click()

      // 请求还没返回时出现「取消」，点它中止这次解析。
      await page.getByRole('button', { name: '取消 AI 解析' }).click()
      const toast = page.locator('.toast')
      await expect(toast).toContainText('已取消 AI 解析，输入内容已保留')

      // 等过假网关的延迟：迟到的响应不能弹出草稿，也不能按规则建任务。
      await page.waitForTimeout(3000)
      await expect(page.getByRole('dialog', { name: 'AI 解析结果' })).toHaveCount(0)
      expect(await allTaskTitles(page)).toEqual([])
      await expect(input).toHaveValue('明天下午3点交周报')
      // 取消不重试：只发出过一次请求。
      expect(gateway.requests).toHaveLength(1)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('今日总结可取消，迟到的结果不会覆盖卡片', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({ summary: '迟到的总结', highlights: [], suggestions: [] })
      ),
      // 模拟推理模型的长响应：留出足够时间点「取消」。
      delayMs: 2500
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const card = page.locator('.ai-summary-card')
      await card.getByRole('button', { name: '生成' }).click()

      // 请求途中出现「取消」，点它中止这次生成。
      await card.getByLabel('取消 AI 总结生成').click()
      await expect(page.locator('.toast')).toContainText('已取消 AI 总结生成')

      // 等过假网关的延迟：迟到的结果不能渲染到卡片上。
      await page.waitForTimeout(3000)
      await expect(card.locator('.ai-summary-text')).toHaveCount(0)
      await expect(card.getByRole('button', { name: '生成' })).toBeEnabled()
      // 取消不重试：只发出过一次请求。
      expect(gateway.requests).toHaveLength(1)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('关闭详情面板会中止进行中的子任务拆解，迟到的结果不写库', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({ subtasks: [{ title: '迟到的子任务', priority: 1 }] })
      ),
      delayMs: 2500
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      // 先用普通回车建主任务，再从详情面板触发 AI 拆解。
      await page.locator('.quick-add-input').fill('准备季度复盘')
      await page.locator('.quick-add-input').press('Enter')
      await page.locator('.task-row', { hasText: '准备季度复盘' }).click()

      const drawer = page.getByLabel('任务详情')
      await drawer.getByLabel('AI 拆解子任务').click()
      await expect(drawer.getByLabel('取消 AI 拆解')).toBeVisible()

      // 不等结果直接关面板：组件卸载应中止这次 fetch，而不是在后台跑满超时。
      await drawer.getByLabel('关闭详情').click()
      await expect(drawer).toHaveCount(0)

      // 等过假网关的延迟后重新打开：既没有迟到的草稿，也没有写入子任务。
      await page.waitForTimeout(3000)
      await page.locator('.task-row', { hasText: '准备季度复盘' }).click()
      const reopened = page.getByLabel('任务详情')
      await expect(reopened).toBeVisible()
      await expect(reopened.locator('.subtask-title')).toHaveCount(0)
      await expect(reopened.getByRole('group', { name: 'AI 拆解结果' })).toHaveCount(0)
      expect(gateway.requests).toHaveLength(1)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })
})

test.describe('AI 失败与边界路径', () => {
  test('关闭 AI 后隐藏入口，普通回车仍按规则创建且不发请求', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(JSON.stringify({ title: '不应被调用' }))
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl, { aiEnabled: false })

    try {
      const { page } = launched
      await expect(page.locator('.quick-add-ai')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '取消 AI 解析' })).toHaveCount(0)
      await expect(page.locator('.ai-summary-card')).toHaveCount(0)

      await page.locator('.quick-add-input').fill('写周报 #重点 !高')
      await page.locator('.quick-add-input').press('Enter')

      await expect.poll(() => allTaskTitles(page)).toEqual(['写周报'])
      // 关闭 AI 后连模型目录都不该访问，更不该发解析请求。
      expect(gateway.requests).toHaveLength(0)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('请求超时提示秒数且不自动重试，任务按规则创建后可撤销', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({
          title: '迟到的结果',
          dueDate: null,
          dueTime: null,
          allDay: true,
          priority: 0,
          tags: [],
          listName: null,
          recurrence: null
        })
      ),
      // 超过下面 1000ms 的超时上限，强制走超时分支。
      delayMs: 2500
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl, { aiTimeoutMs: 1000 })

    try {
      const { page } = launched
      await page.locator('.quick-add-input').fill('写周报')
      await page.locator('.quick-add-ai').click()

      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 未能解析，已按规则添加「写周报」', {
        timeout: 15_000
      })
      await expect(toast).toContainText('AI 请求超时（1 秒）')
      await expect(toast).not.toContainText('已自动重试')
      expect(await allTaskTitles(page)).toEqual(['写周报'])

      // 超时已经用满等待预算：只发一次请求，不会在后台再试。
      await page.waitForTimeout(500)
      expect(gateway.requests).toHaveLength(1)

      await toast.locator('.toast-action').click()
      await expect.poll(() => allTaskTitles(page)).toEqual([])
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('解析期间改写输入时，迟到的 AI 结果被丢弃', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 200,
      body: anthropicReply(
        JSON.stringify({
          title: '旧输入的任务',
          dueDate: null,
          dueTime: null,
          allDay: true,
          priority: 0,
          tags: [],
          listName: null,
          recurrence: null
        })
      ),
      delayMs: 1200
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const input = page.locator('.quick-add-input')
      await input.fill('明天下午3点交周报')
      await page.locator('.quick-add-ai').click()

      // 等待期间改写输入：旧句子的解析结果不能再套到新输入上。
      await input.fill('今晚写总结')

      const toast = page.locator('.toast')
      await expect(toast).toContainText('输入已变化，已忽略上一次 AI 解析结果', {
        timeout: 10_000
      })
      await expect(page.getByRole('dialog', { name: 'AI 解析结果' })).toHaveCount(0)
      expect(await allTaskTitles(page)).toEqual([])
      await expect(input).toHaveValue('今晚写总结')
      expect(gateway.requests).toHaveLength(1)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('今日总结失败后从 toast 重试即可恢复 AI 结果', async () => {
    let attempts = 0
    const gateway = await startFakeGateway(() => {
      attempts += 1
      // 第一次 summary 含自动重试共 2 次请求，之后恢复，验证 toast 上的「重试」入口。
      return attempts <= 2
        ? { status: 500, body: { type: 'error', error: { message: 'mock summary down' } } }
        : {
            status: 200,
            body: anthropicReply(
              JSON.stringify({
                summary: 'AI 恢复后的总结',
                highlights: ['恢复重点'],
                suggestions: ['恢复建议']
              })
            )
          }
    })
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      const card = page.locator('.ai-summary-card')
      await card.getByRole('button', { name: '生成' }).click()

      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 总结不可用，已使用本地统计生成', {
        timeout: 15_000
      })
      await expect(toast).toContainText('AI 服务繁忙')
      await expect(card.locator('.ai-summary-note')).toContainText(
        'AI 不可用，已使用本地统计生成'
      )
      expect(gateway.requests).toHaveLength(2)

      await toast.locator('.toast-action').click()
      await expect(card.locator('.ai-summary-text')).toHaveText('AI 恢复后的总结')
      await expect(card.locator('.ai-summary-note')).toHaveCount(0)
      expect(gateway.requests).toHaveLength(3)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('子任务拆解失败后按规则一步添加，并可通过 toast 撤销', async () => {
    const gateway = await startFakeGateway(() => ({
      status: 500,
      body: { type: 'error', error: { message: 'mock breakdown down' } }
    }))
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      await page.locator('.quick-add-input').fill('准备季度复盘')
      await page.locator('.quick-add-input').press('Enter')
      await page.locator('.task-row', { hasText: '准备季度复盘' }).click()

      const drawer = page.getByLabel('任务详情')
      await expect(drawer).toBeVisible()
      await drawer.getByLabel('任务备注').fill('整理数据；撰写结论')
      // 备注是 500ms 防抖写库，等它真正落库后再触发拆解。
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.api.tasks.query({ view: 'all' }))[0]?.notes)
        )
        .toContain('整理数据')
      await drawer.getByLabel('AI 拆解子任务').click()

      const toast = page.locator('.toast')
      await expect(toast).toContainText('AI 拆解不可用，已按规则添加 2 个子任务', {
        timeout: 15_000
      })
      await expect(toast).toContainText('AI 服务繁忙')
      // 规则结果是确定性的，保持一步添加，不进入二次确认草稿。
      await expect(drawer.locator('.subtask-title')).toHaveText(['整理数据', '撰写结论'])
      expect(gateway.requests).toHaveLength(2)

      await toast.locator('.toast-action').click()
      await expect(drawer.locator('.subtask-title')).toHaveCount(0)
    } finally {
      await launched.close()
      await gateway.close()
    }
  })

  test('设置页从 /v1/models 取模型，选中后逐字用于解析请求', async () => {
    const catalogModel = 'ccs-claude-openai--ccs-claude-openai-2--kimi-k2.7-code'
    const gateway = await startFakeGateway((request) => {
      if (request.method === 'GET' && request.path === '/v1/models') {
        return {
          status: 200,
          body: { data: [{ id: catalogModel, display_name: 'Kimi K2.7 Code' }] }
        }
      }
      return {
        status: 200,
        body: anthropicReply(
          JSON.stringify({
            title: '用目录模型解析',
            dueDate: null,
            dueTime: null,
            allDay: true,
            priority: 0,
            tags: [],
            listName: null,
            recurrence: null
          })
        )
      }
    })
    const launched = await launchIsolatedApp(gateway.baseUrl)

    try {
      const { page } = launched
      await page.locator('.rail-item[title="设置"]').click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await expect(dialog).toBeVisible()

      await dialog.getByRole('button', { name: '获取模型列表' }).click()
      const catalog = dialog.getByLabel(/本机模型/)
      await expect(catalog).toBeVisible()
      // 当前默认模型不在目录中：明确提示，避免用户保存一个不存在的 id。
      await expect(dialog.getByText(/当前模型不在本机 \/v1\/models 列表里/)).toBeVisible()

      await catalog.selectOption(catalogModel)
      await expect(dialog.getByText(/当前模型不在本机 \/v1\/models 列表里/)).toHaveCount(0)
      await dialog.getByRole('button', { name: '保存 AI 配置' }).click()
      await dialog.getByRole('button', { name: '关闭' }).click()
      await expect(dialog).toHaveCount(0)

      await page.locator('.quick-add-input').fill('明天交周报')
      await page.locator('.quick-add-ai').click()
      await expect(page.getByRole('dialog', { name: 'AI 解析结果' })).toBeVisible()

      const models = gateway.requests.filter((request) => request.path === '/v1/models')
      const messages = gateway.requests.filter((request) => request.path === '/v1/messages')
      expect(models).toHaveLength(1)
      expect(models[0].method).toBe('GET')
      expect(messages).toHaveLength(1)
      expect(messages[0].model).toBe(catalogModel)
      expect(messages[0].authorization).toBeNull()
    } finally {
      await launched.close()
      await gateway.close()
    }
  })
})
