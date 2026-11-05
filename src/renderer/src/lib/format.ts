import { formatDateLabel, formatDueLabel, isOverdue } from '@shared/dates'

const DAY_NAMES: Record<string, string> = {
  SU: '日',
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六'
}

export function describeRecurrence(rule: string): string {
  const upper = rule.toUpperCase()
  const parts: Record<string, string> = {}
  for (const segment of upper.split(';')) {
    const [key, value] = segment.split('=')
    if (key && value) parts[key] = value
  }

  if (parts.FREQ === 'DAILY') return '每天'
  if (parts.FREQ === 'WEEKLY') {
    if (parts.BYDAY) {
      const codes = parts.BYDAY.split(',')
      if (codes.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((code) => codes.includes(code))) {
        return '工作日'
      }
      return `每周${codes.map((code) => DAY_NAMES[code] ?? code).join('、')}`
    }
    return '每周'
  }
  if (parts.FREQ === 'MONTHLY') {
    return parts.BYMONTHDAY ? `每月${parts.BYMONTHDAY}日` : '每月'
  }
  if (parts.FREQ === 'YEARLY') {
    return parts.BYMONTH && parts.BYMONTHDAY
      ? `每年${parts.BYMONTH}月${parts.BYMONTHDAY}日`
      : '每年'
  }
  return rule
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function localDateTimeToIso(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(
    year,
    month - 1,
    day,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  ).toISOString()
}

export function isoToLocalDateTime(iso: string): { date: string; time: string } {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export { formatDateLabel, formatDueLabel, isOverdue }
