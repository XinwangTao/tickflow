import { describe, expect, it } from 'vitest'
import {
  addDaysToKey,
  diffDays,
  formatDateLabel,
  fromDateKey,
  isOverdue,
  startOfWeekKey,
  toDateKey
} from '../src/shared/dates'

describe('dates', () => {
  it('toDateKey 使用本地日期', () => {
    expect(toDateKey(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05')
  })

  it('fromDateKey 往返一致', () => {
    expect(toDateKey(fromDateKey('2026-02-28'))).toBe('2026-02-28')
  })

  it('addDaysToKey 跨月', () => {
    expect(addDaysToKey('2026-11-30', 2)).toBe('2026-12-02')
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('diffDays', () => {
    expect(diffDays('2026-11-06', '2026-11-05')).toBe(1)
    expect(diffDays('2026-11-05', '2026-11-05')).toBe(0)
  })

  it('formatDateLabel 使用相对词', () => {
    expect(formatDateLabel('2026-11-05', '2026-11-05')).toBe('今天')
    expect(formatDateLabel('2026-11-06', '2026-11-05')).toBe('明天')
    expect(formatDateLabel('2026-11-07', '2026-11-05')).toBe('后天')
    expect(formatDateLabel('2026-11-04', '2026-11-05')).toBe('昨天')
  })

  it('startOfWeekKey 周一/周日起始', () => {
    // 2026-11-05 是周四
    expect(startOfWeekKey('2026-11-05', 1)).toBe('2026-11-02')
    expect(startOfWeekKey('2026-11-05', 0)).toBe('2026-11-01')
  })

  it('isOverdue 判断日期与时间', () => {
    expect(isOverdue('2026-11-04', null, true, new Date(2026, 10, 5, 9))).toBe(true)
    expect(isOverdue('2026-11-05', '08:00', false, new Date(2026, 10, 5, 9))).toBe(true)
    expect(isOverdue('2026-11-05', '10:00', false, new Date(2026, 10, 5, 9))).toBe(false)
    expect(isOverdue('2026-11-05', null, true, new Date(2026, 10, 5, 23))).toBe(false)
  })
})
