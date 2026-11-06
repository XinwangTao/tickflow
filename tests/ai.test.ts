import { describe, expect, it, vi } from 'vitest'
import {
  AI_CONNECTION_MAX_TOKENS,
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_QUICK_ADD_MAX_TOKENS,
  AI_SUBTASKS_MAX_TOKENS,
  AI_SUMMARY_MAX_TOKENS,
  aiConfigFromSettings,
  buildQuickAddPrompt,
  buildSubtasksPrompt,
  buildSummaryInput,
  buildSummaryPrompt,
  describeAiFailure,
  filterNewSubtasks,
  isListNameMentioned,
  isRetryableAiError,
  localDateKeyFromIso,
  mergeQuickAddWithRule,
  normalizeAiModels,
  normalizeAiQuickAdd,
  parseAiJson,
  ruleQuickAdd,
  ruleSubtasks,
  type AiConfig,
  type AiSummaryInput
} from '../src/shared/ai'
import {
  breakdownSubtasksWithAi,
  listAiModels,
  parseQuickAddWithAi,
  summarizeTodayWithAi,
  testAiConnection
} from '../src/main/ai'
import { resolveModelsUrl, type FetchLike } from '../src/main/ai-client'
import type { QuickAddResult } from '../src/shared/quick-add'
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

function modelsResponse(ids: string[]): Response {
  return responseWith({
    data: ids.map((id) => ({ type: 'model', id, display_name: id.split('--').pop() }))
  })
}

function statusResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body
  } as unknown as Response
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

describe('isListNameMentioned', () => {
  it('只有用户输入里明确出现清单名时才视为提到', () => {
    expect(isListNameMentioned('明天下午3点交周报，放工作清单', '工作')).toBe(true)
    expect(isListNameMentioned('今天买牛奶', '生活')).toBe(false)
    expect(isListNameMentioned('后天中午和张总吃饭', '工作')).toBe(false)
    expect(isListNameMentioned('', '工作')).toBe(false)
    expect(isListNameMentioned('整理笔记', null)).toBe(false)
  })

  it('忽略大小写与空白', () => {
    expect(isListNameMentioned('sync notes ~My List', 'my list')).toBe(true)
    expect(isListNameMentioned('放到 工作 清单', '工 作')).toBe(true)
  })
})

describe('buildQuickAddPrompt', () => {
  it('要求 AI 只在输入明确提到清单时填写 listName', () => {
    const prompt = buildQuickAddPrompt('明天开会', { now: NOW, lists: ['收集箱', '工作'] })
    expect(prompt).toContain('不要根据任务内容猜测')
    expect(prompt).toContain('收集箱、工作')
  })

  it('要求 AI 原样保留 #标签 / !优先级 / ~清单 显式语法', () => {
    const prompt = buildQuickAddPrompt('明天开会 #工作 !高 ~收集箱', {
      now: NOW,
      lists: ['收集箱', '工作']
    })
    expect(prompt).toContain('#标签')
    expect(prompt).toContain('!优先级')
    expect(prompt).toContain('~清单')
  })

  it('约定 reminderMinutes 并给出常见换算示例', () => {
    const prompt = buildQuickAddPrompt('明天下午3点 提前30分钟提醒 交周报', {
      now: NOW,
      lists: ['收集箱']
    })
    expect(prompt).toContain('reminderMinutes')
    expect(prompt).toContain('“提前30分钟”→30')
    expect(prompt).toContain('“提前一天”→1440')
  })

  it('给出周期+星期与口语时间的换算约定', () => {
    const prompt = buildQuickAddPrompt('每两周的周二 复盘', {
      now: NOW,
      lists: ['收集箱']
    })
    expect(prompt).toContain('“每两周的周二”→FREQ=WEEKLY;INTERVAL=2;BYDAY=TU')
    expect(prompt).toContain('“今晚8点”→当天 20:00')
    expect(prompt).toContain('“明早”→次日 08:00')
    expect(prompt).toContain('“月底”→当月最后一天')
    expect(prompt).toContain('下午 15:00')
  })
})

describe('mergeQuickAddWithRule', () => {
  it('用规则解析补齐 AI 漏掉的显式标签、优先级与清单', () => {
    const rule = ruleQuickAdd('明天下午3点 交周报 #工作 #重点 !高 ~生活', NOW)
    const merged = mergeQuickAddWithRule(
      {
        title: '交周报 #工作',
        priority: 1,
        tags: [],
        listName: '工作',
        dueDate: '2026-11-06',
        dueTime: '16:00',
        allDay: false,
        recurrence: null,
        reminderOffsetMin: null
      },
      rule
    )

    expect(merged.title).toBe('交周报')
    expect(merged.priority).toBe(3)
    expect(merged.tags).toEqual(['工作', '重点'])
    expect(merged.listName).toBe('生活')
    // AI 已给出的日期/时间优先。
    expect(merged.dueTime).toBe('16:00')
  })

  it('AI 漏掉日期、时间与重复时用规则补齐', () => {
    const rule = ruleQuickAdd('明天下午3点 交周报 每周', NOW)
    const merged = mergeQuickAddWithRule(
      {
        title: '交周报',
        priority: 0,
        tags: [],
        listName: null,
        dueDate: null,
        dueTime: null,
        allDay: true,
        recurrence: null,
        reminderOffsetMin: null
      },
      rule
    )

    expect(merged.dueDate).toBe('2026-11-06')
    expect(merged.dueTime).toBe('15:00')
    expect(merged.allDay).toBe(false)
    expect(merged.recurrence).toBe('FREQ=WEEKLY')
  })

  it('AI 只给出日期时用规则补时间', () => {
    const merged = mergeQuickAddWithRule(
      {
        title: '交周报',
        priority: 0,
        tags: [],
        listName: null,
        dueDate: '2026-11-06',
        dueTime: null,
        allDay: true,
        recurrence: null,
        reminderOffsetMin: null
      },
      ruleQuickAdd('明天下午3点 交周报', NOW)
    )

    expect(merged.dueDate).toBe('2026-11-06')
    expect(merged.dueTime).toBe('15:00')
    expect(merged.allDay).toBe(false)
  })

  it('没有可补充内容时保持 AI 结果不变', () => {
    const ai: QuickAddResult = {
      title: '和张总吃饭',
      priority: 2,
      tags: ['聚餐'],
      listName: null,
      dueDate: '2026-11-07',
      dueTime: '12:30',
      allDay: false,
      recurrence: null,
      reminderOffsetMin: null
    }
    expect(mergeQuickAddWithRule(ai, ruleQuickAdd('后天中午和张总吃饭', NOW))).toEqual(ai)
  })

  it('提前提醒优先采用 AI，AI 漏掉时用规则补齐；没有日期则清空', () => {
    const rule = ruleQuickAdd('明天下午3点 提前30分钟提醒 交周报', NOW)
    const ai = normalizeAiQuickAdd({
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      reminderMinutes: 60
    })
    expect(ai).not.toBeNull()
    expect(mergeQuickAddWithRule(ai!, rule).reminderOffsetMin).toBe(60)

    const missing = normalizeAiQuickAdd({
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '15:00'
    })
    expect(mergeQuickAddWithRule(missing!, rule).reminderOffsetMin).toBe(30)

    const noDate = normalizeAiQuickAdd({ title: '交周报', reminderMinutes: 30 })
    expect(mergeQuickAddWithRule(noDate!, ruleQuickAdd('交周报', NOW)).reminderOffsetMin).toBeNull()
  })
})

describe('normalizeAiQuickAdd', () => {
  it('收敛优先级、日期、标签与清单', () => {
    const result = normalizeAiQuickAdd({
      title: ' 交周报 ',
      dueDate: '2026-11-06',
      dueTime: '9:5',
      priority: 9,
      tags: ['#工作', '工作', ' 重要 '],
      listName: ' 工作 ',
      recurrence: 'freq=weekly;byday=mo'
    })
    expect(result).toEqual({
      title: '交周报',
      dueDate: '2026-11-06',
      dueTime: '09:05',
      allDay: false,
      priority: 3,
      tags: ['工作', '重要'],
      listName: '工作',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      reminderOffsetMin: null
    })
  })

  it('只有时间时不擅自补成今天，留给规则合并补齐日期', () => {
    const result = normalizeAiQuickAdd({ title: '交周报', dueTime: '15:00' })
    expect(result?.dueDate).toBeNull()
    expect(result?.dueTime).toBe('15:00')
    expect(result?.allDay).toBe(false)
  })

  it('丢弃非法日期并保留标题；无标题返回 null', () => {
    const result = normalizeAiQuickAdd({ title: '写周报', dueDate: '2026-02-30' })
    expect(result?.dueDate).toBeNull()
    expect(normalizeAiQuickAdd({ title: '  ' })).toBeNull()
  })

  it('收敛 reminderMinutes，非法或越界时视为不提醒', () => {
    expect(normalizeAiQuickAdd({ title: '交周报', reminderMinutes: 30 })?.reminderOffsetMin).toBe(
      30
    )
    expect(
      normalizeAiQuickAdd({ title: '交周报', reminderOffsetMin: '15' })?.reminderOffsetMin
    ).toBe(15)
    expect(
      normalizeAiQuickAdd({ title: '交周报', reminderMinutes: -1 })?.reminderOffsetMin
    ).toBeNull()
    expect(
      normalizeAiQuickAdd({ title: '交周报', reminderMinutes: 999999 })?.reminderOffsetMin
    ).toBeNull()
  })
})

describe('normalizeAiModels', () => {
  it('逐字保留 /v1/models 的 id，并去重', () => {
    const models = normalizeAiModels({
      data: [
        { id: 'ccs-claude-openai--glm-5.3-flash', display_name: 'glm-5.3-flash' },
        { id: ' ccs-claude-openai--glm-5.3-flash ' },
        { id: 'ccs-claude-cn222--kimi-k2.7-code', displayName: 'kimi' },
        { id: '' }
      ]
    })
    expect(models).toEqual([
      { id: 'ccs-claude-openai--glm-5.3-flash', displayName: 'glm-5.3-flash' },
      { id: 'ccs-claude-cn222--kimi-k2.7-code', displayName: 'kimi' }
    ])
  })

  it('兼容纯数组与字符串条目，非法结构返回空数组', () => {
    expect(normalizeAiModels(['model-a', { id: 'model-b' }])).toEqual([
      { id: 'model-a', displayName: null },
      { id: 'model-b', displayName: null }
    ])
    expect(normalizeAiModels({ models: [{ id: 'model-c' }] })).toEqual([
      { id: 'model-c', displayName: null }
    ])
    expect(normalizeAiModels({ nope: true })).toEqual([])
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
    expect(body.max_tokens).toBe(AI_QUICK_ADD_MAX_TOKENS)
    expect(body.messages).toBeTruthy()
  })

  it('丢弃 AI 凭空猜测的清单，留在当前清单', async () => {
    const response = await parseQuickAddWithAi('后天中午和张总吃饭', ['收集箱', '工作', '生活'], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        textResponse(
          JSON.stringify({
            title: '和张总吃饭',
            dueDate: '2026-11-07',
            dueTime: '12:30',
            listName: '工作'
          })
        )
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.result.title).toBe('和张总吃饭')
    expect(response.result.listName).toBeNull()
  })

  it('用户输入明确提到清单时保留 AI 的 listName', async () => {
    const response = await parseQuickAddWithAi('明天下午3点交周报，放工作清单', ['收集箱', '工作'], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        textResponse(JSON.stringify({ title: '交周报', dueTime: '15:00', listName: '工作' }))
    })

    expect(response.ok).toBe(true)
    expect(response.result.listName).toBe('工作')
    expect(response.result.dueDate).toBe('2026-11-06')
  })

  it('AI 只返回标题时仍保留用户输入里的日期与时间', async () => {
    const response = await parseQuickAddWithAi('明天下午3点 交周报', ['收集箱'], {
      config: CONFIG,
      now: NOW,
      fetch: async () => textResponse(JSON.stringify({ title: '交周报' }))
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.result.title).toBe('交周报')
    expect(response.result.dueDate).toBe('2026-11-06')
    expect(response.result.dueTime).toBe('15:00')
    expect(response.result.allDay).toBe(false)
  })

  it('AI 给出日期但漏掉时间时由规则补时间', async () => {
    const response = await parseQuickAddWithAi('明天下午3点 交周报', ['收集箱'], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        textResponse(JSON.stringify({ title: '交周报', dueDate: '2026-11-06' }))
    })

    expect(response.ok).toBe(true)
    expect(response.result.dueDate).toBe('2026-11-06')
    expect(response.result.dueTime).toBe('15:00')
    expect(response.result.allDay).toBe(false)
  })

  it('AI 漏掉显式 #标签 / !优先级 / ~清单 时由规则补齐', async () => {
    const response = await parseQuickAddWithAi('明天下午3点 交周报 #工作 !高 ~生活', ['收集箱', '工作', '生活'], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        textResponse(
          JSON.stringify({
            title: '交周报 #工作',
            dueDate: '2026-11-06',
            dueTime: '15:00',
            priority: 0,
            tags: []
          })
        )
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.result.title).toBe('交周报')
    expect(response.result.tags).toEqual(['工作'])
    expect(response.result.priority).toBe(3)
    expect(response.result.listName).toBe('生活')
  })

  it('显式 ~清单 覆盖 AI 猜测的清单', async () => {
    const response = await parseQuickAddWithAi('明天下午3点 交工作周报 ~生活', ['收集箱', '工作', '生活'], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        textResponse(JSON.stringify({ title: '交工作周报', dueTime: '15:00', listName: '工作' }))
    })

    expect(response.ok).toBe(true)
    expect(response.result.listName).toBe('生活')
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

  it('模型只返回 thinking 时提示输出预算不足并降级', async () => {
    const response = await parseQuickAddWithAi('写周报', [], {
      config: CONFIG,
      now: NOW,
      fetch: async () =>
        responseWith({
          content: [{ type: 'thinking', thinking: '先想一下…' }],
          stop_reason: 'max_tokens'
        })
    })

    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.result.title).toBe('写周报')
    expect(response.warning).toContain('推理过程')
    expect(response.warning).toContain('输出预算不足')
  })
})

describe('breakdownSubtasksWithAi', () => {
  it('解析 AI 返回的子任务', async () => {
    let body: Record<string, unknown> = {}
    const response = await breakdownSubtasksWithAi(
      { title: '准备季度汇报', notes: '收集数据；写幻灯片', listName: '工作' },
      {
        config: CONFIG,
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>
          return textResponse(
            JSON.stringify({
              subtasks: [
                { title: '收集数据', priority: 2 },
                { title: '写幻灯片' }
              ]
            })
          )
        }
      }
    )

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.subtasks.map((item) => item.title)).toEqual(['收集数据', '写幻灯片'])
    expect(response.subtasks[0].priority).toBe(2)
    expect(body.max_tokens).toBe(AI_SUBTASKS_MAX_TOKENS)
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

  it('已有子任务会写进提示词，并要求模型不要重复', () => {
    const prompt = buildSubtasksPrompt({
      title: '准备季度汇报',
      notes: '收集数据；写幻灯片',
      existingSubtasks: ['收集数据', '   ', '预约会议室']
    })
    expect(prompt).toContain('已有子任务（不要重复，也不要改写）：收集数据、预约会议室')
    expect(prompt).toContain('不要输出与主任务或已有子任务同名')
  })

  it('过滤掉与主任务或已有子任务重名（忽略大小写和空白）的条目', () => {
    const drafts = [
      { title: '收集数据', priority: 0 as const, dueDate: null, dueTime: null, allDay: true },
      { title: '写 幻灯片', priority: 0 as const, dueDate: null, dueTime: null, allDay: true },
      { title: '预约会议室', priority: 0 as const, dueDate: null, dueTime: null, allDay: true },
      { title: '写幻灯片', priority: 0 as const, dueDate: null, dueTime: null, allDay: true }
    ]
    expect(
      filterNewSubtasks(drafts, ['准备季度汇报', ' 收集数据 ', '写幻灯片']).map(
        (draft) => draft.title
      )
    ).toEqual(['预约会议室'])
  })

  it('AI 返回重复或已有子任务时只保留新条目', async () => {
    let prompt = ''
    const response = await breakdownSubtasksWithAi(
      {
        title: '准备季度汇报',
        notes: '收集数据；写幻灯片',
        existingSubtasks: ['收集数据']
      },
      {
        config: CONFIG,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
          prompt = body.messages[0].content
          return textResponse(
            JSON.stringify({
              subtasks: [
                { title: '准备季度汇报' },
                { title: '收集数据' },
                { title: '写幻灯片' }
              ]
            })
          )
        }
      }
    )

    expect(prompt).toContain('已有子任务（不要重复，也不要改写）：收集数据')
    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.subtasks.map((item) => item.title)).toEqual(['写幻灯片'])
    expect(response.warning).toBeNull()
  })

  it('AI 返回的子任务全部已存在时不再重复添加', async () => {
    const response = await breakdownSubtasksWithAi(
      { title: '准备季度汇报', existingSubtasks: ['收集数据', '写幻灯片'] },
      {
        config: CONFIG,
        fetch: async () =>
          textResponse(
            JSON.stringify({ subtasks: [{ title: '收集数据' }, { title: '写 幻灯片' }] })
          )
      }
    )

    expect(response.ok).toBe(true)
    expect(response.subtasks).toEqual([])
    expect(response.warning).toContain('均已存在')
  })

  it('规则降级同样跳过已有子任务', async () => {
    const response = await breakdownSubtasksWithAi(
      {
        title: '准备季度汇报',
        notes: '1. 收集数据；2. 写幻灯片；3. 预约会议室',
        existingSubtasks: ['收集数据']
      },
      { config: CONFIG, fetch: failFetch('timeout') }
    )

    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.subtasks.map((item) => item.title)).toEqual(['写幻灯片', '预约会议室'])
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
        listName: '工作',
        overdue: true
      },
      {
        title: '整理会议纪要',
        status: 'completed',
        priority: 1,
        dueDate: '2026-11-05',
        dueTime: null,
        listName: '工作',
        overdue: false
      }
    ],
    completedCount: 1,
    openCount: 1,
    overdueCount: 1
  }

  it('解析 AI 总结', async () => {
    let body: Record<string, unknown> = {}
    const response = await summarizeTodayWithAi(input, {
      config: CONFIG,
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return textResponse(
          JSON.stringify({
            summary: '今天有 1 个逾期任务需要优先处理。',
            highlights: ['交周报已逾期'],
            suggestions: ['先完成交周报']
          })
        )
      }
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.summary.summary).toContain('逾期')
    expect(response.summary.suggestions).toEqual(['先完成交周报'])
    expect(body.max_tokens).toBe(AI_SUMMARY_MAX_TOKENS)
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

describe('localDateKeyFromIso', () => {
  it('按本地时区归日，凌晨完成不会算到前一天', () => {
    expect(localDateKeyFromIso(new Date(2026, 10, 5, 0, 30).toISOString())).toBe('2026-11-05')
    expect(localDateKeyFromIso(new Date(2026, 10, 5, 23, 30).toISOString())).toBe('2026-11-05')
  })

  it('空值与非法时间戳返回 null', () => {
    expect(localDateKeyFromIso(null)).toBeNull()
    expect(localDateKeyFromIso('')).toBeNull()
    expect(localDateKeyFromIso('not-a-date')).toBeNull()
  })
})

describe('buildSummaryInput', () => {
  it('只保留今日待办与今日完成，并按本地时区统计完成数', () => {
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
        completedAt: new Date(2026, 10, 5, 8, 0).toISOString()
      },
      { ...base, id: '4', title: '以后的任务', status: 'open', dueDate: '2026-11-20' },
      {
        ...base,
        id: '5',
        title: '昨天完成但今天到期',
        status: 'completed',
        dueDate: '2026-11-05',
        completedAt: new Date(2026, 10, 4, 20, 0).toISOString()
      },
      {
        ...base,
        id: '6',
        title: '凌晨完成',
        status: 'completed',
        dueDate: null,
        completedAt: new Date(2026, 10, 5, 0, 30).toISOString()
      },
      {
        ...base,
        id: '7',
        title: '今天完成但未来到期',
        status: 'completed',
        dueDate: '2026-11-20',
        completedAt: new Date(2026, 10, 5, 9, 0).toISOString()
      }
    ] as unknown as TaskWithMeta[]

    const input = buildSummaryInput(tasks, '2026-11-05')
    expect(input.tasks.map((task) => task.title)).toEqual([
      '今日任务',
      '逾期任务',
      '今天完成',
      '凌晨完成',
      '今天完成但未来到期'
    ])
    expect(input.openCount).toBe(2)
    expect(input.completedCount).toBe(3)
    expect(input.overdueCount).toBe(1)
    expect(input.tasks.find((task) => task.title === '逾期任务')?.overdue).toBe(true)
    expect(input.tasks.find((task) => task.title === '今日任务')?.overdue).toBe(false)

    const prompt = buildSummaryPrompt(input)
    expect(prompt).toContain('"overdue":true')
    expect(prompt).toContain('"dueDate":"2026-11-03"')
  })

  it('同一任务重复出现时只统计一次', () => {
    const task = {
      id: '1',
      title: '重复任务',
      status: 'open',
      dueDate: '2026-11-05',
      dueTime: null,
      listName: '收集箱',
      priority: 0,
      completedAt: null
    } as unknown as TaskWithMeta

    const input = buildSummaryInput([task, task], '2026-11-05')
    expect(input.tasks).toHaveLength(1)
    expect(input.openCount).toBe(1)
  })
})

describe('listAiModels', () => {
  it('从本机 /v1/models 拉取逐字一致的模型 id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const result = await listAiModels(CONFIG, {
      fetch: async (url, init) => {
        calls.push({ url, init })
        return modelsResponse([AI_DEFAULT_MODEL, 'ccs-claude-cn222--kimi-k2.7-code'])
      }
    })

    expect(result.ok).toBe(true)
    expect(result.models.map((model) => model.id)).toEqual([
      AI_DEFAULT_MODEL,
      'ccs-claude-cn222--kimi-k2.7-code'
    ])
    expect(calls[0].url).toBe('http://127.0.0.1:15721/v1/models')
    expect(calls[0].init?.method).toBe('GET')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['x-api-key']).toBe('local-token')
  })

  it('兼容填写到 /v1 的 Base URL', () => {
    expect(resolveModelsUrl('http://127.0.0.1:15721/v1/')).toBe(
      'http://127.0.0.1:15721/v1/models'
    )
    expect(resolveModelsUrl('')).toBe('http://127.0.0.1:15721/v1/models')
  })

  it('服务不可用时返回可展示的错误而不抛错', async () => {
    const result = await listAiModels(CONFIG, { fetch: failFetch('服务未启动') })
    expect(result.ok).toBe(false)
    expect(result.models).toEqual([])
    expect(result.message).toContain('服务未启动')
  })
})

describe('testAiConnection', () => {
  it('成功时返回模型与耗时，并给推理模型留足 token', async () => {
    let body: Record<string, unknown> = {}
    const result = await testAiConnection(CONFIG, {
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return textResponse('OK')
      }
    })
    expect(result.ok).toBe(true)
    expect(result.model).toBe(AI_DEFAULT_MODEL)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(Number(body.max_tokens)).toBe(AI_CONNECTION_MAX_TOKENS)
    expect(AI_CONNECTION_MAX_TOKENS).toBeGreaterThanOrEqual(512)
  })

  it('失败时返回可展示的错误信息', async () => {
    const result = await testAiConnection(CONFIG, { fetch: failFetch('本地服务未启动') })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('本地服务未启动')
  })
})

describe('describeAiFailure 失败分类与提示', () => {
  it('超时提示写明超时秒数，并说明不重试的原因', () => {
    const info = describeAiFailure(new Error('AI 请求超时'), {
      baseUrl: AI_DEFAULT_BASE_URL,
      timeoutMs: 8000
    })
    expect(info.kind).toBe('timeout')
    expect(info.retryable).toBe(false)
    expect(info.hint).toContain('8 秒')
    expect(info.hint).toContain('调大超时')
  })

  it('连接被拒时提示本机服务地址并标记可重试', () => {
    const info = describeAiFailure(new Error('connect ECONNREFUSED 127.0.0.1:15721'), CONFIG)
    expect(info.kind).toBe('network')
    expect(info.retryable).toBe(true)
    expect(info.hint).toContain('127.0.0.1:15721')
    expect(info.hint).toContain('CC Switch')
    expect(info.hint).toContain('ECONNREFUSED')
  })

  it('限流与 5xx 可重试，鉴权与模型错误不重试且给出自助排查方向', () => {
    const overloaded = describeAiFailure(new Error('AI 接口返回 503：overloaded'))
    expect(overloaded.kind).toBe('busy')
    expect(overloaded.retryable).toBe(true)
    expect(overloaded.hint).toContain('繁忙')

    // 服务器正文里出现 timeout 时，仍按状态码归类，不会被误判为客户端超时。
    const gateway = describeAiFailure(new Error('AI 接口返回 504：gateway timeout'))
    expect(gateway.kind).toBe('busy')
    expect(gateway.retryable).toBe(true)

    const limited = describeAiFailure(new Error('AI 接口返回 429：slow down'))
    expect(limited.kind).toBe('busy')
    expect(limited.retryable).toBe(true)
    expect(limited.hint).toContain('限流')

    const auth = describeAiFailure(new Error('AI 接口返回 401：invalid key'))
    expect(auth.kind).toBe('auth')
    expect(auth.retryable).toBe(false)
    expect(auth.hint).toContain('Token')

    const model = describeAiFailure(new Error('AI 接口返回 404：model not found'))
    expect(model.kind).toBe('model')
    expect(model.retryable).toBe(false)
    expect(model.hint).toContain('获取模型列表')
  })

  it('只有 thinking 的回复保留输出预算不足的可操作提示', () => {
    const info = describeAiFailure(
      new Error('AI 只返回了推理过程，正文为空（输出预算不足），请重试或更换模型')
    )
    expect(info.kind).toBe('empty')
    expect(info.retryable).toBe(false)
    expect(info.hint).toContain('推理过程')
    expect(info.hint).toContain('输出预算不足')
    expect(isRetryableAiError(new Error('AI 返回内容为空'))).toBe(false)
  })

  it('标注自动重试次数', () => {
    const info = describeAiFailure(new Error('connect ECONNREFUSED'), CONFIG, 2)
    expect(info.hint).toContain('已自动重试 1 次')
  })

  it('空模型列表给出更具体的提示', () => {
    const info = describeAiFailure(new Error('AI 模型列表为空'))
    expect(info.kind).toBe('empty')
    expect(info.retryable).toBe(false)
    expect(info.hint).toContain('模型列表为空')
  })

  it('模型目录超时使用专用提示，不会与任务解析超时混淆', () => {
    const info = describeAiFailure(new Error('AI 模型列表请求超时'), {
      baseUrl: AI_DEFAULT_BASE_URL,
      timeoutMs: 3000
    })
    expect(info.kind).toBe('timeout')
    expect(info.retryable).toBe(false)
    expect(info.hint).toContain('模型列表请求超时（3 秒）')
    expect(info.hint).toContain('CC Switch')
  })
})

describe('AI 失败重试', () => {
  it('连接被拒时自动重试一次并成功', async () => {
    let calls = 0
    const retries: number[] = []
    const response = await parseQuickAddWithAi('交周报', [], {
      config: CONFIG,
      now: NOW,
      retryDelayMs: 0,
      onRetry: ({ attempt }) => retries.push(attempt),
      fetch: async () => {
        calls += 1
        if (calls === 1) throw new Error('connect ECONNREFUSED')
        return textResponse(JSON.stringify({ title: '交周报' }))
      }
    })

    expect(response.ok).toBe(true)
    expect(response.source).toBe('ai')
    expect(response.attempts).toBe(2)
    expect(calls).toBe(2)
    expect(retries).toEqual([1])
  })

  it('5xx 重试后仍失败时标注已重试，并保留规则解析结果', async () => {
    let calls = 0
    const response = await parseQuickAddWithAi('明天下午3点 交周报', [], {
      config: CONFIG,
      now: NOW,
      retryDelayMs: 0,
      fetch: async () => {
        calls += 1
        return statusResponse(504, 'gateway timeout')
      }
    })

    expect(calls).toBe(2)
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.attempts).toBe(2)
    expect(response.warning).toContain('繁忙')
    expect(response.warning).toContain('已自动重试 1 次')
    expect(response.result.dueDate).toBe('2026-11-06')
    expect(response.result.dueTime).toBe('15:00')
  })

  it('超时不重试，提示写明超时秒数并立即回落规则解析', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const response = await parseQuickAddWithAi('交周报', [], {
      config: { ...CONFIG, timeoutMs: 5000 },
      now: NOW,
      retryDelayMs: 0,
      fetch: fetchImpl as unknown as FetchLike
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response.ok).toBe(false)
    expect(response.attempts).toBe(1)
    expect(response.warning).toContain('超时')
    expect(response.warning).toContain('5 秒')
    expect(response.result.title).toBe('交周报')
  })

  it('模型不存在时不重试，提示核对模型 ID', async () => {
    let calls = 0
    const response = await summarizeTodayWithAi(
      { date: '2026-11-05', tasks: [], completedCount: 0, openCount: 0, overdueCount: 0 },
      {
        config: CONFIG,
        retryDelayMs: 0,
        fetch: async () => {
          calls += 1
          return statusResponse(404, '{"error":"model not found"}')
        }
      }
    )

    expect(calls).toBe(1)
    expect(response.ok).toBe(false)
    expect(response.attempts).toBe(1)
    expect(response.warning).toContain('获取模型列表')
    expect(response.summary.summary).toContain('2026-11-05')
  })

  it('模型列表与测试连接同样重试，并回报尝试次数', async () => {
    let modelCalls = 0
    const models = await listAiModels(CONFIG, {
      retryDelayMs: 0,
      fetch: async () => {
        modelCalls += 1
        return modelCalls === 1 ? statusResponse(502, 'bad gateway') : modelsResponse([AI_DEFAULT_MODEL])
      }
    })
    expect(models.ok).toBe(true)
    expect(models.attempts).toBe(2)
    expect(models.models.map((model) => model.id)).toEqual([AI_DEFAULT_MODEL])

    const failed = await testAiConnection(CONFIG, {
      retryDelayMs: 0,
      fetch: failFetch('connect ECONNREFUSED')
    })
    expect(failed.ok).toBe(false)
    expect(failed.attempts).toBe(2)
    expect(failed.message).toContain('CC Switch')
    expect(failed.message).toContain('已自动重试 1 次')
  })

  it('重试成功后结构仍非法时，尝试次数照样回报', async () => {
    let calls = 0
    const response = await parseQuickAddWithAi('写周报', [], {
      config: CONFIG,
      now: NOW,
      retryDelayMs: 0,
      fetch: async () => {
        calls += 1
        if (calls === 1) throw new Error('connect ECONNREFUSED')
        return textResponse('我不太确定')
      }
    })

    expect(calls).toBe(2)
    expect(response.ok).toBe(false)
    expect(response.attempts).toBe(2)
    expect(response.warning).toContain('无法解析')
    expect(response.warning).toContain('已自动重试 1 次')
  })

  it('模型列表为空时不重试，并返回可操作提示', async () => {
    let calls = 0
    const result = await listAiModels(CONFIG, {
      retryDelayMs: 0,
      fetch: async () => {
        calls += 1
        return responseWith({ data: [] })
      }
    })
    expect(calls).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(1)
    expect(result.message).toContain('模型列表为空')
  })

  it('maxAttempts=1 时可关闭自动重试', async () => {
    let calls = 0
    const response = await breakdownSubtasksWithAi(
      { title: '准备季度汇报', notes: '收集数据；写幻灯片' },
      {
        config: CONFIG,
        maxAttempts: 1,
        retryDelayMs: 0,
        fetch: async () => {
          calls += 1
          throw new Error('connect ECONNRESET')
        }
      }
    )
    expect(calls).toBe(1)
    expect(response.ok).toBe(false)
    expect(response.attempts).toBe(1)
    expect(response.subtasks.map((item) => item.title)).toEqual(['收集数据', '写幻灯片'])
  })
})
