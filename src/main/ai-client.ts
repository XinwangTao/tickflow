import {
  AI_ANTHROPIC_VERSION,
  AI_DEFAULT_TIMEOUT_MS,
  describeAiError,
  describeAiFailure,
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

/** 瞬时故障（连接被拒、5xx、限流）默认再试一次；超时不重试，避免等待时间翻倍。 */
export const AI_MAX_ATTEMPTS = 2
export const AI_RETRY_DELAY_MS = 200

export interface AiClientOptions {
  fetch?: FetchLike
  /** 总尝试次数（含首次），1 表示不重试。 */
  maxAttempts?: number
  /** 两次尝试之间的等待毫秒数。 */
  retryDelayMs?: number
  /** 每次重试前的回调，便于观察与测试。 */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void
}

/** 带尝试次数的请求错误：上层据此在提示里标注“已自动重试 N 次”。 */
export class AiRequestError extends Error {
  readonly attempts: number

  constructor(message: string, attempts: number) {
    super(message)
    this.name = 'AiRequestError'
    this.attempts = attempts
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 统一的重试包装：只对瞬时故障重试，且总尝试次数封顶。
 * 超时已经用满用户配置的时间预算，重试只会让界面多等一倍，因此不重试。
 */
async function withAiRetry<T>(
  config: AiConfig,
  options: AiClientOptions,
  run: () => Promise<T>
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(options.maxAttempts ?? AI_MAX_ATTEMPTS)))
  const delayMs = Math.max(0, options.retryDelayMs ?? AI_RETRY_DELAY_MS)

  let attempt = 1
  for (;;) {
    try {
      return { value: await run(), attempts: attempt }
    } catch (error) {
      const failure = describeAiFailure(error, config)
      if (!failure.retryable || attempt >= maxAttempts) {
        throw new AiRequestError(describeAiError(error), attempt)
      }
      options.onRetry?.({ attempt, error, delayMs })
      attempt += 1
      await sleep(delayMs)
    }
  }
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

async function requestAiTextOnce(
  config: AiConfig,
  request: AiMessageRequest,
  options: AiClientOptions = {}
): Promise<string> {
  const fetchImpl = options.fetch ?? fetch
  const controller = new AbortController()
  const timeout = config.timeoutMs > 0 ? config.timeoutMs : AI_DEFAULT_TIMEOUT_MS
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

/** 请求正文，同时告知实际请求次数（>1 表示发生过自动重试）。 */
export async function requestAiTextResult(
  config: AiConfig,
  request: AiMessageRequest,
  options: AiClientOptions = {}
): Promise<{ text: string; attempts: number }> {
  const result = await withAiRetry(config, options, () =>
    requestAiTextOnce(config, request, options)
  )
  return { text: result.value, attempts: result.attempts }
}

export async function requestAiText(
  config: AiConfig,
  request: AiMessageRequest,
  options: AiClientOptions = {}
): Promise<string> {
  return (await requestAiTextResult(config, request, options)).text
}

/** 读取本机 /v1/models 目录，返回逐字一致的模型 id 供设置页选择。 */
async function requestAiModelsOnce(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<AiModelInfo[]> {
  const fetchImpl = options.fetch ?? fetch
  const controller = new AbortController()
  const timeout = config.timeoutMs > 0 ? config.timeoutMs : AI_DEFAULT_TIMEOUT_MS
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

/** 读取模型目录，同时告知实际请求次数。 */
export async function requestAiModelsResult(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<{ models: AiModelInfo[]; attempts: number }> {
  const result = await withAiRetry(config, options, () => requestAiModelsOnce(config, options))
  return { models: result.value, attempts: result.attempts }
}

export async function requestAiModels(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<AiModelInfo[]> {
  return (await requestAiModelsResult(config, options)).models
}
