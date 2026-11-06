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

  match = text.match(/每月\s*(\d{1,2})\s*[日号]/)
  if (match) {
    const day = Number(match[1])
    return {
      rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}`,
      matched: match[0],
      first: nextMonthlyDate(base, day)
    }
  }

  // “周一到周五”“周一到周三”：起止都含；跨周时按周一起算一圈。
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
      const first = Math.min(
        ...days.map((weekday) => nextWeekday(base, weekday, 'next').getTime())
      )
      return {
        rrule: `FREQ=WEEKLY;BYDAY=${days.map((weekday) => WEEKDAY_CODES[weekday]).join(',')}`,
        matched: match[0],
        first: new Date(first)
      }
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
      return {
        rrule: interval > 1 ? `FREQ=${freq};INTERVAL=${interval}` : `FREQ=${freq}`,
        matched: match[0],
        first
      }
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

  match = text.match(/(\d{1,2})\s*天\s*(?:以)?后/)
  if (match) return { date: addDays(base, Number(match[1])), matched: match[0] }

  match = text.match(/(\d{1,2})\s*个?\s*(?:周|星期|礼拜)\s*(?:以)?后/)
  if (match) return { date: addDays(base, Number(match[1]) * 7), matched: match[0] }

  match = text.match(/(\d{1,2})\s*个?\s*月\s*(?:以)?后/)
  if (match) {
    const date = addMonths(
      base.getFullYear(),
      base.getMonth(),
      Number(match[1]),
      base.getDate()
    )
    if (date) return { date, matched: match[0] }
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
    if (!match) return { time: null, matched: null }
    period = match[1] || ''
    hour = Number(match[2])
    if (match[3] === '半') minute = 30
    else if (match[4]) minute = Number(match[4])
  }

  const time = formatParsedTime(period, hour, minute)
  return time ? { time, matched: match[0] } : { time: null, matched: null }
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
