// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, queryTasks } from '../src/main/db/tasks'
import { createHabit, listHabits, toggleHabitLog } from '../src/main/db/habits'
import { createPomodoroSession, listPomodoroSessions } from '../src/main/db/pomodoro'
import { getHabitReminder, setHabitReminder } from '../src/main/db/habit-reminders'
import { applySnapshot, buildSnapshot } from '../src/main/sync'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
  return db
}

function makeTask(db: DatabaseSync): void {
  const listId = getInboxId(db)
  createTask(db, {
    listId,
    title: '同步任务',
    notes: '备注',
    priority: 2,
    dueDate: '2026-11-05',
    allDay: true,
    tagNames: ['工作', '重要']
  })
}

describe('desktop sync snapshot', () => {
  let source: DatabaseSync
  let target: DatabaseSync

  beforeEach(() => {
    source = makeDb()
    target = makeDb()
    makeTask(source)
  })

  it('快照包含固定收集箱与任务标签', () => {
    const snapshot = buildSnapshot(source)
    expect(snapshot.version).toBe(1)
    expect(snapshot.lists).toHaveLength(1)
    expect(snapshot.lists[0].isInbox).toBe(true)
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0].tagNames.sort()).toEqual(['工作', '重要'].sort())
    expect(snapshot.deviceId).toBeTruthy()
  })

  it('应用到另一台设备后可查询到任务与标签', () => {
    const snapshot = buildSnapshot(source)
    const counts = applySnapshot(target, snapshot)
    expect(counts.tasks).toBe(1)
    const tasks = queryTasks(target, { view: 'inbox' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('同步任务')
    expect(tasks[0].priority).toBe(2)
    expect(tasks[0].tags.map((tag) => tag.name).sort()).toEqual(['工作', '重要'].sort())
    expect(tasks[0].listId).toBe(getInboxId(target))
  })

  it('重复应用同一快照保持幂等', () => {
    const snapshot = buildSnapshot(source)
    applySnapshot(target, snapshot)
    applySnapshot(target, snapshot)
    expect(queryTasks(target, { view: 'inbox' })).toHaveLength(1)
  })

  it('习惯、打卡、番茄与提醒随快照同步到另一台设备', () => {
    const habit = createHabit(source, { name: '喝水' })
    toggleHabitLog(source, habit.id, '2026-11-05')
    const session = createPomodoroSession(source, {
      mode: 'focus',
      durationMinutes: 25,
      startedAt: '2026-11-05T08:00:00.000Z',
      endedAt: '2026-11-05T08:25:00.000Z',
      completed: true
    })
    setHabitReminder(source, habit.id, '09:00')

    const snapshot = buildSnapshot(source)
    expect(snapshot.habits).toHaveLength(1)
    expect(snapshot.habitLogs).toHaveLength(1)
    expect(snapshot.pomodoroSessions).toHaveLength(1)
    expect(snapshot.habitReminders).toHaveLength(1)

    const counts = applySnapshot(target, snapshot)
    expect(counts).toMatchObject({
      habits: 1,
      habitLogs: 1,
      pomodoroSessions: 1,
      habitReminders: 1
    })

    const habits = listHabits(target)
    expect(habits).toHaveLength(1)
    expect(habits[0].name).toBe('喝水')
    expect(habits[0].logs).toHaveLength(1)
    const sessions = listPomodoroSessions(
      target,
      '2026-11-01T00:00:00.000Z',
      '2026-12-01T00:00:00.000Z'
    )
    expect(sessions.map((item) => item.id)).toContain(session.id)
    expect(getHabitReminder(target, habit.id)?.triggerAt).toBeTruthy()
  })

  it('取消打卡以 tombstone 同步，目标端不展示但保留记录', () => {
    const habit = createHabit(source, { name: '早睡' })
    toggleHabitLog(source, habit.id, '2026-11-05')
    toggleHabitLog(source, habit.id, '2026-11-05')

    const snapshot = buildSnapshot(source)
    expect(snapshot.habitLogs).toHaveLength(1)
    expect(snapshot.habitLogs?.[0].deletedAt).toBeTruthy()

    applySnapshot(target, snapshot)
    expect(listHabits(target)[0].logs).toHaveLength(0)
    const row = target
      .prepare('SELECT deleted_at FROM habit_logs WHERE habit_id = ?')
      .get(habit.id) as { deleted_at: string | null }
    expect(row.deleted_at).toBeTruthy()
  })

  it('取消习惯提醒以 tombstone 同步，目标端不再返回提醒', () => {
    const habit = createHabit(source, { name: '冥想' })
    setHabitReminder(source, habit.id, '09:00')
    setHabitReminder(source, habit.id, null)

    const snapshot = buildSnapshot(source)
    expect(snapshot.habitReminders).toHaveLength(1)
    expect(snapshot.habitReminders?.[0].deletedAt).toBeTruthy()

    applySnapshot(target, snapshot)
    expect(getHabitReminder(target, habit.id)).toBeNull()
  })
})
