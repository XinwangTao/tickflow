import { fromDateKey, toDateKey } from '@shared/dates'

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return `${year}年${month}月`
}

export function monthDays(monthKey: string, weekStart: 0 | 1): Date[] {
  const [year, month] = monthKey.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const offset =
    weekStart === 1 ? (first.getDay() === 0 ? 6 : first.getDay() - 1) : first.getDay()
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function weekDays(anchorKey: string, weekStart: 0 | 1): Date[] {
  const anchor = fromDateKey(anchorKey)
  const day = anchor.getDay()
  const offset = weekStart === 1 ? (day === 0 ? 6 : day - 1) : day
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - offset)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function weekdayLabels(weekStart: 0 | 1): string[] {
  const base = ['日', '一', '二', '三', '四', '五', '六']
  return weekStart === 1 ? [...base.slice(1), base[0]] : base
}

export function weekLabel(anchorKey: string, weekStart: 0 | 1 = 1): string {
  const days = weekDays(anchorKey, weekStart)
  const start = days[0]
  const end = days[6]
  return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`
}

export function shiftDateKey(key: string, days: number): string {
  const date = fromDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}
