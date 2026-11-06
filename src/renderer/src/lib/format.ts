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

  const interval = Number(parts.INTERVAL)
  const every = Number.isInteger(interval) && interval > 1 ? interval : 1

  const dayNames = (value: string): string[] =>
    value
      .split(',')
      .map((code) => DAY_NAMES[code.trim()] ?? code.trim())
      .filter(Boolean)
  const weekdays = (days: string[]): string => days.map((day) => `周${day}`).join('、')
  const ordinal = (value: number): string => {
    if (value === -1) return '最后一个'
    if (value < 0) return `倒数第${Math.abs(value)}个`
    return `第${value}个`
  }
  /**
   * BYDAY 可能带序号（RFC5545 的 `2TU`、`-1FR`）：拆出“第 N 个 + 星期”，
   * 展示成“第2个周二”而不是把 `2TU` 原样丢给用户。
   */
  const ordinalDays = (
    value: string
  ): Array<{ position: number | null; day: string }> =>
    value
      .split(',')
      .map((item) => {
        const match = item.trim().toUpperCase().match(/^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/)
        if (!match) return null
        return {
          position: match[1] ? Number(match[1]) : null,
          day: DAY_NAMES[match[2]]
        }
      })
      .filter(
        (item): item is { position: number | null; day: string } => item !== null
      )

  if (parts.FREQ === 'DAILY') return every > 1 ? `每${every}天` : '每天'

  if (parts.FREQ === 'WEEKLY') {
    const base = every > 1 ? `每${every}周` : '每周'
    if (!parts.BYDAY) return base
    const days = dayNames(parts.BYDAY)
    if (days.length === 0) return base
    if (every === 1 && days.length === 5 && ['一', '二', '三', '四', '五'].every((day) => days.includes(day))) {
      return '工作日'
    }
    return every === 1 ? `每周${days.join('、')}` : `${base}的${weekdays(days)}`
  }

  if (parts.FREQ === 'MONTHLY') {
    // 兼容旧数据或 AI 返回的 MONTHLY;INTERVAL=3;BYMONTH=1,4,7,10;BYMONTHDAY=±1，
    // 展示回“每季度第一天/最后一天”，不要读成“每3个月1日”。
    if (
      every === 3 &&
      ((parts.BYMONTH === '1,4,7,10' && parts.BYMONTHDAY === '1') ||
        (parts.BYMONTH === '3,6,9,12' && parts.BYMONTHDAY === '-1'))
    ) {
      return parts.BYMONTHDAY === '1' ? '每季度第一天' : '每季度最后一天'
    }
    const base = every > 1 ? `每${every}个月` : '每月'
    if (parts.BYDAY && parts.BYSETPOS) {
      const days = dayNames(parts.BYDAY)
      const positions = parts.BYSETPOS.split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value !== 0)
      if (days.length && positions.length) {
        if (
          days.length === 5 &&
          ['一', '二', '三', '四', '五'].every((day) => days.includes(day))
        ) {
          return `${base}${positions.map(ordinal).join('、')}工作日`
        }
        return `${base}${positions.map(ordinal).join('、')}${weekdays(days)}`
      }
    }
    if (parts.BYDAY) {
      const parsed = ordinalDays(parts.BYDAY)
      if (parsed.length && parsed.every((item) => item.position !== null)) {
        const sameDay = parsed.every((item) => item.day === parsed[0].day)
        if (sameDay) {
          return `${base}${parsed
            .map((item) => ordinal(item.position as number))
            .join('、')}周${parsed[0].day}`
        }
        return `${base}${parsed
          .map((item) => `${ordinal(item.position as number)}周${item.day}`)
          .join('、')}`
      }
    }
    if (parts.BYMONTHDAY) {
      const days = parts.BYMONTHDAY.split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value !== 0)
        .map((value) => {
          if (value === -1) return '最后一天'
          if (value < 0) return `倒数第${Math.abs(value)}天`
          return `${value}日`
        })
      if (days.length) return `${base}${days.join('、')}`
    }
    return base
  }

  if (parts.FREQ === 'YEARLY') {
    const base = every > 1 ? `每${every}年` : '每年'
    if (
      every === 1 &&
      ((parts.BYMONTH === '1,4,7,10' && parts.BYMONTHDAY === '1') ||
        (parts.BYMONTH === '3,6,9,12' && parts.BYMONTHDAY === '-1'))
    ) {
      return parts.BYMONTHDAY === '1' ? '每季度第一天' : '每季度最后一天'
    }
    if (parts.BYMONTH && parts.BYMONTHDAY) {
      return `${base}${parts.BYMONTH}月${parts.BYMONTHDAY}日`
    }
    if (parts.BYMONTH) return `${base}${parts.BYMONTH}月`
    return base
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
