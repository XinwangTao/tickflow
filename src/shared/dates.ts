/** 把 YYYY-M-D / YYYY-MM-DD 规范化成 YYYY-MM-DD；非法日期（如 2 月 30 日）返回 null。 */
export function normalizeDateKey(value: unknown): string | null {
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
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 把 H:M / HH:mm 规范化成 HH:mm；越界时间返回 null。 */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

export function addDaysToKey(key: string, days: number): string {
  const date = fromDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

export function diffDays(a: string, b: string): number {
  const ms = fromDateKey(a).getTime() - fromDateKey(b).getTime()
  return Math.round(ms / 86_400_000)
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

export function formatDateLabel(key: string, today: string = todayKey()): string {
  const delta = diffDays(key, today)
  if (delta === 0) return '今天'
  if (delta === 1) return '明天'
  if (delta === 2) return '后天'
  if (delta === -1) return '昨天'
  if (delta > 2 && delta < 7) return `周${WEEKDAY_CN[fromDateKey(key).getDay()]}`
  if (delta < -1 && delta > -7) return `周${WEEKDAY_CN[fromDateKey(key).getDay()]}`
  const date = fromDateKey(key)
  const now = fromDateKey(today)
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatDueLabel(
  dueDate: string | null,
  dueTime: string | null,
  allDay: boolean,
  today: string = todayKey()
): string {
  if (!dueDate) return ''
  const label = formatDateLabel(dueDate, today)
  if (allDay || !dueTime) return label
  return `${label} ${dueTime}`
}

export function isOverdue(
  dueDate: string | null,
  dueTime: string | null,
  allDay: boolean,
  now: Date = new Date()
): boolean {
  if (!dueDate) return false
  const today = todayKey(now)
  if (dueDate < today) return true
  if (dueDate > today) return false
  if (allDay || !dueTime) return false
  const [h, m] = dueTime.split(':').map(Number)
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  return now.getTime() > due.getTime()
}

export function startOfWeekKey(key: string, weekStartsOn: 0 | 1): string {
  const date = fromDateKey(key)
  const day = date.getDay()
  const diff = weekStartsOn === 1 ? (day === 0 ? -6 : 1 - day) : -day
  date.setDate(date.getDate() + diff)
  return toDateKey(date)
}
