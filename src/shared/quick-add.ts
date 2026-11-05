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

function nextWeekday(base: Date, target: number, mode: 'next' | 'this' | 'nextweek'): Date {
  const current = base.getDay()
  if (mode === 'this') return addDays(base, target - current)
  if (mode === 'nextweek') return addDays(base, 7 - current + target)
  return addDays(base, (target - current + 7) % 7)
}

interface RecurrenceParse {
  rrule: string
  matched: string
  first: Date
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

  match = text.match(/每月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const day = Number(match[1])
    const first = new Date(base.getFullYear(), base.getMonth(), day)
    if (first.getTime() < base.getTime()) first.setMonth(first.getMonth() + 1)
    return {
      rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}`,
      matched: match[0],
      first
    }
  }

  match = text.match(/每(?:周|星期|礼拜)([一二三四五六日天])/)
  if (match) {
    const weekday = WEEKDAY_MAP[match[1]]
    return {
      rrule: `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[weekday]}`,
      matched: match[0],
      first: nextWeekday(base, weekday, 'next')
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
    const first = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate())
    return { rrule: 'FREQ=MONTHLY', matched: match[0], first }
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

  match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (!Number.isNaN(date.getTime())) return { date, matched: match[0] }
  }

  match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const date = new Date(base.getFullYear(), Number(match[1]) - 1, Number(match[2]))
    if (date.getTime() < base.getTime()) date.setFullYear(date.getFullYear() + 1)
    return { date, matched: match[0] }
  }

  match = text.match(/(?<!\d)(\d{1,2})[-/](\d{1,2})(?!\d)/)
  if (match) {
    const date = new Date(base.getFullYear(), Number(match[1]) - 1, Number(match[2]))
    if (date.getTime() < base.getTime()) date.setFullYear(date.getFullYear() + 1)
    return { date, matched: match[0] }
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

  match = text.match(/(下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/)
  if (match) {
    const mode = match[1] === '下' ? 'nextweek' : match[1] === '本' || match[1] === '这' ? 'this' : 'next'
    return { date: nextWeekday(base, WEEKDAY_MAP[match[2]], mode), matched: match[0] }
  }

  if (text.includes('下周')) return { date: addDays(base, 7), matched: '下周' }

  match = text.match(/下个?月/)
  if (match) {
    const date = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate())
    return { date, matched: match[0] }
  }

  return { date: null, matched: null }
}

interface TimeParse {
  time: string | null
  matched: string | null
}

function parseTime(text: string): TimeParse {
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
    if (!match) return { time: null, matched: null }
    period = match[1] || ''
    hour = Number(match[2])
    if (match[3] === '半') minute = 30
    else if (match[4]) minute = Number(match[4])
  }

  if (hour > 23 || minute > 59) return { time: null, matched: null }

  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
    if (hour < 12) hour += 12
  } else if (period === '中午') {
    if (hour < 11) hour += 12
  } else if (period === '凌晨') {
    if (hour === 12) hour = 0
  }

  return { time: `${pad2(hour)}:${pad2(minute)}`, matched: match[0] }
}

/**
 * 解析快速添加输入：
 *   明天下午3点 交周报 #工作 !高 ~收集箱
 *   每周一 晨会
 *   3月5日 10:30 体检
 */
export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let rest = input

  const tags: string[] = []
  rest = rest.replace(/[#＃]([^\s#＃]+)/g, (_full, name: string) => {
    tags.push(name)
    return ' '
  })

  let priority: Priority = 0
  rest = rest.replace(/!(高|中|低|紧急|重要|[123])/g, (_full, value: string) => {
    if (value === '高' || value === '紧急' || value === '重要' || value === '3') priority = 3
    else if (value === '中' || value === '2') priority = 2
    else priority = 1
    return ' '
  })

  let listName: string | null = null
  rest = rest.replace(/[~～]([^\s~～]+)/g, (_full, name: string) => {
    listName = name
    return ' '
  })

  const base = startOfDay(now)

  const recurrence = parseRecurrence(rest, base)
  if (recurrence) rest = rest.replace(recurrence.matched, ' ')

  const dateParse = parseDate(rest, base)
  if (dateParse.matched) rest = rest.replace(dateParse.matched, ' ')

  const timeParse = parseTime(rest)
  if (timeParse.matched) rest = rest.replace(timeParse.matched, ' ')

  let date = dateParse.date
  if (!date && timeParse.time) date = base
  if (!date && recurrence) date = recurrence.first

  const title =
    rest
      .replace(/\s+/g, ' ')
      .replace(/^[\s,，。;；:：]+|[\s,，。;；:：]+$/g, '')
      .trim() || '新任务'

  return {
    title,
    priority,
    tags: Array.from(new Set(tags)),
    listName,
    dueDate: date ? toDateKey(date) : null,
    dueTime: timeParse.time,
    allDay: timeParse.time ? false : true,
    recurrence: recurrence ? recurrence.rrule : null
  }
}
