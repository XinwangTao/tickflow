import { describe, expect, it } from 'vitest'
import {
  localTimeOf,
  nextDailyTrigger,
  notificationIdFor
} from '../mobile/src/habit-reminder-time'

describe('mobile habit reminder time', () => {
  it('当天未过时间取当天，已过则顺延到明天', () => {
    const morning = new Date(2026, 10, 7, 8, 0, 0)
    const next = new Date(nextDailyTrigger('09:00', morning))
    expect(next.getFullYear()).toBe(2026)
    expect(next.getMonth()).toBe(10)
    expect(next.getDate()).toBe(7)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)

    const evening = new Date(2026, 10, 7, 21, 0, 0)
    const tomorrow = new Date(nextDailyTrigger('09:00', evening))
    expect(tomorrow.getDate()).toBe(8)
    expect(tomorrow.getHours()).toBe(9)
  })

  it('非法时间格式直接报错', () => {
    expect(() => nextDailyTrigger('25:00')).toThrow('HH:MM')
    expect(() => nextDailyTrigger('9:00')).toThrow('HH:MM')
  })

  it('从 ISO 取回本地 HH:MM', () => {
    const date = new Date(2026, 10, 7, 7, 5, 0)
    expect(localTimeOf(date.toISOString())).toBe('07:05')
  })

  it('通知 id 稳定且为正整数', () => {
    const first = notificationIdFor('habit-abc')
    const second = notificationIdFor('habit-abc')
    expect(first).toBe(second)
    expect(Number.isInteger(first)).toBe(true)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(2 ** 31)
    expect(notificationIdFor('habit-xyz')).not.toBe(first)
  })
})
