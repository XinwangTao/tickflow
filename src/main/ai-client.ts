import { AI_ANTHROPIC_VERSION, type AiConfig } from '@shared/ai'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AiMessageRequest {
  system: string
  prompt: string
  maxTokens?: number
  temperature?: number
}

export interface AiClientOptions {
  fetch?: FetchLike
}

/** 拼接 Anthropic 兼容的 /v1/messages 地址，兼容用户填写带 /v1 的 baseUrl。 */
export function resolveMessagesUrl(baseUrl: string): string {
  let base = (baseUrl || '').trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  if (!base) base = 'http://127.0.0.1:15721'
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

/** 从 Anthropic content blocks（兼容 OpenAI choices）中提取纯文本。 */
export function extractAiText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>

  if (Array.isArray(record.content)) {
    const parts: string[] = []
    for (const block of record.content) {
      if (typeof block === 'string') {
        parts.push(block)
        continue
      }
      if (!block || typeof block !== 'object') continue
      const item = block as Record<string, unknown>
      if (typeof item.text === 'string') parts.push(item.text)
    }
    const text = parts.join('').trim()
    if (text) return text
  }

  if (typeof record.content === 'string') return record.content.trim()
  if (typeof record.completion === 'string') return record.completion.trim()

  if (Array.isArray(record.choices)) {
    const first = record.choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    if (typeof message?.content === 'string') return message.content.trim()
    if (typeof first?.text === 'string') return first.text.trim()
  }
  return ''
}

export async function requestAiText(
  config: AiConfig,
  request: AiMessageRequest,
  options: AiClientOptions = {}
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch
  const controller = new AbortController()
  const timeout = config.timeoutMs > 0 ? config.timeoutMs : 15_000
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': AI_ANTHROPIC_VERSION
    }
    if (config.token) {
      headers['x-api-key'] = config.token
      headers.authorization = `Bearer ${config.token}`
    }

    const body = JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 700,
      temperature: request.temperature ?? 0.2,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }]
    })

    const response = await fetchImpl(resolveMessagesUrl(config.baseUrl), {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw new Error(`AI 接口返回 ${response.status}${detail ? `：${detail}` : ''}`)
    }

    const payload: unknown = await response.json()
    const text = extractAiText(payload)
    if (!text) throw new Error('AI 返回内容为空')
    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 请求超时')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
