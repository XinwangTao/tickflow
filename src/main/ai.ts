import {
  AI_CONNECTION_MAX_TOKENS,
  AI_QUICK_ADD_MAX_TOKENS,
  AI_QUICK_ADD_SYSTEM,
  AI_SUBTASKS_MAX_TOKENS,
  AI_SUBTASK_SYSTEM,
  AI_SUMMARY_MAX_TOKENS,
  AI_SUMMARY_SYSTEM,
  buildQuickAddPrompt,
  buildSubtasksPrompt,
  buildSummaryPrompt,
  describeAiFailure,
  filterNewSubtasks,
  isListNameMentioned,
  isAiCanceled,
  mergeQuickAddWithRule,
  normalizeAiQuickAdd,
  normalizeAiSubtasks,
  normalizeAiSummary,
  parseAiJson,
  ruleDailySummary,
  ruleQuickAdd,
  ruleSubtasks,
  type AiConfig,
  type AiModelsResult,
  type AiQuickAddResponse,
  type AiSubtasksResponse,
  type AiSummaryInput,
  type AiSummaryResponse,
  type AiTestResult
} from '@shared/ai'
import {
  AiRequestError,
  requestAiModelsResult,
  requestAiTextResult,
  type AiClientOptions
} from './ai-client'

export interface AiRuntime {
  config: AiConfig
  now?: Date
  fetch?: AiClientOptions['fetch']
  /** 失败自动重试的总尝试次数（含首次），默认 2；1 表示不重试。 */
  maxAttempts?: number
  retryDelayMs?: number
  onRetry?: AiClientOptions['onRetry']
  /** 用户取消信号（来自 `ai:cancel`），取消后不再重试。 */
  signal?: AbortSignal
}

/**
 * 进行中的 AI 请求注册表：renderer 生成 requestId，main 用它把「取消」精确落到
 * 那一次 fetch 上。key 用完即删，避免长时间运行时堆积。
 */
const inflightAiRequests = new Map<string, AbortController>()

const AI_REQUEST_ID_PATTERN = /^[\w:-]{1,80}$/

/** 登记一次 AI 请求，返回用于中止它的 controller；非法 id 返回 null。 */
export function registerAiRequest(requestId: string): AbortController | null {
  if (!AI_REQUEST_ID_PATTERN.test(requestId)) return null
  const existing = inflightAiRequests.get(requestId)
  if (existing) return existing
  const controller = new AbortController()
  inflightAiRequests.set(requestId, controller)
  return controller
}

/** 请求结束（成功、失败或取消）后注销，保证注册表不泄漏。 */
export function releaseAiRequest(requestId: string): void {
  inflightAiRequests.delete(requestId)
}

/**
 * 取消指定请求：返回 true 表示确实有一笔在跑并已中止。
 * 已经结束或 id 未知时返回 false，renderer 据此无需额外提示。
 */
export function cancelAiRequest(requestId: string): boolean {
  const controller = inflightAiRequests.get(requestId)
  if (!controller) return false
  inflightAiRequests.delete(requestId)
  controller.abort()
  return true
}

/** 当前挂起的请求数，用于测试确认没有泄漏。 */
export function activeAiRequestCount(): number {
  return inflightAiRequests.size
}

function disabledConfig(config: AiConfig): boolean {
  return !config.enabled || !config.model.trim()
}

function requestOptions(runtime: {
  fetch?: AiClientOptions['fetch']
  maxAttempts?: number
  retryDelayMs?: number
  onRetry?: AiClientOptions['onRetry']
  signal?: AbortSignal
}): AiClientOptions {
  return {
    fetch: runtime.fetch,
    maxAttempts: runtime.maxAttempts,
    retryDelayMs: runtime.retryDelayMs,
    onRetry: runtime.onRetry,
    signal: runtime.signal
  }
}

/**
 * 失败提示：把错误翻译成“原因 + 下一步”，并带上实际请求次数。
 * 超时提示会写明超时秒数，网络错误提示会写明服务地址。
 */
function failureOf(
  error: unknown,
  config: AiConfig,
  fallbackAttempts = 1
): { warning: string; attempts: number } {
  const attempts = error instanceof AiRequestError ? error.attempts : fallbackAttempts
  return { warning: describeAiFailure(error, config, attempts).hint, attempts }
}

/** 自然语言快速添加：AI 失败时回落到 parseQuickAdd 规则解析。 */
export async function parseQuickAddWithAi(
  input: string,
  lists: string[],
  runtime: AiRuntime
): Promise<AiQuickAddResponse> {
  const now = runtime.now ?? new Date()
  const fallback = ruleQuickAdd(input, now)
  if (!input.trim()) {
    return { ok: false, source: 'rule', result: fallback, warning: '输入为空', attempts: 0 }
  }
  if (disabledConfig(runtime.config)) {
    return {
      ok: false,
      source: 'rule',
      result: fallback,
      warning: 'AI 已关闭或未配置模型',
      attempts: 0
    }
  }

  let attempts = 1
  try {
    const result = await requestAiTextResult(
      runtime.config,
      {
        system: AI_QUICK_ADD_SYSTEM,
        prompt: buildQuickAddPrompt(input, { now, lists }),
        maxTokens: AI_QUICK_ADD_MAX_TOKENS,
        temperature: 0.1
      },
      requestOptions(runtime)
    )
    attempts = result.attempts
    const parsed = normalizeAiQuickAdd(parseAiJson(result.text))
    if (!parsed) throw new Error('AI 返回结构无法识别')
    // 显式 #标签 / !优先级 / ~清单 以规则为准；AI 漏掉的日期、时间、重复用规则补齐。
    const merged = mergeQuickAddWithRule(parsed, fallback, now)
    // 模型经常在用户没提清单时按任务内容猜一个；忽略猜测，留在当前清单。
    const quickAdd =
      merged.listName && !isListNameMentioned(input, merged.listName)
        ? { ...merged, listName: null }
        : merged
    return { ok: true, source: 'ai', result: quickAdd, warning: null, attempts }
  } catch (error) {
    if (isAiCanceled(error)) {
      // 用户主动取消：renderer 会直接丢弃这次响应，这里仍返回一份可用的规则结果，
      // 保证任何调用方都不会因为取消而拿到空数据。
      return { ok: false, source: 'rule', result: fallback, warning: '已取消 AI 解析', attempts }
    }
    return {
      ok: false,
      source: 'rule',
      result: fallback,
      ...failureOf(error, runtime.config, attempts)
    }
  }
}

/** 子任务拆解：AI 失败时按换行/标点做规则拆分。 */
export async function breakdownSubtasksWithAi(
  task: {
    title: string
    notes?: string
    listName?: string
    existingSubtasks?: string[]
  },
  runtime: AiRuntime
): Promise<AiSubtasksResponse> {
  // 主任务与已有子任务都不应重复创建；重复点击 AI 拆解时也能保持幂等。
  const excludedTitles = [task.title, ...(task.existingSubtasks ?? [])]
  const fallback = filterNewSubtasks(ruleSubtasks(task), excludedTitles)
  if (disabledConfig(runtime.config) || !task.title.trim()) {
    return {
      ok: false,
      source: 'rule',
      subtasks: fallback,
      warning: disabledConfig(runtime.config) ? 'AI 已关闭或未配置模型' : '任务标题为空',
      attempts: 0
    }
  }

  let attempts = 1
  try {
    const result = await requestAiTextResult(
      runtime.config,
      {
        system: AI_SUBTASK_SYSTEM,
        prompt: buildSubtasksPrompt(task),
        maxTokens: AI_SUBTASKS_MAX_TOKENS,
        temperature: 0.3
      },
      requestOptions(runtime)
    )
    attempts = result.attempts
    const parsed = normalizeAiSubtasks(parseAiJson(result.text))
    if (!parsed) throw new Error('AI 返回结构无法识别')
    const subtasks = filterNewSubtasks(parsed, excludedTitles)
    return {
      ok: true,
      source: 'ai',
      subtasks,
      warning: subtasks.length === 0 ? 'AI 返回的子任务均已存在，未重复添加' : null,
      attempts
    }
  } catch (error) {
    return {
      ok: false,
      source: 'rule',
      subtasks: fallback,
      ...failureOf(error, runtime.config, attempts)
    }
  }
}

/** 今日计划总结：AI 失败时使用本地统计生成确定性文案。 */
export async function summarizeTodayWithAi(
  input: AiSummaryInput,
  runtime: AiRuntime
): Promise<AiSummaryResponse> {
  const fallback = ruleDailySummary(input)
  if (disabledConfig(runtime.config)) {
    return {
      ok: false,
      source: 'rule',
      summary: fallback,
      warning: 'AI 已关闭或未配置模型',
      attempts: 0
    }
  }

  let attempts = 1
  try {
    const result = await requestAiTextResult(
      runtime.config,
      {
        system: AI_SUMMARY_SYSTEM,
        prompt: buildSummaryPrompt(input),
        maxTokens: AI_SUMMARY_MAX_TOKENS,
        temperature: 0.4
      },
      requestOptions(runtime)
    )
    attempts = result.attempts
    const summary = normalizeAiSummary(parseAiJson(result.text))
    if (!summary) throw new Error('AI 返回结构无法识别')
    return { ok: true, source: 'ai', summary, warning: null, attempts }
  } catch (error) {
    return {
      ok: false,
      source: 'rule',
      summary: fallback,
      ...failureOf(error, runtime.config, attempts)
    }
  }
}

/** 拉取本机模型目录：不要求已选模型，方便用户先发现再填写。 */
export async function listAiModels(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<AiModelsResult> {
  if (!config.baseUrl.trim()) {
    return { ok: false, models: [], message: '未配置 AI Base URL', attempts: 0 }
  }
  try {
    const { models, attempts } = await requestAiModelsResult(config, options)
    return { ok: true, models, message: `已获取 ${models.length} 个本机模型`, attempts }
  } catch (error) {
    const failure = failureOf(error, config)
    return {
      ok: false,
      models: [],
      message: `获取模型列表失败：${failure.warning}`,
      attempts: failure.attempts
    }
  }
}

/** 设置页“测试连接”：发一条最小请求，返回模型与耗时。 */
export async function testAiConnection(
  config: AiConfig,
  options: AiClientOptions = {}
): Promise<AiTestResult> {
  if (!config.enabled) return { ok: false, message: 'AI 已关闭', attempts: 0 }
  if (!config.model.trim()) return { ok: false, message: '未配置模型名', attempts: 0 }

  const started = Date.now()
  try {
    const { attempts } = await requestAiTextResult(
      config,
      {
        system: '你只需回复 OK。',
        prompt: 'Reply with exactly: OK',
        // 推理模型会先用掉一部分 token 生成 thinking 块，预算过小会只剩 thinking。
        maxTokens: AI_CONNECTION_MAX_TOKENS,
        temperature: 0
      },
      options
    )
    return {
      ok: true,
      message: `连接成功 · ${config.model}${attempts > 1 ? `（重试 ${attempts - 1} 次后成功）` : ''}`,
      model: config.model,
      latencyMs: Date.now() - started,
      attempts
    }
  } catch (error) {
    const failure = failureOf(error, config)
    return {
      ok: false,
      message: `连接失败：${failure.warning}`,
      model: config.model,
      attempts: failure.attempts
    }
  }
}
