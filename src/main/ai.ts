import {
  AI_QUICK_ADD_SYSTEM,
  AI_SUBTASK_SYSTEM,
  AI_SUMMARY_SYSTEM,
  buildQuickAddPrompt,
  buildSubtasksPrompt,
  buildSummaryPrompt,
  describeAiError,
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
import { requestAiModels, requestAiText, type FetchLike } from './ai-client'

export interface AiRuntime {
  config: AiConfig
  now?: Date
  fetch?: FetchLike
}

function disabledConfig(config: AiConfig): boolean {
  return !config.enabled || !config.model.trim()
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
    return { ok: false, source: 'rule', result: fallback, warning: '输入为空' }
  }
  if (disabledConfig(runtime.config)) {
    return { ok: false, source: 'rule', result: fallback, warning: 'AI 已关闭或未配置模型' }
  }

  try {
    const text = await requestAiText(
      runtime.config,
      {
        system: AI_QUICK_ADD_SYSTEM,
        prompt: buildQuickAddPrompt(input, { now, lists }),
        maxTokens: 600,
        temperature: 0.1
      },
      { fetch: runtime.fetch }
    )
    const parsed = normalizeAiQuickAdd(parseAiJson(text), now)
    if (!parsed) throw new Error('AI 返回结构无法识别')
    return { ok: true, source: 'ai', result: parsed, warning: null }
  } catch (error) {
    return {
      ok: false,
      source: 'rule',
      result: fallback,
      warning: describeAiError(error)
    }
  }
}

/** 子任务拆解：AI 失败时按换行/标点做规则拆分。 */
export async function breakdownSubtasksWithAi(
  task: { title: string; notes?: string; listName?: string },
  runtime: AiRuntime
): Promise<AiSubtasksResponse> {
  const fallback = ruleSubtasks(task)
  if (disabledConfig(runtime.config) || !task.title.trim()) {
    return {
      ok: false,
      source: 'rule',
      subtasks: fallback,
      warning: disabledConfig(runtime.config) ? 'AI 已关闭或未配置模型' : '任务标题为空'
    }
  }

  try {
    const text = await requestAiText(
      runtime.config,
      {
        system: AI_SUBTASK_SYSTEM,
        prompt: buildSubtasksPrompt(task),
        maxTokens: 800,
        temperature: 0.3
      },
      { fetch: runtime.fetch }
    )
    const subtasks = normalizeAiSubtasks(parseAiJson(text))
    if (!subtasks) throw new Error('AI 返回结构无法识别')
    return { ok: true, source: 'ai', subtasks, warning: null }
  } catch (error) {
    return {
      ok: false,
      source: 'rule',
      subtasks: fallback,
      warning: describeAiError(error)
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
    return { ok: false, source: 'rule', summary: fallback, warning: 'AI 已关闭或未配置模型' }
  }

  try {
    const text = await requestAiText(
      runtime.config,
      {
        system: AI_SUMMARY_SYSTEM,
        prompt: buildSummaryPrompt(input),
        maxTokens: 700,
        temperature: 0.4
      },
      { fetch: runtime.fetch }
    )
    const summary = normalizeAiSummary(parseAiJson(text))
    if (!summary) throw new Error('AI 返回结构无法识别')
    return { ok: true, source: 'ai', summary, warning: null }
  } catch (error) {
    return {
      ok: false,
      source: 'rule',
      summary: fallback,
      warning: describeAiError(error)
    }
  }
}

/** 拉取本机模型目录：不要求已选模型，方便用户先发现再填写。 */
export async function listAiModels(
  config: AiConfig,
  options: { fetch?: FetchLike } = {}
): Promise<AiModelsResult> {
  if (!config.baseUrl.trim()) {
    return { ok: false, models: [], message: '未配置 AI Base URL' }
  }
  try {
    const models = await requestAiModels(config, { fetch: options.fetch })
    return { ok: true, models, message: `已获取 ${models.length} 个本机模型` }
  } catch (error) {
    return {
      ok: false,
      models: [],
      message: `获取模型列表失败：${describeAiError(error)}`
    }
  }
}

/** 设置页“测试连接”：发一条最小请求，返回模型与耗时。 */
export async function testAiConnection(
  config: AiConfig,
  options: { fetch?: FetchLike } = {}
): Promise<AiTestResult> {
  if (!config.enabled) return { ok: false, message: 'AI 已关闭' }
  if (!config.model.trim()) return { ok: false, message: '未配置模型名' }

  const started = Date.now()
  try {
    await requestAiText(
      config,
      {
        system: '你只需回复 OK。',
        prompt: 'Reply with exactly: OK',
        // 推理模型会先用掉一部分 token 生成 thinking 块，预算过小会只剩 thinking。
        maxTokens: 256,
        temperature: 0
      },
      { fetch: options.fetch }
    )
    return {
      ok: true,
      message: `连接成功 · ${config.model}`,
      model: config.model,
      latencyMs: Date.now() - started
    }
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${describeAiError(error)}`,
      model: config.model
    }
  }
}
