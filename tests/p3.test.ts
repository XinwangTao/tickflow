// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, setTaskStatus } from '../src/main/db/tasks'
import {
  createHabit,
  deleteHabit,
  listHabits,
  toggleHabitLog
} from '../src/main/db/habits'
import { createPomodoroSession, listPomodoroSessions } from '../src/main/db/pomodoro'
import { getStatsOverview } from '../src/main/db/stats'
import { addDaysToKey, startOfWeekKey, todayKey } from '../src/shared/dates'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('P3 habits', () => {
  it('创建、打卡、连续天数与删除', () => {
    const habit = createHabit(db, {
      name: '喝水',
      icon: '💧',
      color: '#0091ff',
      frequency: 'daily',
      targetPerWeek: 7
    })
    const today = todayKey()
    toggleHabitLog(db, habit.id, today)
    toggleHabitLog(db, habit.id, addDaysToKey(today, -1))
    toggleHabitLog(db, habit.id, addDaysToKey(today, -2))

    const [withStats] = listHabits(db)
    expect(withStats.name).toBe('喝水')
    expect(withStats.logs).toHaveLength(3)
    expect(withStats.currentStreak).toBe(3)
    expect(withStats.longestStreak).toBe(3)
    const weekStart = startOfWeekKey(today, 1)
    const expectedWeekCount = [today, addDaysToKey(today, -1), addDaysToKey(today, -2)].filter(
      (date) => date >= weekStart
    ).length
    expect(withStats.weekCount).toBe(expectedWeekCount)

    toggleHabitLog(db, habit.id, today)
    const [afterToggle] = listHabits(db)
    expect(afterToggle.logs).toHaveLength(2)
    expect(afterToggle.currentStreak).toBe(2)

    deleteHabit(db, habit.id)
    expect(listHabits(db)).toHaveLength(0)
  })
})

describe('P3 pomodoro', () => {
  it('记录并查询专注会话', () => {
    const now = new Date()
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    const to = new Date(now)
    to.setHours(23, 59, 59, 999)

    const session = createPomodoroSession(db, {
      mode: 'focus',
      durationMinutes: 25,
      startedAt: now.toISOString(),
      endedAt: new Date(now.getTime() + 25 * 60_000).toISOString(),
      completed: true
    })
    createPomodoroSession(db, {
      mode: 'break',
      durationMinutes: 5,
      startedAt: new Date(now.getTime() + 25 * 60_000).toISOString(),
      endedAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      completed: true
    })

    const sessions = listPomodoroSessions(db, from.toISOString(), to.toISOString())
    expect(sessions).toHaveLength(2)
    expect(sessions.some((item) => item.id === session.id)).toBe(true)
  })
})

describe('P3 stats overview', () => {
  it('汇总完成、逾期、专注与习惯数据', () => {
    const listId = getInboxId(db)
    const completed = createTask(db, { listId, title: '完成的任务' })
    setTaskStatus(db, completed.id, 'completed')
    createTask(db, {
      listId,
      title: '逾期任务',
      dueDate: addDaysToKey(todayKey(), -1),
      allDay: true
    })
    createTask(db, { listId, title: '无日期任务' })

    const habit = createHabit(db, { name: '阅读', color: '#30a46c' })
    toggleHabitLog(db, habit.id, todayKey())

    const now = new Date()
    createPomodoroSession(db, {
      mode: 'focus',
      durationMinutes: 25,
      startedAt: now.toISOString(),
      endedAt: new Date(now.getTime() + 25 * 60_000).toISOString(),
      completed: true
    })

    const overview = getStatsOverview(db)
    expect(overview.tasksCompleted7d).toBe(1)
    expect(overview.tasksCompleted30d).toBe(1)
    expect(overview.overdue).toBe(1)
    expect(overview.completedByDay.at(-1)?.count).toBe(1)
    expect(overview.focusMinutes7d).toBe(25)
    expect(overview.focusSessions7d).toBe(1)
    expect(overview.focusByDay.at(-1)?.minutes).toBe(25)
    expect(overview.habitCheckins7d).toBe(1)
    expect(overview.habitByDay.at(-1)?.count).toBe(1)
    expect(overview.topHabits[0]?.name).toBe('阅读')
    expect(overview.byList.find((item) => item.name === '收集箱')?.count).toBe(2)

    deleteHabit(db, habit.id)
    expect(getStatsOverview(db).habitCheckins7d).toBe(0)
  })
})
