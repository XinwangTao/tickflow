import type { Priority } from './types'
import { toDateKey } from './dates'

export interface QuickAddResult {
  title: string
  priority: Priority
  tags: string[]
  listName: string | null
  dueDate: string | null
  dueTime: string | null
  allDay: boolean
  recurrence: string | null
  /** 提前提醒的分钟数；0 表示在截止时刻提醒，null 表示不提醒。 */
  reminderOffsetMin: number | null
}

/** 提醒最多提前 30 天，避免“提前一年”这类输入把提醒排到很久以后。 */
export const REMINDER_MAX_OFFSET_MIN = 30 * 24 * 60

/** 全天任务没有具体时间，默认按 09:00 作为截止时刻计算提前量。 */
export const DEFAULT_ALL_DAY_REMINDER_TIME = '09:00'

/** 快速添加草稿里的常用提前量；不在列表里的值会动态补进下拉框。 */
export const REMINDER_OFFSET_CHOICES: Array<{ value: number | null; label: string }> = [
  { value: null, label: '不提醒' },
  { value: 0, label: '截止时提醒' },
  { value: 5, label: '提前 5 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
  { value: 120, label: '提前 2 小时' },
  { value: 1440, label: '提前 1 天' },
  { value: 2880, label: '提前 2 天' }
]

/** 收敛提前量：只接受 0–30 天的整数分钟，其余一律视为不提醒。 */
export function normalizeReminderOffset(value: unknown): number | null {
  const numeric =
    typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null
  const minutes = Math.round(numeric)
  if (minutes < 0 || minutes > REMINDER_MAX_OFFSET_MIN) return null
  return minutes
}

/** 给预览 chip 与草稿下拉框用的中文描述。 */
export function describeReminderOffset(minutes: number | null): string {
  if (minutes == null) return ''
  if (minutes === 0) return '截止时提醒'
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天提醒`
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时提醒`
  return `提前 ${minutes} 分钟提醒`
}

/**
 * 计算提醒触发时刻（本地时间 → UTC ISO）。
 * 没有截止日期或提前量非法时返回 null；全天任务按 09:00 计算。
 * 是否已经过去由调用方判断，避免这里依赖“当前时间”导致纯函数不可测。
 */
export function reminderTriggerAt(
  result: Pick<QuickAddResult, 'dueDate' | 'dueTime' | 'reminderOffsetMin'>,
  allDayTime: string = DEFAULT_ALL_DAY_REMINDER_TIME
): string | null {
  const offset = normalizeReminderOffset(result.reminderOffsetMin)
  if (offset === null || !result.dueDate) return null
  const [year, month, day] = result.dueDate.split('-').map(Number)
  const [hours, minutes] = (result.dueTime ?? allDayTime).split(':').map(Number)
  if (![year, month, day, hours, minutes].every(Number.isFinite)) return null
  const due = new Date(year, month - 1, day, hours, minutes, 0, 0)
  if (Number.isNaN(due.getTime())) return null
  return new Date(due.getTime() - offset * 60000).toISOString()
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const WEEKDAY_CODES_MONDAY_FIRST = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const RRULE_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])

/**
 * “今晚”“明天下午”这类只说了时段、没说钟点的写法，用一个默认钟点落到截止时间，
 * 避免出现“有日期但没有具体时间”的全天任务。
 */
const PERIOD_DEFAULT_TIMES: Record<string, string> = {
  凌晨: '06:00',
  早上: '08:00',
  早晨: '08:00',
  上午: '09:00',
  中午: '12:00',
  下午: '15:00',
  傍晚: '18:00',
  晚上: '20:00',
  夜里: '20:00'
}

/**
 * 时段词后面紧跟这些字时多半是“下午茶”“中午饭”“晚上好”这类普通词语，
 * 不能当成时间并从标题里摘掉。
 */
const PERIOD_WORD_SUFFIXES = new Set(['茶', '饭', '餐', '觉', '睡', '安', '好', '市'])

/**
 * “今晚”“明早”“昨晚”拆成“日期词 + 时段词”，后面的日期与时间解析就能各自命中，
 * 不用在每个解析器里各写一套组合。
 */
const DAY_PERIOD_ALIASES: Array<[RegExp, string]> = [
  [/今(晚上?|夜)/g, '今天晚上'],
  [/明(晚上?|夜)/g, '明天晚上'],
  [/昨(晚上?|夜)/g, '昨天晚上'],
  [/今(早上?|晨)/g, '今天早上'],
  [/明(早上?|晨)/g, '明天早上'],
  [/昨(早上?|晨)/g, '昨天早上'],
  // “每晚8点”“每早7点”省掉了“天”，补齐后重复与时段解析都能各自命中。
  [/每(晚上?|夜)/g, '每天晚上'],
  [/每(早(?!饭|餐|睡|安|好)|晨)/g, '每天早上']
]

function normalizeDayWords(text: string): string {
  let output = text
  for (const [pattern, replacement] of DAY_PERIOD_ALIASES) {
    output = output.replace(pattern, replacement)
  }
  return output
}

function parseRruleInt(value: string, min: number, max: number, allowZero = false): number | null {
  if (!/^-?\d+$/.test(value)) return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) return null
  if (!allowZero && numeric === 0) return null
  return numeric
}

function normalizeRruleIntList(
  value: string,
  min: number,
  max: number,
  allowZero = false
): string | null {
  const numbers: number[] = []
  for (const raw of value.split(',')) {
    const numeric = parseRruleInt(raw.trim(), min, max, allowZero)
    if (numeric !== null && !numbers.includes(numeric)) numbers.push(numeric)
  }
  return numbers.length ? numbers.join(',') : null
}

function normalizeRruleByDay(value: string): string | null {
  const codes: string[] = []
  for (const raw of value.split(',')) {
    const item = raw.trim().toUpperCase()
    // 兼容 “MO” 与 “1MO/-1FR” 两种 RFC5545 BYDAY 写法。
    const match = item.match(/^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/)
    if (!match) continue
    const ordinal = match[1] && match[1] !== '+1' ? match[1].replace('+', '') : ''
    const code = `${ordinal}${match[2]}`
    if (!codes.includes(code)) codes.push(code)
  }
  if (codes.length === 0) return null
  // 普通星期码按周一→周日排序，界面展示稳定；带序号时保留模型给出的顺序。
  if (codes.every((code) => !/\d/.test(code))) {
    codes.sort(
      (a, b) =>
        WEEKDAY_CODES_MONDAY_FIRST.indexOf(a) - WEEKDAY_CODES_MONDAY_FIRST.indexOf(b)
    )
  }
  return codes.join(',')
}

/**
 * 校验并收敛 RRULE。AI 经常返回 `INTERVAL=0`、未知 FREQ 或中文星期，
 * 直接落库会让重复任务永远算不出下一次；这里只保留能确定解释的字段，
 * 无法识别时返回 null，由调用方回落到规则解析。
 */
export function normalizeRecurrenceRule(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let text = raw
    .trim()
    .replace(/^RRULE\s*:\s*/i, '')
    .replace(/[；，]/g, ';')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (!text) return null

  const parts = new Map<string, string>()
  for (const segment of text.split(';')) {
    const separator = segment.indexOf('=')
    if (separator <= 0) continue
    const key = segment.slice(0, separator)
    const value = segment.slice(separator + 1)
    if (key && value) parts.set(key, value)
  }

  const freq = parts.get('FREQ')
  if (!freq || !RRULE_FREQUENCIES.has(freq)) return null

  const output: string[] = [`FREQ=${freq}`]
  const interval = parts.get('INTERVAL')
  if (interval) {
    const numeric = parseRruleInt(interval, 1, 999)
    if (numeric !== null) output.push(`INTERVAL=${numeric}`)
  }
  const count = parts.get('COUNT')
  if (count) {
    const numeric = parseRruleInt(count, 1, 9999)
    if (numeric !== null) output.push(`COUNT=${numeric}`)
  }
  const until = parts.get('UNTIL')
  if (until && /^\d{8}(T\d{6}Z?)?$/.test(until)) output.push(`UNTIL=${until}`)

  const byDay = parts.get('BYDAY')
  if (byDay) {
    const normalized = normalizeRruleByDay(byDay)
    if (normalized) output.push(`BYDAY=${normalized}`)
  }
  const byMonth = parts.get('BYMONTH')
  if (byMonth) {
    const normalized = normalizeRruleIntList(byMonth, 1, 12)
    if (normalized) output.push(`BYMONTH=${normalized}`)
  }
  const byMonthDay = parts.get('BYMONTHDAY')
  if (byMonthDay) {
    const normalized = normalizeRruleIntList(byMonthDay, -31, 31)
    if (normalized) output.push(`BYMONTHDAY=${normalized}`)
  }
  const bySetPos = parts.get('BYSETPOS')
  if (bySetPos) {
    const normalized = normalizeRruleIntList(bySetPos, -366, 366)
    if (normalized) output.push(`BYSETPOS=${normalized}`)
  }
  const byHour = parts.get('BYHOUR')
  if (byHour) {
    const normalized = normalizeRruleIntList(byHour, 0, 23, true)
    if (normalized) output.push(`BYHOUR=${normalized}`)
  }
  const byMinute = parts.get('BYMINUTE')
  if (byMinute) {
    const normalized = normalizeRruleIntList(byMinute, 0, 59, true)
    if (normalized) output.push(`BYMINUTE=${normalized}`)
  }
  const bySecond = parts.get('BYSECOND')
  if (bySecond) {
    const normalized = normalizeRruleIntList(bySecond, 0, 59, true)
    if (normalized) output.push(`BYSECOND=${normalized}`)
  }
  const byWeekNo = parts.get('BYWEEKNO')
  if (byWeekNo) {
    const normalized = normalizeRruleIntList(byWeekNo, -53, 53)
    if (normalized) output.push(`BYWEEKNO=${normalized}`)
  }
  const byYearDay = parts.get('BYYEARDAY')
  if (byYearDay) {
    const normalized = normalizeRruleIntList(byYearDay, -366, 366)
    if (normalized) output.push(`BYYEARDAY=${normalized}`)
  }
  const weekStart = parts.get('WKST')
  if (weekStart && WEEKDAY_CODES.includes(weekStart)) output.push(`WKST=${weekStart}`)

  return output.join(';')
}

/** 把中文重复短语转成 RRULE；供 AI 返回中文 recurrence 时兜底。 */
export function parseRecurrenceRule(text: string, base: Date = new Date()): string | null {
  return parseRecurrence(text, startOfDay(base))?.rrule ?? null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeekMonday(base: Date): Date {
  return addDays(base, -((base.getDay() + 6) % 7))
}

function nextWeekday(base: Date, target: number, mode: 'next' | 'this' | 'nextweek'): Date {
  const current = base.getDay()
  if (mode === 'this' || mode === 'nextweek') {
    // “本周/下周”按周一开始的一周计算；周日是 offset 6，
    // 直接用 target-current 会在周中把“下周日”算成最近的周日。
    const monday = startOfWeekMonday(base)
    const offset = target === 0 ? 6 : target - 1
    return addDays(monday, mode === 'this' ? offset : 7 + offset)
  }
  return addDays(base, (target - current + 7) % 7)
}

interface WeekdaySelection {
  /** 星期索引（0=周日 … 6=周六），按周一→周日排序。 */
  days: number[]
  matched: string
}

/**
 * 解析紧跟在重复短语后面的星期写法：“的周二”“的周一、周三”“的周一到周五”。
 * 只从 `tail` 开头匹配，避免把标题里的“周三见”也吞掉。
 */
function parseWeekdaySelection(tail: string): WeekdaySelection | null {
  const range = tail.match(
    /^\s*(?:的)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])\s*(?:到|至|~|-)\s*(?:周|星期|礼拜)?\s*([一二三四五六日天])/
  )
  if (range) {
    const from = WEEKDAY_MAP[range[1]]
    const to = WEEKDAY_MAP[range[2]]
    if (Number.isInteger(from) && Number.isInteger(to)) {
      const span = (to - from + 7) % 7
      const days: number[] = []
      for (let index = 0; index <= span; index += 1) days.push((from + index) % 7)
      return { days, matched: range[0] }
    }
  }

  const list = tail.match(
    /^\s*(?:的)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天](?:\s*[、,，和及]?\s*(?:周|星期|礼拜)?\s*[一二三四五六日天])*)/
  )
  if (!list) return null
  const days = Array.from(
    new Set(
      Array.from(list[1].replace(/[、,，和及]/g, ''), (char) => WEEKDAY_MAP[char]).filter(
        (day): day is number => Number.isInteger(day)
      )
    )
  ).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  if (days.length === 0) return null
  return { days, matched: list[0] }
}

/** 某个星期里最早的一天（含今天）。 */
function earliestWeekday(base: Date, days: number[]): Date {
  return new Date(
    Math.min(...days.map((weekday) => nextWeekday(base, weekday, 'next').getTime()))
  )
}

function lastDayOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex + 1, 0)
}

function firstDayOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex, 1)
}

/** “本周末”= 本周六（已过则取今天）；“下周末”= 下周六。 */
function weekendDate(base: Date, mode: 'this' | 'next'): Date {
  const saturday = addDays(startOfWeekMonday(base), 5)
  if (mode === 'next') return addDays(saturday, 7)
  return saturday.getTime() < base.getTime() ? base : saturday
}

/** 构造本地日期；2 月 30 日这类溢出日期返回 null，而不是悄悄滚到 3 月。 */
function makeDate(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(year, monthIndex, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

/** 按自然月偏移；跨年（13 月）与月底溢出（1 月 31 日 + 1 月）都正确处理。 */
function addMonths(year: number, monthIndex: number, months: number, day: number): Date | null {
  const total = monthIndex + months
  const targetYear = year + Math.floor(total / 12)
  const targetMonth = ((total % 12) + 12) % 12
  return makeDate(targetYear, targetMonth, day)
}

/** 下一次“每月 N 号”：跳过不含该日的月份（如 2 月没有 31 号）。 */
function nextMonthlyDate(base: Date, day: number): Date {
  for (let offset = 0; offset < 13; offset += 1) {
    const date = addMonths(base.getFullYear(), base.getMonth(), offset, day)
    if (date && date.getTime() >= base.getTime()) return date
  }
  return addMonths(base.getFullYear(), base.getMonth(), 1, 1) ?? base
}

/** 当月第 N 个星期 X（nth 为负表示倒数第 N 个）；该月不存在时返回 null。 */
function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  nth: number
): Date | null {
  if (nth > 0) {
    const first = new Date(year, monthIndex, 1)
    const offset = (weekday - first.getDay() + 7) % 7
    return makeDate(year, monthIndex, 1 + offset + (nth - 1) * 7)
  }
  const last = new Date(year, monthIndex + 1, 0)
  const offset = (last.getDay() - weekday + 7) % 7
  return makeDate(year, monthIndex, last.getDate() - offset)
}

/** 下一次“每月第 N 个星期 X”；本月已过就顺延到下个月。 */
function nextMonthlyWeekday(base: Date, weekday: number, nth: number): Date | null {
  for (let offset = 0; offset < 13; offset += 1) {
    const month = addMonths(base.getFullYear(), base.getMonth(), offset, 1)
    if (!month) continue
    const date = nthWeekdayOfMonth(month.getFullYear(), month.getMonth(), weekday, nth)
    if (date && date.getTime() >= base.getTime()) return date
  }
  return null
}

interface RecurrenceParse {
  rrule: string
  matched: string
  first: Date
}

function parseCnCount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw)
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }
  if (raw === '十') return 10
  const tenIndex = raw.indexOf('十')
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[raw.slice(0, tenIndex)]
    const rest = raw.slice(tenIndex + 1)
    const ones = rest ? digits[rest] : 0
    if (tens && ones !== undefined) return tens * 10 + ones
    return null
  }
  return digits[raw] ?? null
}

const REMINDER_NUMBER = '([0-9]+|[一二两三四五六七八九十半]+)'
const REMINDER_UNIT = '(分钟|分|小时|钟头|天|日|周|星期|礼拜)'

function reminderUnitMinutes(unit: string): number {
  if (unit === '分钟' || unit === '分') return 1
  if (unit === '小时' || unit === '钟头') return 60
  if (unit === '周' || unit === '星期' || unit === '礼拜') return 7 * 24 * 60
  return 24 * 60
}

function reminderDurationMinutes(raw: string, unit: string): number | null {
  // “提前半小时”里的“半”不能走 parseCnCount。
  const value = raw === '半' ? 0.5 : parseCnCount(raw.replace(/^两/, '二'))
  if (!value || value <= 0) return null
  return normalizeReminderOffset(Math.round(value * reminderUnitMinutes(unit)))
}

interface ReminderParse {
  minutes: number
  matched: string
}

/**
 * 解析“提前提醒”。只认带明确提醒动词的写法，避免把“提前30分钟出发”
 * 这类普通时间描述误当成提醒并从标题里删掉：
 *   提前提醒30分钟 / 提前提醒我半小时 / 提前30分钟提醒 / 提前1小时通知我
 */
export function parseReminderOffset(text: string): ReminderParse | null {
  const patterns = [
    new RegExp(`提前\\s*提醒\\s*我?\\s*(?:一下)?\\s*${REMINDER_NUMBER}\\s*个?\\s*${REMINDER_UNIT}`),
    new RegExp(`提前\\s*${REMINDER_NUMBER}\\s*个?\\s*${REMINDER_UNIT}\\s*(?:之前)?\\s*(?:提醒我?|通知我?)(?:一下)?`)
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const minutes = reminderDurationMinutes(match[1], match[2])
    if (minutes !== null) return { minutes, matched: match[0] }
  }
  return null
}

const RELATIVE_OFFSET_UNITS: Record<string, number> = {
  分钟: 1,
  分: 1,
  小时: 60,
  钟头: 60
}

interface RelativeOffsetParse {
  minutes: number
  matched: string
}

/**
 * 解析“30分钟后”“一小时后”“半小时后”这类相对当前时刻的写法。
 * 与“3天后”不同，这种说法精确到分钟，会同时给出日期与时间。
 */
export function parseRelativeOffset(text: string): RelativeOffsetParse | null {
  const match = text.match(
    /([0-9]+|[一二两三四五六七八九十半]+)\s*个?\s*(分钟|分|小时|钟头)\s*(?:以|之)?后/
  )
  if (!match) return null
  const raw = match[1]
  const value = raw === '半' ? 0.5 : parseCnCount(raw.replace(/^两/, '二'))
  if (!value || value <= 0) return null
  const minutes = Math.round(value * RELATIVE_OFFSET_UNITS[match[2]])
  // 超过 30 天的相对偏移更像乱输入，保持原样交给其他规则/标题。
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 30 * 24 * 60) return null
  return { minutes, matched: match[0] }
}

function parseRecurrence(text: string, base: Date): RecurrenceParse | null {
  let match: RegExpMatchArray | null

  match = text.match(/每年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const month = Number(match[1])
    const day = Number(match[2])
    const first = new Date(base.getFullYear(), month - 1, day)
    if (first.getTime() < base.getTime()) first.setFullYear(first.getFullYear() + 1)
    return {
      rrule: `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${day}`,
      matched: match[0],
      first
    }
  }

  match = text.match(/每月\s*(?:的)?\s*最后\s*(?:一)?天/)
  if (match) {
    return {
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      matched: match[0],
      first: new Date(base.getFullYear(), base.getMonth() + 1, 0)
    }
  }

  // “每月底”与“每月最后一天”等价，只是口语写法。
  match = text.match(/每月\s*(?:的)?\s*(?:月)?\s*(?:底|末)/)
  if (match) {
    return {
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      matched: match[0],
      first: lastDayOfMonth(base.getFullYear(), base.getMonth())
    }
  }

  // “每月最后一个周五”“每月最后1个周五”：BYSETPOS=-1。
  match = text.match(
    /每月\s*(?:的)?\s*最后\s*(?:一)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/
  )
  if (match) {
    const weekday = WEEKDAY_MAP[match[1]]
    if (Number.isInteger(weekday)) {
      const first = nextMonthlyWeekday(base, weekday, -1)
      if (first) {
        return {
          rrule: `FREQ=MONTHLY;BYDAY=${WEEKDAY_CODES[weekday]};BYSETPOS=-1`,
          matched: match[0],
          first
        }
      }
    }
  }

  // “每月第一个周一”“每月第2个周四”：BYSETPOS=N。
  match = text.match(
    /每月\s*(?:的)?\s*第\s*([一二三四五1-5])\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/
  )
  if (match) {
    const nth = parseCnCount(match[1])
    const weekday = WEEKDAY_MAP[match[2]]
    if (nth && nth > 0 && Number.isInteger(weekday)) {
      const first = nextMonthlyWeekday(base, weekday, nth)
      if (first) {
        return {
          rrule: `FREQ=MONTHLY;BYDAY=${WEEKDAY_CODES[weekday]};BYSETPOS=${nth}`,
          matched: match[0],
          first
        }
      }
    }
  }

  match = text.match(/每月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const day = Number(match[1])
    return {
      rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}`,
      matched: match[0],
      first: nextMonthlyDate(base, day)
    }
  }

  // “每季度”“每半年”：RRULE 没有 QUARTERLY，统一用 MONTHLY+INTERVAL 表达。
  match = text.match(/每\s*(?:个)?\s*季度/)
  if (match) {
    return {
      rrule: 'FREQ=MONTHLY;INTERVAL=3',
      matched: match[0],
      first: base
    }
  }

  match = text.match(/每\s*(?:个)?\s*半年/)
  if (match) {
    return {
      rrule: 'FREQ=MONTHLY;INTERVAL=6',
      matched: match[0],
      first: base
    }
  }

  // “每3天”“每隔两天”“每两周”“每两个月”：带数量的周期，落到 INTERVAL。
  match = text.match(
    /每\s*(隔)?\s*([0-9]+|[一二两三四五六七八九十]+)\s*(天|日|周|星期|礼拜|个月|月|年)/
  )
  if (match) {
    const count = parseCnCount(match[2])
    if (count && count > 0) {
      // “每隔一天”= 两天一次（INTERVAL 2），而“每两天”也是 2。
      const interval = match[1] ? count + 1 : count
      const unit = match[3]
      const freq = unit === '天' || unit === '日'
        ? 'DAILY'
        : unit === '年'
          ? 'YEARLY'
          : unit === '个月' || unit === '月'
            ? 'MONTHLY'
            : 'WEEKLY'
      const first =
        freq === 'MONTHLY' ? nextMonthlyDate(base, base.getDate()) : base
      // “每两周的周二”“每2周的周一、周三”：周期与星期同时给出，合成 INTERVAL + BYDAY，
      // 首次日期取最近的一个星期，避免把“的周二”留在标题里。
      if (freq === 'WEEKLY') {
        const selection = parseWeekdaySelection(
          text.slice((match.index ?? 0) + match[0].length)
        )
        if (selection) {
          const prefix = interval > 1 ? `FREQ=WEEKLY;INTERVAL=${interval}` : 'FREQ=WEEKLY'
          return {
            rrule: `${prefix};BYDAY=${selection.days
              .map((weekday) => WEEKDAY_CODES[weekday])
              .join(',')}`,
            matched: match[0] + selection.matched,
            first: earliestWeekday(base, selection.days)
          }
        }
      }
      return {
        rrule: interval > 1 ? `FREQ=${freq};INTERVAL=${interval}` : `FREQ=${freq}`,
        matched: match[0],
        first
      }
    }
  }

  // “周一到周五”“周一到周三”：起止都含；跨周时按周一起算一圈。
  // 放在带数量的周期之后，避免“每两周的周一到周五”被这里的“周一到周五”抢先命中。
  match = text.match(
    /每?(?:周|星期|礼拜)\s*([一二三四五六日天])\s*(?:到|至|~|-)\s*(?:周|星期|礼拜)?\s*([一二三四五六日天])/
  )
  if (match) {
    const from = WEEKDAY_MAP[match[1]]
    const to = WEEKDAY_MAP[match[2]]
    if (Number.isInteger(from) && Number.isInteger(to)) {
      const span = (to - from + 7) % 7
      const days: number[] = []
      for (let i = 0; i <= span; i += 1) days.push((from + i) % 7)
      return {
        rrule: `FREQ=WEEKLY;BYDAY=${days.map((weekday) => WEEKDAY_CODES[weekday]).join(',')}`,
        matched: match[0],
        first: earliestWeekday(base, days)
      }
    }
  }

  // “每周末”是周六+周日，界面上按 BYDAY=SA,SU 展示。
  match = text.match(/每\s*(?:个)?\s*(?:周|星期|礼拜)\s*末/)
  if (match) {
    return {
      rrule: 'FREQ=WEEKLY;BYDAY=SA,SU',
      matched: match[0],
      first: earliestWeekday(base, [6, 0])
    }
  }

  match = text.match(
    /每(?:周|星期|礼拜)\s*([一二三四五六日天](?:\s*[、,，和及]?\s*(?:周|星期|礼拜)?\s*[一二三四五六日天])*)/
  )
  if (match) {
    // “每周一三五”“每周二、周四”支持多个星期；BYDAY 按周一→周日排序。
    const weekdays = Array.from(
      new Set(
        Array.from(match[1].replace(/[、,，和及]/g, ''), (char) => WEEKDAY_MAP[char]).filter(
          (day): day is number => Number.isInteger(day)
        )
      )
    ).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    if (weekdays.length > 0) {
      const first = weekdays
        .map((weekday) => nextWeekday(base, weekday, 'next').getTime())
        .sort((a, b) => a - b)[0]
      return {
        rrule: `FREQ=WEEKLY;BYDAY=${weekdays
          .map((weekday) => WEEKDAY_CODES[weekday])
          .join(',')}`,
        matched: match[0],
        first: new Date(first)
      }
    }
  }

  match = text.match(/(?:每个?)?工作日/)
  if (match) {
    return {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      matched: match[0],
      first: nextWeekday(base, 1, 'next')
    }
  }

  match = text.match(/每(?:周|星期|礼拜)/)
  if (match) {
    return { rrule: 'FREQ=WEEKLY', matched: match[0], first: base }
  }

  match = text.match(/每(?:天|日)/)
  if (match) {
    return { rrule: 'FREQ=DAILY', matched: match[0], first: base }
  }

  match = text.match(/每(?:周|星期|礼拜)/)
  if (match) {
    return { rrule: 'FREQ=WEEKLY', matched: match[0], first: base }
  }

  match = text.match(/每月/)
  if (match) {
    return {
      rrule: 'FREQ=MONTHLY',
      matched: match[0],
      first: nextMonthlyDate(base, base.getDate())
    }
  }

  match = text.match(/每年/)
  if (match) {
    const first = new Date(base.getFullYear() + 1, base.getMonth(), base.getDate())
    return { rrule: 'FREQ=YEARLY', matched: match[0], first }
  }

  return null
}

interface DateParse {
  date: Date | null
  matched: string | null
}

function parseDate(text: string, base: Date): DateParse {
  let match: RegExpMatchArray | null

  // “2027年1月1日”要整体消费年份，否则标题里会残留“2027年”。
  match = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const date = makeDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (date) return { date, matched: match[0] }
  }

  match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    const date = makeDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (date) return { date, matched: match[0] }
  }

  // “下个月15号”“本月20号”：日期跟在“月”后面，不能只消费“下个月”。
  match = text.match(/(下|本|这)\s*个?\s*月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const monthOffset = match[1] === '下' ? 1 : 0
    const date = addMonths(
      base.getFullYear(),
      base.getMonth(),
      monthOffset,
      Number(match[2])
    )
    if (date) return { date, matched: match[0] }
  }

  match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const month = Number(match[1]) - 1
    const day = Number(match[2])
    let date = makeDate(base.getFullYear(), month, day)
    if (date && date.getTime() < base.getTime()) {
      date = makeDate(base.getFullYear() + 1, month, day)
    }
    if (date) return { date, matched: match[0] }
  }

  match = text.match(/(?<!\d)(\d{1,2})[-/](\d{1,2})(?!\d)/)
  if (match) {
    const month = Number(match[1]) - 1
    const day = Number(match[2])
    let date = makeDate(base.getFullYear(), month, day)
    if (date && date.getTime() < base.getTime()) {
      date = makeDate(base.getFullYear() + 1, month, day)
    }
    if (date) return { date, matched: match[0] }
  }

  const relative: Array<[string, number]> = [
    ['大后天', 3],
    ['后天', 2],
    ['明天', 1],
    ['明日', 1],
    ['今天', 0],
    ['今日', 0],
    ['昨天', -1]
  ]
  for (const [word, offset] of relative) {
    if (text.includes(word)) return { date: addDays(base, offset), matched: word }
  }

  // “3天后 / 三天后”“2周后 / 两周后”“3个月后 / 两个月后”：数量支持中文数字。
  match = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*天\s*(?:以|之)?后/)
  if (match) {
    const days = parseCnCount(match[1].replace(/^两/, '二'))
    if (days && days > 0) return { date: addDays(base, days), matched: match[0] }
  }

  match = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*个?\s*(?:周|星期|礼拜)\s*(?:以|之)?后/)
  if (match) {
    const weeks = parseCnCount(match[1].replace(/^两/, '二'))
    if (weeks && weeks > 0) return { date: addDays(base, weeks * 7), matched: match[0] }
  }

  match = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*个?\s*月\s*(?:以|之)?后/)
  if (match) {
    const months = parseCnCount(match[1].replace(/^两/, '二'))
    if (months && months > 0) {
      const date = addMonths(base.getFullYear(), base.getMonth(), months, base.getDate())
      if (date) return { date, matched: match[0] }
    }
  }

  match = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*个?\s*年\s*(?:以|之)?后/)
  if (match) {
    const years = parseCnCount(match[1].replace(/^两/, '二'))
    if (years && years > 0) {
      const date = addMonths(base.getFullYear(), base.getMonth(), years * 12, base.getDate())
      if (date) return { date, matched: match[0] }
    }
  }

  // “半年后”= 六个月后。
  match = text.match(/半\s*年\s*(?:以|之)?后/)
  if (match) {
    const date = addMonths(base.getFullYear(), base.getMonth(), 6, base.getDate())
    if (date) return { date, matched: match[0] }
  }

  // “月底”“本月底”“下个月底”“12月底”：月末最后一天；“月初”类取当月 1 号。
  match = text.match(/(\d{1,2})\s*月\s*(底|末|初)\s*(?:之?前)?/)
  if (match) {
    const monthIndex = Number(match[1]) - 1
    const boundaryKind = match[2]
    const matchedText = match[0]
    if (monthIndex >= 0 && monthIndex <= 11) {
      const boundary = (year: number): Date =>
        boundaryKind === '初'
          ? firstDayOfMonth(year, monthIndex)
          : lastDayOfMonth(year, monthIndex)
      let date = boundary(base.getFullYear())
      if (date.getTime() < base.getTime()) date = boundary(base.getFullYear() + 1)
      return { date, matched: matchedText }
    }
  }

  match = text.match(/(本|这个|这|下)?\s*个?\s*月\s*(底|末|初)\s*(?:之?前)?/)
  if (match) {
    const isNextMonth = match[1] === '下'
    const year = base.getFullYear()
    const monthIndex = base.getMonth() + (isNextMonth ? 1 : 0)
    const anchor = firstDayOfMonth(year, monthIndex)
    let date = match[2] === '初'
      ? anchor
      : lastDayOfMonth(anchor.getFullYear(), anchor.getMonth())
    // “本月初”已经过去时落到下一个 1 号，避免建出立即逾期的任务。
    if (date.getTime() < base.getTime()) {
      date = firstDayOfMonth(anchor.getFullYear(), anchor.getMonth() + 1)
    }
    return { date, matched: match[0] }
  }

  // “本周末”“下周末”“周末”：周六（周日问“本周末”时就是今天）。
  match = text.match(/(本|这个|这|下)?\s*个?\s*(?:周|星期|礼拜)\s*末/)
  if (match) {
    const mode = match[1] === '下' ? 'next' : 'this'
    return { date: weekendDate(base, mode), matched: match[0] }
  }

  // “下个星期天”里的“个”也要一起消费；本周/下周按周一开始计算。
  match = text.match(/(下|本|这)?\s*个?\s*(?:周|星期|礼拜)([一二三四五六日天])/)
  if (match) {
    const mode =
      match[1] === '下' ? 'nextweek' : match[1] === '本' || match[1] === '这' ? 'this' : 'next'
    return { date: nextWeekday(base, WEEKDAY_MAP[match[2]], mode), matched: match[0] }
  }

  match = text.match(/(下+)\s*个?\s*(?:周|星期|礼拜)/)
  if (match) {
    return { date: addDays(base, 7 * match[1].length), matched: match[0] }
  }

  match = text.match(/下\s*个?\s*月/)
  if (match) {
    const date = addMonths(
      base.getFullYear(),
      base.getMonth(),
      1,
      base.getDate()
    )
    if (date) return { date, matched: match[0] }
  }

  return { date: null, matched: null }
}

interface TimeParse {
  time: string | null
  matched: string | null
}

function formatParsedTime(period: string, hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59) return null
  let h = hour
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
    if (h < 12) h += 12
  } else if (period === '中午') {
    if (h < 11) h += 12
  } else if (period === '凌晨') {
    if (h === 12) h = 0
  }
  return `${pad2(h)}:${pad2(minute)}`
}

const TIME_PERIOD = '(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里)'
const TIME_COMPACT = '(?:[:：]\\s*(\\d{2})|点\\s*(?:(半)|(\\d{1,2})\\s*分?)?)'

/**
 * 语音输入（Vosk）会把「下午三点」转成中文数字，规则解析只认阿拉伯数字，
 * 所以先只针对钟点位置做替换：跟「点/时/分」相邻的中文数字才翻译，
 * 避免把标题里的「第一天」「一起」之类改坏。
 */
function normalizeClockNumerals(text: string): string {
  return text
    .replace(/([一二两三四五六七八九十]{1,3})\s*(?=[点时])/g, (full, token: string) => {
      const value = parseCnCount(token)
      return value === null ? full : String(value)
    })
    .replace(/([一二两三四五六七八九十]{1,3})\s*分/g, (full, token: string) => {
      const value = parseCnCount(token)
      return value === null ? full : `${value}分`
    })
}

function parseTime(text: string): TimeParse {
  // “10点到11点”“15:30-16:30”只把开始时间作为截止时间，
  // 但要把整个区间从标题里消费掉，避免标题残留“到11点”。
  const range = text.match(
    new RegExp(
      `${TIME_PERIOD}?\\s*(\\d{1,2})\\s*${TIME_COMPACT}\\s*(?:到|至|[-~—])\\s*${TIME_PERIOD}?\\s*\\d{1,2}\\s*${TIME_COMPACT}`
    )
  )
  if (range) {
    const minute = range[3] ? Number(range[3]) : range[4] ? 30 : range[5] ? Number(range[5]) : 0
    const time = formatParsedTime(range[1] || '', Number(range[2]), minute)
    if (time) return { time, matched: range[0] }
  }

  let match = text.match(
    /(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/
  )
  let minute = 0
  let hour = 0
  let period = ''

  if (match) {
    period = match[1] || ''
    hour = Number(match[2])
    minute = Number(match[3])
  } else {
    match = text.match(
      /(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/
    )
    if (!match) {
      // 只说时段、没说钟点：“明天下午 开会”“晚上 跑步”落到该时段的默认钟点。
      // 逐个尝试，跳过“下午茶”“晚上好”这类普通词语。
      const periodOnly = /(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上|夜里)([\s\S]?)/g
      let candidate = periodOnly.exec(text)
      while (candidate) {
        const fallback = PERIOD_DEFAULT_TIMES[candidate[1]]
        if (fallback && !PERIOD_WORD_SUFFIXES.has(candidate[2] ?? '')) {
          return { time: fallback, matched: candidate[1] }
        }
        candidate = periodOnly.exec(text)
      }
      return { time: null, matched: null }
    }
    period = match[1] || ''
    hour = Number(match[2])
    if (match[3] === '半') minute = 30
    else if (match[4]) minute = Number(match[4])
  }

  const time = formatParsedTime(period, hour, minute)
  return time ? { time, matched: match[0] } : { time: null, matched: null }
}

export interface QuickAddDetails {
  result: QuickAddResult
  /** 输入里是否明确写了日期（“明天”“3月5日”），而不是由时间/重复规则推导出来的。 */
  explicitDate: boolean
}

/**
 * 解析快速添加输入，并额外告诉调用方日期是不是用户明确写出来的。
 * 日历行内添加需要这个区别：没写日期时以选中日期为准，
 * 只写了“9点”或“每3天”时不希望被解析成“今天”。
 */
export function parseQuickAddDetailed(input: string, now: Date = new Date()): QuickAddDetails {
  let rest = input

  const tags: string[] = []
  rest = rest.replace(/[#＃]([^\s#＃!！~～]+)/g, (_full, raw: string) => {
    // 标签后紧跟中文逗号/句号时不要把标点带进标签。
    const name = raw.replace(/[，。；;、,.]+$/, '')
    if (name) tags.push(name)
    return ' '
  })

  let priority: Priority = 0
  rest = rest.replace(/[!！](高|中|低|紧急|重要|[123])/g, (_full, value: string) => {
    if (value === '高' || value === '紧急' || value === '重要' || value === '3') priority = 3
    else if (value === '中' || value === '2') priority = 2
    else priority = 1
    return ' '
  })

  let listName: string | null = null
  rest = rest.replace(/[~～]([^\s~～#＃!！]+)/g, (_full, raw: string) => {
    const name = raw.replace(/[，。；;、,.]+$/, '')
    if (name) listName = name
    return ' '
  })

  const base = startOfDay(now)

  // “今晚”“明早”“昨晚”拆成“日期词 + 时段词”，交给日期与时间解析分别处理。
  rest = normalizeDayWords(rest)

  // “提前30分钟提醒”整段消费掉，不留在标题里；没有截止日期时仍保留提前量，
  // 由创建逻辑提示“未设置截止日期，提醒未创建”。
  const reminder = parseReminderOffset(rest)
  if (reminder) rest = rest.replace(reminder.matched, ' ')

  const recurrence = parseRecurrence(rest, base)
  if (recurrence) rest = rest.replace(recurrence.matched, ' ')

  // “30分钟后”“一小时后”是相对当前时刻的精确时间，直接给出日期与时间，
  // 不再让“30”之类的数字残留在标题里。
  const relative = parseRelativeOffset(rest)
  if (relative) rest = rest.replace(relative.matched, ' ')

  let date: Date | null = null
  let dueTime: string | null = null
  let explicitDate = Boolean(relative)
  if (relative) {
    const target = new Date(now.getTime() + relative.minutes * 60_000)
    date = target
    dueTime = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`
  } else {
    const dateParse = parseDate(rest, base)
    if (dateParse.matched) rest = rest.replace(dateParse.matched, ' ')

    const timeParse = parseTime(normalizeClockNumerals(rest))
    if (timeParse.matched) rest = rest.replace(timeParse.matched, ' ')

    date = dateParse.date
    dueTime = timeParse.time
    explicitDate = Boolean(dateParse.date)
    // 只写了重复与时间（“每周五下午”）时，首次日期跟着重复规则的第一次走，
    // 而不是被“下午”默认成今天；只写了时间（“下午 开会”）才落在今天。
    if (!date && recurrence) date = recurrence.first
    if (!date && dueTime) date = base
  }

  const title =
    rest
      .replace(/\s+/g, ' ')
      .replace(/^[\s,，。;；:：]+|[\s,，。;；:：]+$/g, '')
      .trim() || '新任务'

  return {
    result: {
      title,
      priority,
      tags: Array.from(new Set(tags)),
      listName,
      dueDate: date ? toDateKey(date) : null,
      dueTime,
      allDay: dueTime ? false : true,
      recurrence: recurrence ? recurrence.rrule : null,
      reminderOffsetMin: reminder ? reminder.minutes : null
    },
    explicitDate
  }
}

/**
 * 解析快速添加输入：
 *   明天下午3点 交周报 #工作 !高 ~收集箱
 *   每周一 晨会
 *   3月5日 10:30 体检
 */
export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  return parseQuickAddDetailed(input, now).result
}
