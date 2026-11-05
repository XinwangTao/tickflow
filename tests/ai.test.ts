import { describe, expect, it, vi } from 'vitest'
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  aiConfigFromSettings,
  buildSummaryInput,
  normalizeAiQuickAdd,
  parseAiJson,
  ruleSubtasks,
  type AiConfig,
  type AiSummaryInput
} from '../src/shared/ai'
import {
  breakdownSubtasksWithAi,
  parseQuickAddWithAi,
  summarizeTodayWithAi,
  testAiConnection
} from '../src/main/ai'
import type { FetchLike } from '../src/main/ai-client'
import type { TaskWithMeta } from '../src/shared/types'

const NOW = new Date(2026, 10, 5, 9, 0, 0)

const CONFIG: AiConfig = {
  enabled: true,
  baseUrl: AI_DEFAULT_BASE_URL,
  model: AI_DEFAULT_MODEL,
  token: 'local-token',
  timeoutMs: 5000
}

function responseWith(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  } as unknown as Response
}

function textResponse(text: string): Response {
  return responseWith({ content: [{ type: 'text', text }] })
}

function failFetch(message = 'connect ECONNREFUSED'): FetchLike {
  return vi.fn(async () => {
    throw new Error(message)
  })
}

describe('parseAiJson', () => {
  it('提取 Markdown 代码块与前后解释中的 JSON', () => {
    expect(parseAiJson('```json\n{"title":"写周报"}\n```')).toEqual({ title: '写周报' })
    expect(parseAiJson('好的，结果如下：{"a":{"b":[1,2]}} 请查收')).toEqual({ a: { b: [1, 2] } })
    expect(parseAiJson('[{"title":"A"}]')).toEqual([{ title: 'A' }])
  })

  it('非法内容返回 null', () => {
    expect(parseAiJson('没有 JSON')).toBeNull()
    expect(parseAiJson('{"title": }')).toBeNull()
  })
})

describe('normalizeAiQuickAdd', () => {
  it('收敛优先级、日期、标签与清单', () => {
    const result = normalizeAiQuickAdd(
      {
        title: ' 交周报 ',
        dueDate: '2026-11-06',
        dueTime: '9:5',
        priority: 9,
        tags: ['#工作', '工作', ' 重要 '],
        listName: ' 工作 ',
        recurrence: 'freq=weekly;byday=mo'
      },
      NOW
    )
    expect(result).toEqual({
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '09:05',
      allDay: false,
      priority: 3,
      tags: ['工作', '重要'],
      listName: '工作',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO'
    })
  })

  it('丢弃非法日期并保留标题；无标题返回 null', () => {
    const result = normalizeAiQuickAdd({ title: '写周报', dueDate: '2026-02-30' }, NOW)
    expect(result?.dueDate).toBeNull()
    expect(normalizeAiQuickAdd({ title: '  ' }, NOW)).toBeNull()
  })
})

describe('aiConfigFromSettings', () => {
  it('缺省时回落到本机 CC Switch 默认值', () => {
    const config = aiConfigFromSettings({
      aiEnabled: true,
      aiBaseUrl: '  ',
      aiModel: '',
      aiToken: '',
      aiTimeoutMs: 0
    })
    expect(config.baseUrl).toBe(AI_DEFAULT_BASE_URL)
    expect(config.model).toBe(AI_DEFAULT_MODEL)
    expect(config.timeoutMs).toBe(15000)
  })

  it('保留开关并限制超时范围', () => {
    const config = aiConfigFromSettings({
      aiEnabled: false,
      aiBaseUrl: 'http://127.0.0.1:15721/',
      aiModel: 'custom-model',
      aiToken: ' tk ',
      aiTimeoutMs: 999999
    })
    expect(config.enabled).toBe(false)
    expect(config.token).toBe('tk')
    expect(config.timeoutMs).toBe(120000)
  })
})

describe('parseQuickAddWithAi', () => {
  it('调用 /v1/messages，校验 anthropic-version 与模型名', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return textResponse(
        JSON.stringify({
          title: '交周报',
          dueDate: '2026-11-06',
          dueTime: '15:00',
          allDay: false,
          priority: 3,
          tags: ['工作'],
          listName: '工作',
          recurrence: null
        })
      )
    }

    const response = await parseQuickAddWithAi('明天下午三点交周报，放工作清单', ['收集箱', '工作'], {
      config: CONFIG,
      now: NOW,
      fetch: fetchImpl
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.result.title).toBe('交周报')
    expect(response.result.listName).toBe('工作')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:15721/v1/messages')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['x-api-key']).toBe('local-token')
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(body.model).toBe(AI_DEFAULT_MODEL)
    expect(body.messages).toBeTruthy()
  })

  it('请求失败时降级为规则解析且不抛错', async () => {
    const response = await parseQuickAddWithAi('明天下午3点 交周报 #工作 !高', [], {
      config: CONFIG,
      now: NOW,
      fetch: failFetch()
    })

    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.result.title).toBe('交周报')
    expect(response.result.dueDate).toBe('2026-11-06')
    expect(response.result.dueTime).toBe('15:00')
    expect(response.result.priority).toBe(3)
    expect(response.result.tags).toEqual(['工作'])
    expect(response.warning).toContain('ECONNREFUSED')
  })

  it('AI 关闭时不发请求，直接使用规则解析', async () => {
    const fetchImpl = vi.fn()
    const response = await parseQuickAddWithAi('今天 买菜', [], {
      config: { ...CONFIG, enabled: false },
      now: NOW,
      fetch: fetchImpl as unknown as FetchLike
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(response.source).toBe('rule')
    expect(response.result.title).toBe('买菜')
    expect(response.result.dueDate).toBe('2026-11-05')
  })

  it('AI 返回非法结构时降级', async () => {
    const response = await parseQuickAddWithAi('写周报', [], {
      config: CONFIG,
      now: NOW,
      fetch: async () => textResponse('我不太确定')
    })
    expect(response.ok).toBe(false)
    expect(response.result.title).toBe('写周报')
  })
})

describe('breakdownSubtasksWithAi', () => {
  it('解析 AI 返回的子任务', async () => {
    const response = await breakdownSubtasksWithAi(
      { title: '准备季度汇报', notes: '收集数据；写幻灯片', listName: '工作' },
      {
        config: CONFIG,
        fetch: async () =>
          textResponse(
            JSON.stringify({
              subtasks: [
                { title: '收集数据', priority: 2 },
                { title: '写幻灯片' }
              ]
            })
          )
      }
    )

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.subtasks.map((item) => item.title)).toEqual(['收集数据', '写幻灯片'])
    expect(response.subtasks[0].priority).toBe(2)
  })

  it('AI 不可用时按备注换行/分号规则拆解', async () => {
    const response = await breakdownSubtasksWithAi(
      { title: '准备季度汇报', notes: '1. 收集数据；2. 写幻灯片' },
      { config: CONFIG, fetch: failFetch('timeout') }
    )

    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.subtasks.map((item) => item.title)).toEqual(['收集数据', '写幻灯片'])
    expect(response.warning).toContain('timeout')
  })

  it('规则拆解不会返回与主任务同名的子任务', () => {
    expect(ruleSubtasks({ title: '写周报' })).toEqual([])
  })
})

describe('summarizeTodayWithAi', () => {
  const input: AiSummaryInput = {
    date: '2026-11-05',
    tasks: [
      {
        title: '交周报',
        status: 'open',
        priority: 3,
        dueDate: '2026-11-04',
        dueTime: '10:00',
        listName: '工作'
      },
      {
        title: '整理会议纪要',
        status: 'completed',
        priority: 1,
        dueDate: '2026-11-05',
        dueTime: null,
        listName: '工作'
      }
    ],
    completedCount: 1,
    openCount: 1,
    overdueCount: 1
  }

  it('解析 AI 总结', async () => {
    const response = await summarizeTodayWithAi(input, {
      config: CONFIG,
      fetch: async () =>
        textResponse(
          JSON.stringify({
            summary: '今天有 1 个逾期任务需要优先处理。',
            highlights: ['交周报已逾期'],
            suggestions: ['先完成交周报']
          })
        )
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.summary.summary).toContain('逾期')
    expect(response.summary.suggestions).toEqual(['先完成交周报'])
  })

  it('AI 不可用时生成基于统计的本地总结', async () => {
    const response = await summarizeTodayWithAi(input, {
      config: CONFIG,
      fetch: failFetch()
    })

    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.summary.summary).toContain('剩余 1 个')
    expect(response.summary.summary).toContain('1 个已逾期')
    expect(response.summary.suggestions[0]).toContain('先处理逾期任务')
  })
})

describe('buildSummaryInput', () => {
  it('只保留今日相关任务并统计完成/逾期', () => {
    const base = {
      dueTime: null,
      listName: '收集箱',
      priority: 0,
      completedAt: null
    }
    const tasks = [
      { ...base, id: '1', title: '今日任务', status: 'open', dueDate: '2026-11-05' },
      { ...base, id: '2', title: '逾期任务', status: 'open', dueDate: '2026-11-03' },
      {
        ...base,
        id: '3',
        title: '今天完成',
        status: 'completed',
        dueDate: null,
        completedAt: '2026-11-05T08:00:00.000Z'
      },
      { ...base, id: '4', title: '以后的任务', status: 'open', dueDate: '2026-11-20' }
    ] as unknown as TaskWithMeta[]

    const input = buildSummaryInput(tasks, '2026-11-05')
    expect(input.tasks.map((task) => task.title)).toEqual(['今日任务', '逾期任务', '今天完成'])
    expect(input.openCount).toBe(2)
    expect(input.completedCount).toBe(1)
    expect(input.overdueCount).toBe(1)
  })
})

describe('testAiConnection', () => {
  it('成功时返回模型与耗时', async () => {
    const result = await testAiConnection(CONFIG, { fetch: async () => textResponse('OK') })
    expect(result.ok).toBe(true)
    expect(result.model).toBe(AI_DEFAULT_MODEL)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('失败时返回可展示的错误信息', async () => {
    const result = await testAiConnection(CONFIG, { fetch: failFetch('本地服务未启动') })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('本地服务未启动')
  })
})
