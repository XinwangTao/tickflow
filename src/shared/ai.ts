import type { Priority, Settings, TaskStatus, TaskWithMeta } from './types'
import type { QuickAddResult } from './quick-add'
import { parseQuickAdd } from './quick-add'
import { toDateKey } from './dates'

/** CC Switch 默认监听本机 Anthropic 兼容网关。 */
export const AI_DEFAULT_BASE_URL = 'http://127.0.0.1:15721'
/** 模型名必须与 /v1/models 返回的 id 完全一致。 */
export const AI_DEFAULT_MODEL = 'ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash'
export const AI_DEFAULT_TIMEOUT_MS = 15_000
export const AI_ANTHROPIC_VERSION = '2023-06-01'

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
}

export interface AiSummaryTask {
  title: string
  status: TaskStatus
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  listName: string
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
}

export interface AiTestResult {
  ok: boolean
  message: string
  model?: string
  latencyMs?: number
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

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${pad2(hour)}:${pad2(minute)}`
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

/** 校验并收敛 AI 返回的快速添加结构；标题为空或结构非法时返回 null。 */
export function normalizeAiQuickAdd(raw: unknown, now: Date = new Date()): QuickAddResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!title) return null

  const dueTime = normalizeTime(record.dueTime)
  const dueDate = normalizeDateKey(record.dueDate)
  const recurrence =
    typeof record.recurrence === 'string' && /^FREQ=/i.test(record.recurrence.trim())
      ? record.recurrence.trim().toUpperCase()
      : null
  const listName = typeof record.listName === 'string' ? record.listName.trim() : ''

  return {
    title,
    priority: normalizePriority(record.priority),
    tags: normalizeStringList(record.tags, 8),
    listName: listName || null,
    dueDate: dueDate ?? (dueTime ? toDateKey(now) : null),
    dueTime,
    allDay: dueTime ? false : record.allDay === false ? false : true,
    recurrence
  }
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
    if (!title || drafts.some((draft) => draft.title === title)) continue
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
    '字段：title（必填，去掉日期/标签/优先级等修饰后的任务标题）、dueDate（YYYY-MM-DD 或 null）、dueTime（HH:mm 或 null）、allDay（布尔）、priority（0=无 1=低 2=中 3=高）、tags（字符串数组，不含 #）、listName（必须从可用清单中选择；无法确定时 null）、recurrence（RFC5545 RRULE，如 FREQ=WEEKLY;BYDAY=MO；没有则 null）。',
    '相对日期以“当前时间”为基准；没有日期或时间时 dueDate/dueTime 返回 null。'
  ].join('\n')
}

export function buildSubtasksPrompt(input: {
  title: string
  notes?: string
  listName?: string
}): string {
  return [
    `主任务：${input.title}`,
    input.listName ? `所属清单：${input.listName}` : '',
    input.notes ? `备注：${input.notes}` : '',
    '请把主任务拆解为 3-8 个可独立执行的子任务，只返回 JSON，不要 Markdown 代码块或解释。',
    '格式：{"subtasks":[{"title":"子任务标题","priority":0}]}。priority 为 0-3，可省略。',
    '子任务要具体、动词开头、彼此不重复；不要输出与主任务同名的条目。'
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
        dueTime: task.dueTime,
        list: task.listName
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

/** 从任务集合中筛出“今日相关”任务，供总结使用（未完成今日/逾期 + 今日完成）。 */
export function buildSummaryInput(tasks: TaskWithMeta[], date: string): AiSummaryInput {
  const seen = new Set<string>()
  const relevant: TaskWithMeta[] = []
  for (const task of tasks) {
    if (seen.has(task.id)) continue
    const completedToday =
      task.status === 'completed' && Boolean(task.completedAt?.slice(0, 10) === date)
    const dueTodayOrOverdue =
      task.status === 'open' && Boolean(task.dueDate && task.dueDate <= date)
    if (!completedToday && !dueTodayOrOverdue && task.dueDate !== date) continue
    seen.add(task.id)
    relevant.push(task)
  }

  const rows: AiSummaryTask[] = relevant.map((task) => ({
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    listName: task.listName
  }))

  return {
    date,
    tasks: rows,
    completedCount: relevant.filter((task) => task.status === 'completed').length,
    openCount: relevant.filter((task) => task.status === 'open').length,
    overdueCount: relevant.filter(
      (task) => task.status === 'open' && Boolean(task.dueDate && task.dueDate < date)
    ).length
  }
}
