import type { Priority, Settings, TaskStatus, TaskWithMeta } from './types'
import type { QuickAddResult } from './quick-add'
import {
  normalizeRecurrenceRule,
  normalizeReminderOffset,
  parseQuickAdd,
  parseRecurrenceRule
} from './quick-add'
import { normalizeDateKey, normalizeTime, toDateKey } from './dates'

/** CC Switch 默认监听本机 Anthropic 兼容网关。 */
export const AI_DEFAULT_BASE_URL = 'http://127.0.0.1:15721'
/** 模型名必须与 /v1/models 返回的 id 完全一致。 */
export const AI_DEFAULT_MODEL = 'ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash'
export const AI_DEFAULT_TIMEOUT_MS = 15_000
export const AI_ANTHROPIC_VERSION = '2023-06-01'

/**
 * 推理模型会先输出 thinking 块，max_tokens 同时覆盖 thinking 与正文。
 * 预算过小（例如 256）时经常只有 thinking、没有 JSON，从而误降级；
 * 这里给各功能留出足够余量，max_tokens 只是上限，不会强制生成更多内容。
 */
export const AI_QUICK_ADD_MAX_TOKENS = 1200
export const AI_SUBTASKS_MAX_TOKENS = 1600
export const AI_SUMMARY_MAX_TOKENS = 1600
export const AI_CONNECTION_MAX_TOKENS = 768

export interface AiConfig {
  enabled: boolean
  baseUrl: string
  model: string
  token: string
  timeoutMs: number
}

export type AiSource = 'ai' | 'rule'

export interface AiQuickAddResponse {
  ok: boolean
  source: AiSource
  result: QuickAddResult
  warning: string | null
  /** 失败时的请求次数：大于 1 表示瞬时故障已自动重试过。 */
  attempts?: number
}

export interface AiSubtaskDraft {
  title: string
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  allDay: boolean
}

export interface AiSubtasksResponse {
  ok: boolean
  source: AiSource
  subtasks: AiSubtaskDraft[]
  warning: string | null
  attempts?: number
}

export interface AiSummaryTask {
  title: string
  status: TaskStatus
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  listName: string
  /** 未完成且截止日期早于总结日期，供 AI 直接区分逾期项。 */
  overdue: boolean
}

export const AI_WEEKLY_MAX_TOKENS = 1600

/** 周复盘输入：最近 7 天的完成/新增/专注，100% 来自本机统计。 */
export interface AiWeeklyInput {
  startDate: string
  endDate: string
  days: Array<{ date: string; completed: number; focusMinutes: number }>
  overdue: number
  createdTotal: number
  completedTotal: number
}

export interface AiWeeklyReview {
  summary: string
  wins: string[]
  risks: string[]
  nextWeek: string[]
}

export interface AiWeeklyResponse {
  ok: boolean
  source: AiSource
  review: AiWeeklyReview
  warning: string | null
  attempts?: number
}

export interface AiSummaryInput {
  date: string
  tasks: AiSummaryTask[]
  completedCount: number
  openCount: number
  overdueCount: number
}

export interface AiTodaySummary {
  summary: string
  highlights: string[]
  suggestions: string[]
}

export interface AiSummaryResponse {
  ok: boolean
  source: AiSource
  summary: AiTodaySummary
  warning: string | null
  attempts?: number
}

export interface AiTestResult {
  ok: boolean
  message: string
  model?: string
  latencyMs?: number
  attempts?: number
}

export interface AiModelInfo {
  id: string
  displayName: string | null
}

export interface AiModelsResult {
  ok: boolean
  models: AiModelInfo[]
  message: string
  attempts?: number
}

/** 解析 /v1/models：兼容 Anthropic 的 { data: [...] } 与纯数组，id 保持逐字不变。 */
export function normalizeAiModels(raw: unknown): AiModelInfo[] {
  const payload =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(payload?.data)
      ? (payload.data as unknown[])
      : Array.isArray(payload?.models)
        ? (payload.models as unknown[])
        : []
  const models: AiModelInfo[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const record =
      typeof item === 'string'
        ? { id: item }
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null
    if (!record) continue
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || seen.has(id)) continue
    const display =
      typeof record.display_name === 'string'
        ? record.display_name.trim()
        : typeof record.displayName === 'string'
          ? record.displayName.trim()
          : ''
    seen.add(id)
    models.push({ id, displayName: display || null })
    if (models.length >= 200) break
  }
  return models
}

const PRIORITY_BY_TEXT: Record<string, Priority> = {
  高: 3,
  紧急: 3,
  重要: 3,
  中: 2,
  低: 1
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function weekdayLabel(date: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

export function describeAiError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 用户主动取消（Esc / 「取消」按钮）时的统一文案，必须与超时区分开。 */
export const AI_CANCELED_MESSAGE = 'AI 请求已取消'

/** 三个 AI 入口各自的取消提示：main 回传 warning，renderer 直接展示，避免两边各写一套。 */
export const AI_CANCELED_QUICK_ADD_HINT = '已取消 AI 解析'
export const AI_CANCELED_SUMMARY_HINT = '已取消 AI 总结生成'
export const AI_CANCELED_SUBTASKS_HINT = '已取消 AI 拆解'
export const AI_CANCELED_MODELS_HINT = '已取消获取模型列表'

/**
 * 请求被用户取消：既不是超时也不是网络故障，不重试、不弹失败提示。
 * 放在 shared 里是因为 main 与 renderer 都要判断。
 */
export class AiCanceledError extends Error {
  constructor(message: string = AI_CANCELED_MESSAGE) {
    super(message)
    this.name = 'AiCanceledError'
  }
}

export function isAiCanceled(error: unknown): boolean {
  if (error instanceof AiCanceledError) return true
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'AiCanceledError') {
    return true
  }
  return describeAiError(error).includes(AI_CANCELED_MESSAGE)
}

export type AiFailureKind =
  | 'disabled'
  | 'canceled'
  | 'timeout'
  | 'network'
  | 'busy'
  | 'auth'
  | 'model'
  | 'http'
  | 'empty'
  | 'invalid'
  | 'unknown'

export interface AiFailureInfo {
  kind: AiFailureKind
  /** 网络抖动、限流、5xx 这类瞬时故障值得自动重试；超时不重试，否则等待时间翻倍。 */
  retryable: boolean
  /** 展示给用户的提示：说明发生了什么，并给出下一步该做什么。 */
  hint: string
}

const AI_HTTP_STATUS_PATTERN = /(?:接口|模型列表)返回\s*(\d{3})/i

/** 从 Base URL 取出主机名，用在“连不上服务”的提示里。 */
export function aiEndpointHost(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? '').trim() || AI_DEFAULT_BASE_URL
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

/** 把可操作的提示与原始错误拼在一起，原始错误已包含在提示里时不重复。 */
function composeAiHint(friendly: string, raw: string): string {
  const detail = raw.trim()
  if (!detail || friendly.includes(detail)) return friendly
  return `${friendly} · ${detail}`
}

/**
 * 给 AI 失败分类，并生成一句可操作的提示。
 * 提示既说明原因（超时多少秒、连不上哪个地址、HTTP 状态），
 * 也说明下一步（调大超时、启动 CC Switch、核对模型 ID、检查 Token），
 * 避免只显示“AI 调用失败”这种无法自助排查的文案。
 * attempts 大于 1 时会在提示末尾标注“已自动重试 N 次”。
 */
export function describeAiFailure(
  error: unknown,
  config?: Pick<AiConfig, 'baseUrl' | 'timeoutMs'>,
  attempts = 1
): AiFailureInfo {
  const raw = describeAiError(error).trim()
  const statusMatch = AI_HTTP_STATUS_PATTERN.exec(raw)
  const status = statusMatch ? Number(statusMatch[1]) : null
  const seconds = Math.max(1, Math.round((config?.timeoutMs ?? AI_DEFAULT_TIMEOUT_MS) / 1000))

  let kind: AiFailureKind
  let retryable = false
  let friendly: string

  if (/AI 已关闭|未配置模型|输入为空|任务标题为空/.test(raw)) {
    kind = 'disabled'
    friendly = raw || 'AI 已关闭或未配置模型'
  } else if (isAiCanceled(error) || /已取消 AI (?:解析|总结|拆解)/.test(raw)) {
    // 取消必须排在超时之前判断：两者都会表现为 AbortError，但取消不该提示“调大超时”。
    kind = 'canceled'
    friendly = AI_CANCELED_QUICK_ADD_HINT
  } else if (
    status !== null &&
    (status === 408 || status === 425 || status === 429 || status >= 500)
  ) {
    kind = 'busy'
    retryable = true
    friendly = status === 429 ? 'AI 服务限流，请稍后再试' : 'AI 服务繁忙，请稍后再试'
  } else if (status === 401 || status === 403) {
    kind = 'auth'
    friendly = 'AI 鉴权失败，请检查设置里的 Token（本机服务通常留空）'
  } else if (status === 400 || status === 404 || status === 422) {
    kind = 'model'
    friendly = '模型或请求不可用，请在设置页用「获取模型列表」逐字核对模型 ID'
  } else if (status !== null) {
    kind = 'http'
    friendly = 'AI 接口请求被拒绝，请稍后再试'
  } else if (/模型列表为空/.test(raw)) {
    kind = 'empty'
    friendly = 'AI 模型列表为空，请确认 CC Switch 已加载模型'
  } else if (/模型列表请求超时/.test(raw)) {
    // 目录超时与正文请求超时分开说明，用户能分清是设置页还是任务解析出了问题。
    kind = 'timeout'
    friendly = `AI 模型列表请求超时（${seconds} 秒），请确认 CC Switch 已启动或调大超时`
  } else if (/超时|timeout|timed out|AbortError/i.test(raw)) {
    kind = 'timeout'
    friendly = `AI 请求超时（${seconds} 秒），可在设置里调大超时或换更快的模型`
  } else if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|EPIPE|ETIMEDOUT|fetch failed|Failed to fetch|NetworkError|network|socket hang up|拒绝|断开/i.test(
      raw
    )
  ) {
    kind = 'network'
    retryable = true
    friendly = `连接不上 AI 服务（${aiEndpointHost(config?.baseUrl)}），请确认 CC Switch 已启动`
  } else if (/推理过程|输出预算|正文为空|内容为空/.test(raw)) {
    kind = 'empty'
    friendly = 'AI 返回正文为空，请重试或换一个输出更稳定的模型'
  } else if (/无法识别|结构无法|不是 JSON|不是JSON/i.test(raw)) {
    kind = 'invalid'
    friendly = 'AI 返回内容无法解析，已按本地规则处理'
  } else {
    kind = 'unknown'
    friendly = 'AI 调用失败'
  }

  const retrySuffix = attempts > 1 ? `（已自动重试 ${attempts - 1} 次）` : ''
  return { kind, retryable, hint: `${composeAiHint(friendly, raw)}${retrySuffix}` }
}

/** 是否值得自动重试：只重试瞬时故障，超时与参数类错误不重试。 */
export function isRetryableAiError(
  error: unknown,
  config?: Pick<AiConfig, 'baseUrl' | 'timeoutMs'>
): boolean {
  return describeAiFailure(error, config).retryable
}

/**
 * 把数据库里的 ISO 时间戳（UTC）转成本地日期键。
 * 直接截取 ISO 前 10 位会在 UTC+8 等时区把凌晨完成的任务算到前一天，
 * 因此“今日完成”统计必须走本地时区；非法时间戳返回 null。
 */
export function localDateKeyFromIso(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return toDateKey(date)
}

/** 配置读取：设置页保存的值优先，缺省时回落到本机 CC Switch。 */
export function aiConfigFromSettings(
  settings: Pick<Settings, 'aiEnabled' | 'aiBaseUrl' | 'aiModel' | 'aiToken' | 'aiTimeoutMs'>
): AiConfig {
  const timeout = Number(settings.aiTimeoutMs)
  return {
    enabled: settings.aiEnabled !== false,
    baseUrl: settings.aiBaseUrl?.trim() || AI_DEFAULT_BASE_URL,
    model: settings.aiModel?.trim() || AI_DEFAULT_MODEL,
    token: settings.aiToken?.trim() ?? '',
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1000
        ? Math.min(timeout, 120_000)
        : AI_DEFAULT_TIMEOUT_MS
  }
}

function normalizePriority(value: unknown): Priority {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(3, Math.round(value))) as Priority
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^[0-3]$/.test(trimmed)) return Number(trimmed) as Priority
    return PRIORITY_BY_TEXT[trimmed] ?? 0
  }
  return 0
}

function normalizeStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.replace(/^#/, '').trim()
    if (!text || result.includes(text)) continue
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

/** 从可能带 Markdown 代码块或解释文字的回复中提取第一个 JSON 值。 */
export function parseAiJson(text: string): unknown {
  if (!text) return null
  let source = text.trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) source = fenced[1].trim()

  const start = source.search(/[{[]/)
  if (start < 0) return null
  const open = source[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * 校验并收敛 AI 返回的快速添加结构；标题为空或结构非法时返回 null。
 * 这里不替 AI 补日期：只有 dueTime 时保持 dueDate 为 null，
 * 由 mergeQuickAddWithRule 用规则解析结果补齐，避免把“明天 15:00”补成今天。
 */
export function normalizeAiQuickAdd(raw: unknown, now: Date = new Date()): QuickAddResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!title) return null

  const dueTime = normalizeTime(record.dueTime)
  const dueDate = normalizeDateKey(record.dueDate)
  // 模型偶尔会用中文写 recurrence（“每周一三五”）或给出 INTERVAL=0 这类非法值：
  // 先统一成合法 RRULE，中文短语再走同一套本地规则翻译，仍失败则留空由规则补齐。
  const recurrence =
    normalizeRecurrenceRule(record.recurrence) ??
    (typeof record.recurrence === 'string'
      ? parseRecurrenceRule(record.recurrence, now)
      : null)
  const listName = typeof record.listName === 'string' ? record.listName.trim() : ''

  return {
    title,
    priority: normalizePriority(record.priority),
    tags: normalizeStringList(record.tags, 8),
    listName: listName || null,
    dueDate,
    dueTime,
    allDay: dueTime ? false : record.allDay === false ? false : true,
    recurrence,
    reminderOffsetMin: normalizeReminderOffset(
      record.reminderMinutes ?? record.reminderOffsetMin
    )
  }
}

/**
 * AI 常会在用户没提清单时按任务内容猜一个清单，写进错误清单比留在当前清单更难发现。
 * 只有清单名（忽略大小写与空白）原样出现在用户输入里时才采纳 AI 的 listName。
 */
export function isListNameMentioned(input: string, listName: string | null): boolean {
  if (!listName) return false
  const normalize = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
  const name = normalize(listName)
  return name.length > 0 && normalize(input).includes(name)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 去掉标题里残留的 #标签、!优先级、~清单 显式标记。 */
function stripExplicitQuickAddMarkers(title: string, rule: QuickAddResult): string {
  let rest = title
  for (const tag of rule.tags) {
    rest = rest.replace(new RegExp(`[#＃]\\s*${escapeRegExp(tag)}`, 'gi'), ' ')
  }
  if (rule.listName) {
    rest = rest.replace(new RegExp(`[~～]\\s*${escapeRegExp(rule.listName)}`, 'g'), ' ')
  }
  rest = rest.replace(/!\s*(?:高|中|低|紧急|重要|[123])/g, ' ')
  return rest.replace(/\s+/g, ' ').trim()
}

/**
 * AI 结果与本地规则合并，规则只在 AI 缺失时补充：
 * - #标签、!优先级、~清单 是用户显式写出的确定性信息，规则结果覆盖 AI；
 * - 日期、时间、重复以 AI 为准，但 AI 漏掉时用规则解析补齐，
 *   避免“明天下午3点”被模型只返回标题后丢掉日期时间；
 * - 标题里残留的显式标记会被清掉。
 */
export function mergeQuickAddWithRule(
  ai: QuickAddResult,
  rule: QuickAddResult,
  now: Date = new Date()
): QuickAddResult {
  const tags = [...ai.tags]
  for (const tag of rule.tags) {
    if (!tags.includes(tag)) tags.push(tag)
  }
  const dueTime = ai.dueTime ?? rule.dueTime
  const dueDate =
    ai.dueDate ?? rule.dueDate ?? (dueTime ? toDateKey(now) : null)
  return {
    ...ai,
    title: stripExplicitQuickAddMarkers(ai.title, rule) || ai.title,
    priority: rule.priority > 0 ? rule.priority : ai.priority,
    tags: tags.slice(0, 8),
    listName: rule.listName ?? ai.listName,
    dueDate,
    dueTime,
    recurrence: ai.recurrence ?? rule.recurrence,
    allDay: dueTime ? false : ai.dueDate || !rule.dueDate ? ai.allDay : rule.allDay,
    // 没有截止日期时提前量无法落到具体时刻，留空避免创建“永不触发”的提醒。
    reminderOffsetMin: dueDate
      ? (ai.reminderOffsetMin ?? rule.reminderOffsetMin)
      : null
  }
}

function normalizeSubtaskTitle(title: string | null | undefined): string {
  return typeof title === 'string' ? title.replace(/\s+/g, '').toLowerCase() : ''
}

/**
 * 过滤掉与主任务或已有子任务重名（忽略大小写与空白）的拆解结果。
 * 重复点击 AI 拆解或模型重复建议时，避免给同一任务反复添加相同子任务。
 */
export function filterNewSubtasks(
  drafts: AiSubtaskDraft[],
  existingTitles: Array<string | null | undefined>
): AiSubtaskDraft[] {
  const seen = new Set<string>()
  for (const title of existingTitles) {
    const key = normalizeSubtaskTitle(title)
    if (key) seen.add(key)
  }

  const result: AiSubtaskDraft[] = []
  for (const draft of drafts) {
    const key = normalizeSubtaskTitle(draft.title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(draft)
  }
  return result
}

/** 校验 AI 拆解结果，兼容 {subtasks:[...]} 与纯数组两种输出。 */
export function normalizeAiSubtasks(raw: unknown): AiSubtaskDraft[] | null {
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).subtasks)
      ? ((raw as Record<string, unknown>).subtasks as unknown[])
      : null
  if (!items) return null

  const drafts: AiSubtaskDraft[] = []
  for (const item of items) {
    const record =
      typeof item === 'string'
        ? { title: item }
        : item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null
    if (!record) continue
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const titleKey = normalizeSubtaskTitle(title)
    if (!title || drafts.some((draft) => normalizeSubtaskTitle(draft.title) === titleKey)) {
      continue
    }
    const dueTime = normalizeTime(record.dueTime)
    drafts.push({
      title,
      priority: normalizePriority(record.priority),
      dueDate: normalizeDateKey(record.dueDate),
      dueTime,
      allDay: dueTime ? false : record.allDay === false ? false : true
    })
    if (drafts.length >= 10) break
  }
  return drafts.length > 0 ? drafts : null
}

/** 校验 AI 总结结构。 */
export function normalizeAiSummary(raw: unknown): AiTodaySummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) return null
  return {
    summary,
    highlights: normalizeStringList(record.highlights, 5),
    suggestions: normalizeStringList(record.suggestions, 5)
  }
}

/** 快速添加原有规则解析，作为 AI 不可用时的一级降级。 */
export function ruleQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  return parseQuickAdd(input, now)
}

/** 子任务规则拆解：按换行/分号/顿号拆分标题与备注，重复内容去重。 */
export function ruleSubtasks(input: { title: string; notes?: string }): AiSubtaskDraft[] {
  const source = `${input.title}\n${input.notes ?? ''}`
  const parts = source
    .split(/[\n;；]+|[,，、]/)
    .map((part) => part.replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, '').trim())
    .filter((part) => part.length > 0 && part.length <= 60)

  const titleKey = input.title.trim()
  const drafts: AiSubtaskDraft[] = []
  for (const part of parts) {
    if (part === titleKey) continue
    if (drafts.some((draft) => draft.title === part)) continue
    drafts.push({ title: part, priority: 0, dueDate: null, dueTime: null, allDay: true })
    if (drafts.length >= 8) break
  }
  return drafts
}

/** 今日总结规则降级：基于任务数量、优先级和逾期情况生成稳定的本地文案。 */
export function ruleDailySummary(input: AiSummaryInput): AiTodaySummary {
  const openTasks = input.tasks.filter((task) => task.status === 'open')
  const highPriority = openTasks
    .filter((task) => task.priority >= 3)
    .map((task) => task.title)
    .slice(0, 3)
  const timed = openTasks
    .filter((task) => task.dueTime)
    .sort((a, b) => String(a.dueTime).localeCompare(String(b.dueTime)))[0]

  let summary: string
  if (input.tasks.length === 0) {
    summary = `${input.date} 没有安排任务，可以先规划今天最重要的一件事。`
  } else if (input.openCount === 0) {
    summary = `${input.date} 共 ${input.tasks.length} 个任务，已全部完成，节奏不错。`
  } else {
    summary = `${input.date} 共 ${input.tasks.length} 个任务，已完成 ${input.completedCount} 个，剩余 ${input.openCount} 个`
    summary += input.overdueCount > 0 ? `，其中 ${input.overdueCount} 个已逾期。` : '。'
  }

  const highlights: string[] = []
  if (timed?.dueTime) highlights.push(`下一个时间点：${timed.dueTime} ${timed.title}`)
  if (highPriority.length > 0) highlights.push(`高优先级：${highPriority.join('、')}`)
  if (input.completedCount > 0) highlights.push(`今日已完成 ${input.completedCount} 个任务`)

  const suggestions: string[] = []
  if (input.overdueCount > 0) {
    const overdue = openTasks
      .filter((task) => task.dueDate && task.dueDate < input.date)
      .map((task) => task.title)
      .slice(0, 2)
    suggestions.push(`先处理逾期任务${overdue.length ? `：${overdue.join('、')}` : ''}`)
  }
  if (highPriority.length > 0) suggestions.push('把精力最好的时段留给高优先级任务')
  if (input.openCount === 0) suggestions.push('留 10 分钟复盘今天，并规划明天')
  if (suggestions.length === 0) suggestions.push('按 25 分钟番茄钟逐项推进，及时记录进展')

  return { summary, highlights, suggestions }
}

export function buildQuickAddPrompt(
  input: string,
  context: { now: Date; lists: string[] }
): string {
  const date = toDateKey(context.now)
  const listText = context.lists.length ? context.lists.join('、') : '（无）'
  return [
    `当前时间：${date} ${weekdayLabel(context.now)} ${pad2(context.now.getHours())}:${pad2(
      context.now.getMinutes()
    )}`,
    `可用清单：${listText}`,
    `用户输入：${input}`,
    '请把输入解析成一个任务，只返回 JSON，不要 Markdown 代码块或解释。',
    '字段：title（必填，去掉日期/标签/优先级等修饰后的任务标题）、dueDate（YYYY-MM-DD 或 null）、dueTime（HH:mm 或 null）、allDay（布尔）、priority（0=无 1=低 2=中 3=高）、tags（字符串数组，不含 #）、listName（仅当用户输入中明确出现某个可用清单名时填写；否则必须为 null，不要根据任务内容猜测）、recurrence（RFC5545 RRULE；没有则 null。“每3天/每隔两天”→FREQ=DAILY;INTERVAL=3；“隔天”→FREQ=DAILY;INTERVAL=2；“每两周”→FREQ=WEEKLY;INTERVAL=2；“每两周的周二”→FREQ=WEEKLY;INTERVAL=2;BYDAY=TU；“周一到周五/工作日”→FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR；“每周一三五/每周一、三、五/每周一/三/五”→BYDAY=MO,WE,FR；“每个周二/每周的周二”→FREQ=WEEKLY;BYDAY=TU；“每个周一、周三”→FREQ=WEEKLY;BYDAY=MO,WE；“每月5号”→FREQ=MONTHLY;BYMONTHDAY=5；“每月1号和15号”→FREQ=MONTHLY;BYMONTHDAY=1,15；“每年3月5日/每年三月五日”→FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=5；“每月第一个周一”→FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1；“每月第2个和第4个周二”→FREQ=MONTHLY;BYDAY=2TU,4TU；“每月最后一个周五/每月最后1个周五”→FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1；“每月最后一个工作日”→FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1；“每季度”→FREQ=MONTHLY;INTERVAL=3；“每季度第一天”→FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1；“每季度最后一天”→FREQ=YEARLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1；“本周/下周/上周的星期区间”（如“下周一到周五”）是一次性日期范围：dueDate 填范围第一天、recurrence 必须为 null）、reminderMinutes（提前提醒的整数分钟；没有则 null。“提前30分钟”→30，“提前1小时”→60，“提前一天”→1440，“提前提醒半小时”→30，“提前提醒：半小时”→30，“提醒我提前半小时”→30，“提前一个半小时”→90，“提前两天半”→3600）。',
    '口语时间要换算成具体值：“今晚8点”→当天 20:00；“明早”→次日 08:00；“明晚”→次日 20:00；“月底”→当月最后一天；“本周末”→最近的周六；“30分钟后/一小时后/一个半小时后”→当前时间加上偏移后的日期与时间。只说时段、没说钟点（如“下午 开会”）按默认钟点：凌晨 06:00、早上 08:00、上午 09:00、中午 12:00、下午 15:00、傍晚 18:00、晚上 20:00。',
    '用户输入中的 #标签、!优先级（如 !高）、~清单 是显式语法，必须原样保留到 tags / priority / listName，且不要留在 title 里。',
    '相对日期以“当前时间”为基准；没有日期或时间时 dueDate/dueTime 返回 null。“上周五/上个月15号”要落在过去的对应日期，“下下周三/下下个月15号”要落在两周/两个月后的对应日期；中文数字日期（“三月五号”“下个月十五号”）也要换算成具体日期。只说“提前提醒”但没给截止日期时 reminderMinutes 仍可填写，客户端会提示无法创建提醒。'
  ].join('\n')
}

export function buildSubtasksPrompt(input: {
  title: string
  notes?: string
  listName?: string
  existingSubtasks?: string[]
}): string {
  const existing = (input.existingSubtasks ?? [])
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 30)
  return [
    `主任务：${input.title}`,
    input.listName ? `所属清单：${input.listName}` : '',
    input.notes ? `备注：${input.notes}` : '',
    existing.length ? `已有子任务（不要重复，也不要改写）：${existing.join('、')}` : '',
    '请把主任务拆解为 3-8 个可独立执行的子任务，只返回 JSON，不要 Markdown 代码块或解释。',
    '格式：{"subtasks":[{"title":"子任务标题","priority":0}]}。priority 为 0-3，可省略。',
    '子任务要具体、动词开头、彼此不重复；不要输出与主任务或已有子任务同名的条目。'
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSummaryPrompt(input: AiSummaryInput): string {
  return [
    `日期：${input.date}`,
    `任务统计：共 ${input.tasks.length} 个，未完成 ${input.openCount} 个，已完成 ${input.completedCount} 个，逾期 ${input.overdueCount} 个。`,
    `任务列表：${JSON.stringify(
      input.tasks.map((task) => ({
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        list: task.listName,
        overdue: task.overdue
      }))
    )}`,
    '请用中文写一份简短的今日计划总结，只返回 JSON，不要 Markdown 代码块或解释。',
    '格式：{"summary":"两句话以内的整体判断","highlights":["最多3条重点"],"suggestions":["最多3条可执行建议"]}。',
    '语气务实、具体，不要编造不存在的任务。'
  ].join('\n')
}

export const AI_QUICK_ADD_SYSTEM =
  '你是任务管理应用 TickFlow 的解析器。你只输出严格 JSON，不输出解释或 Markdown。'
export const AI_SUBTASK_SYSTEM =
  '你是任务拆解助手。你只输出严格 JSON，不输出解释或 Markdown。'
export const AI_SUMMARY_SYSTEM =
  '你是务实的每日计划助手。你只输出严格 JSON，不输出解释或 Markdown。'

export const AI_WEEKLY_SYSTEM =
  '你是务实的每周复盘助手。你只输出严格 JSON，不输出解释或 Markdown。'

/** 周复盘规则降级：不依赖 AI 也能给出可读统计与建议。 */
export function ruleWeeklyReview(input: AiWeeklyInput): AiWeeklyReview {
  const totalDone = input.days.reduce((sum, day) => sum + day.completed, 0)
  const totalCreated = input.createdTotal
  const focus = input.days.reduce((sum, day) => sum + day.focusMinutes, 0)
  const best = [...input.days].sort((a, b) => b.completed - a.completed)[0]
  const summary =
    `${input.startDate} 到 ${input.endDate}：完成 ${totalDone} 个任务，新建 ${totalCreated} 个，专注 ${focus} 分钟` +
    (input.overdue > 0 ? `，当前仍有 ${input.overdue} 个逾期。` : '。')
  const wins: string[] = []
  if (best && best.completed > 0) wins.push(`${best.date} 完成最多（${best.completed} 个）`)
  if (focus > 0) wins.push(`累计专注 ${focus} 分钟`)
  if (totalDone >= totalCreated && totalDone > 0) wins.push('完成数不低于新增数，积压没有变大')
  const risks: string[] = []
  if (input.overdue > 0) risks.push(`还有 ${input.overdue} 个任务逾期未处理`)
  if (totalCreated > totalDone + 3) risks.push('新增明显多于完成，待办在变多')
  return {
    summary,
    wins: wins.slice(0, 4),
    risks: risks.slice(0, 4),
    nextWeek: [
      '先清掉逾期任务，再排新任务',
      '把最难的一件事放在效率最高的时段',
      '每天留一段不被打断的专注时间'
    ]
  }
}

/** 校验 AI 周复盘结构。 */
export function normalizeAiWeekly(raw: unknown): AiWeeklyReview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) return null
  return {
    summary,
    wins: normalizeStringList(record.wins, 4),
    risks: normalizeStringList(record.risks, 4),
    nextWeek: normalizeStringList(record.nextWeek, 4)
  }
}

export function buildWeeklyPrompt(input: AiWeeklyInput): string {
  const lines = input.days.map(
    (day) => `${day.date}：完成 ${day.completed}，专注 ${day.focusMinutes} 分钟`
  )
  return [
    '请根据下面一周的数据写复盘，只输出 JSON：',
    '{"summary":"两三句总结","wins":["做得好"],"risks":["风险"],"nextWeek":["下周建议"]}',
    `区间：${input.startDate} 至 ${input.endDate}`,
    `逾期未完成：${input.overdue}；本周新建：${input.createdTotal}；本周完成合计：${input.completedTotal}`,
    ...lines
  ].join(String.fromCharCode(10))
}

/** 从任务集合中筛出“今日相关”任务，供总结使用（未完成今日/逾期 + 今日完成）。 */
export function buildSummaryInput(tasks: TaskWithMeta[], date: string): AiSummaryInput {
  const seen = new Set<string>()
  const relevant: TaskWithMeta[] = []
  for (const task of tasks) {
    if (seen.has(task.id)) continue
    // 完成时间在数据库中是 UTC ISO，必须换算成本地日期，
    // 否则 UTC+8 凌晨完成的任务会被归到前一天。
    const completedToday =
      task.status === 'completed' && localDateKeyFromIso(task.completedAt) === date
    // 只有未完成且截止日期不晚于今天的任务才算今日待办；
    // 已完成任务只看完成时间，不因截止日期是今天而重复计入。
    const openDueTodayOrOverdue =
      task.status === 'open' && Boolean(task.dueDate && task.dueDate <= date)
    if (!completedToday && !openDueTodayOrOverdue) continue
    seen.add(task.id)
    relevant.push(task)
  }

  const rows: AiSummaryTask[] = relevant.map((task) => ({
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    listName: task.listName,
    overdue: task.status === 'open' && Boolean(task.dueDate && task.dueDate < date)
  }))

  return {
    date,
    tasks: rows,
    completedCount: rows.filter((task) => task.status === 'completed').length,
    openCount: rows.filter((task) => task.status === 'open').length,
    overdueCount: rows.filter((task) => task.overdue).length
  }
}
