import { beforeAll, describe, expect, it, vi } from 'vitest'

let mod: typeof import('../mobile/src/ai')

beforeAll(async () => {
  // @ts-expect-error fake-indexeddb 的 exports 未暴露 auto 的声明文件
  await import('fake-indexeddb/auto')
  mod = await import('../mobile/src/ai')
})

describe('mobile ai config', () => {
  it('拼接 OpenAI 兼容地址时兼容带不带 /v1 与完整地址', () => {
    expect(mod.cloudChatUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    )
    expect(mod.cloudChatUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(mod.cloudChatUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('云端返回 JSON 时解析成任务并标记来源 ai', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"title":"交周报","dueDate":"2026-11-08","dueTime":"15:00","allDay":false,"priority":2,"tags":["工作"],"listName":null,"recurrence":null,"reminderMinutes":null}'
              }
            }
          ]
        })
    })
    vi.stubGlobal('fetch', fetchMock)
    await mod.saveAiConfig({
      enabled: true,
      channel: 'cloud',
      cloudBaseUrl: 'https://api.example.com/v1',
      cloudApiKey: 'sk-test',
      cloudModel: 'glm-4-flash'
    })
    const outcome = await mod.aiParseQuickAdd('明天下午3点 交周报 #工作 !中', ['收集箱'])
    expect(outcome.ok).toBe(true)
    expect(outcome.source).toBe('ai')
    expect(outcome.result.title).toBe('交周报')
    expect(outcome.result.tags).toContain('工作')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('云端失败时回落到规则解析且保留原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )
    await mod.saveAiConfig({ enabled: true, channel: 'cloud' })
    const outcome = await mod.aiParseQuickAdd('明天交周报', ['收集箱'])
    expect(outcome.ok).toBe(false)
    expect(outcome.source).toBe('rule')
    expect(outcome.result.title).toBe('交周报')
    expect(outcome.warning).toContain('401')
    vi.unstubAllGlobals()
  })
})
