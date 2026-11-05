import {
  AI_ANTHROPIC_VERSION,
  normalizeAiModels,
  type AiConfig,
  type AiModelInfo
} from '@shared/ai'

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

/** 拼接 /v1/models 地址，规则与 messages 一致。 */
export function resolveModelsUrl(baseUrl: string): string {
  let base = (baseUrl || '').trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  if (!base) base = 'http://127.0.0.1:15721'
  if (base.endsWith('/v1')) return `${base}/models`
  return `${base}/v1/models`
}

function aiHeaders(config: AiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': AI_ANTHROPIC_VERSION
  }
  if (config.token) {
    headers['x-api-key'] = config.token
    headers.authorization = `Bearer ${config.token}`
  }
  return headers
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
    const headers = aiHeaders(config)

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
    if (!text) {
      // 推理模型可能把 max_tokens 全花在 thinking 上，正文为空。
      // 这种失败应给出可操作提示，而不是笼统的“返回内容为空”。
      const record =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null
      const firstChoice =
        Array.isArray(record?.choices) && record.choices[0] && typeof record.choices[0] === 'object'
          ? (record.choices[0] as Record<string, unknown>)
          : null
      if (record?.stop_reason === 'max_tokens' || firstChoice?.finish_reason === 'length') {
        throw new Error('AI 只返回了推理过程，正文为空（输出预算不足），请重试或更换模型')
      }
      throw new Error('AI 返回内容为空')
    }
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

/** 读取本机 /v1/models 目录，返回逐字一致的模型 id 供设置页选择。 */
export async function requestAiModels(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<AiModelInfo[]> {
  const fetchImpl = options.fetch ?? fetch
  const controller = new AbortController()
  const timeout = config.timeoutMs > 0 ? config.timeoutMs : 15_000
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetchImpl(resolveModelsUrl(config.baseUrl), {
      method: 'GET',
      headers: aiHeaders(config),
      signal: controller.signal
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw new Error(`AI 模型列表返回 ${response.status}${detail ? `：${detail}` : ''}`)
    }

    const models = normalizeAiModels(await response.json())
    if (models.length === 0) throw new Error('AI 模型列表为空')
    return models
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 模型列表请求超时')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
