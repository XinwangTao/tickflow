import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: typeof import('../mobile/src/db').db
let ensureSeed: typeof import('../mobile/src/db').ensureSeed
let createHabit: typeof import('../mobile/src/db').createHabit
let toggleHabitToday: typeof import('../mobile/src/db').toggleHabitToday
let listHabits: typeof import('../mobile/src/db').listHabits
let addPomodoroSession: typeof import('../mobile/src/db').addPomodoroSession
let buildSnapshot: typeof import('../mobile/src/db').buildSnapshot
let applySnapshot: typeof import('../mobile/src/db').applySnapshot

beforeAll(async () => {
  // @ts-expect-error fake-indexeddb 的 exports 未暴露 auto 的声明文件
  await import('fake-indexeddb/auto')
  const dbModule = await import('../mobile/src/db')
  db = dbModule.db
  ensureSeed = dbModule.ensureSeed
  createHabit = dbModule.createHabit
  toggleHabitToday = dbModule.toggleHabitToday
  listHabits = dbModule.listHabits
  addPomodoroSession = dbModule.addPomodoroSession
  buildSnapshot = dbModule.buildSnapshot
  applySnapshot = dbModule.applySnapshot
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeed()
})

describe('mobile sync scope', () => {
  it('快照包含习惯、打卡与番茄记录，并可应用到空库', async () => {
    const habit = await createHabit('喝水')
    await toggleHabitToday(habit.id)
    const session = await addPomodoroSession({
      durationMinutes: 25,
      startedAt: '2026-11-05T08:00:00.000Z',
      endedAt: '2026-11-05T08:25:00.000Z',
      completed: true
    })

    const snapshot = await buildSnapshot()
    expect(snapshot.habits).toHaveLength(1)
    expect(snapshot.habitLogs).toHaveLength(1)
    expect(snapshot.pomodoroSessions).toHaveLength(1)

    await db.delete()
    await db.open()
    await applySnapshot(snapshot)

    const habits = await listHabits()
    expect(habits).toHaveLength(1)
    expect(habits[0].checkedToday).toBe(true)
    expect(await db.pomodoroSessions.get(session.id)).toBeTruthy()
  })

  it('取消打卡写 tombstone，同步后不展示但记录仍在', async () => {
    const habit = await createHabit('早睡')
    await toggleHabitToday(habit.id)
    await toggleHabitToday(habit.id)

    const snapshot = await buildSnapshot()
    expect(snapshot.habitLogs).toHaveLength(1)
    expect(snapshot.habitLogs?.[0].deletedAt).toBeTruthy()

    await db.delete()
    await db.open()
    await applySnapshot(snapshot)

    expect((await listHabits())[0].checkedToday).toBe(false)
    const rows = await db.habitLogs.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].deletedAt).toBeTruthy()
  })
})
