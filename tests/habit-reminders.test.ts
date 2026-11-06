// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { createHabit, deleteHabit, updateHabit } from '../src/main/db/habits'
import {
  advanceHabitReminder,
  getHabitReminder,
  listDueHabitReminders,
  listHabitReminderCenter,
  nextDailyTrigger,
  setHabitReminder
} from '../src/main/db/habit-reminders'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
})

describe('habit reminders', () => {
  it('计算下一次每日提醒时间', () => {
    const morning = new Date(2026, 10, 5, 8, 0, 0)
    expect(nextDailyTrigger('09:30', morning)).toBe(
      new Date(2026, 10, 5, 9, 30, 0).toISOString()
    )

    const late = new Date(2026, 10, 5, 10, 0, 0)
    expect(nextDailyTrigger('09:30', late)).toBe(
      new Date(2026, 10, 6, 9, 30, 0).toISOString()
    )
    expect(() => nextDailyTrigger('25:00', morning)).toThrow('HH:MM')
  })

  it('保存、读取并清除习惯提醒', () => {
    const habit = createHabit(db, { name: '阅读' })
    const reminder = setHabitReminder(db, habit.id, '09:30')

    expect(reminder).not.toBeNull()
    expect(getHabitReminder(db, habit.id)?.triggerAt).toBe(reminder?.triggerAt)
    expect(setHabitReminder(db, habit.id, null)).toBeNull()
    expect(getHabitReminder(db, habit.id)).toBeNull()
  })

  it('到点后可查询并对次日重排', () => {
    const habit = createHabit(db, { name: '喝水' })
    const reminder = setHabitReminder(db, habit.id, '09:30')
    if (!reminder) throw new Error('missing reminder')
    const checkedAt = new Date(new Date(reminder.triggerAt).getTime() + 60_000)

    const due = listDueHabitReminders(db, checkedAt.toISOString())
    expect(due).toHaveLength(1)
    expect(due[0]?.habitName).toBe('喝水')

    advanceHabitReminder(
      db,
      reminder.id,
      checkedAt.toISOString(),
      nextDailyTrigger('09:30', checkedAt)
    )

    const center = listHabitReminderCenter(db, checkedAt.toISOString())
    expect(center.habitRecent).toHaveLength(1)
    expect(center.habitRecent[0]?.sentAt).toBe(checkedAt.toISOString())
    expect(center.habitUpcoming).toHaveLength(1)
    expect(listDueHabitReminders(db, checkedAt.toISOString())).toHaveLength(0)
  })

  it('归档或删除习惯时清理提醒', () => {
    const archived = createHabit(db, { name: '冥想' })
    setHabitReminder(db, archived.id, '07:00')
    updateHabit(db, archived.id, { archived: true })
    expect(getHabitReminder(db, archived.id)).toBeNull()

    const removed = createHabit(db, { name: '跑步' })
    setHabitReminder(db, removed.id, '18:00')
    deleteHabit(db, removed.id)
    expect(getHabitReminder(db, removed.id)).toBeNull()
  })

  it('拒绝为不存在的习惯设置提醒', () => {
    expect(() => setHabitReminder(db, 'missing', '09:00')).toThrow('习惯不存在')
  })
})
