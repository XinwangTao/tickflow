import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: typeof import('../mobile/src/db').db
let buildBackupJson: typeof import('../mobile/src/backup').buildBackupJson
let importBackupJson: typeof import('../mobile/src/backup').importBackupJson
let ensureSeed: typeof import('../mobile/src/db').ensureSeed
let createTask: typeof import('../mobile/src/db').createTask
let createHabit: typeof import('../mobile/src/db').createHabit
let addPomodoroSession: typeof import('../mobile/src/db').addPomodoroSession
let saveSettings: typeof import('../mobile/src/db').saveSettings

beforeAll(async () => {
  // @ts-expect-error fake-indexeddb 的 exports 未暴露 auto 的声明文件
  await import('fake-indexeddb/auto')
  const dbModule = await import('../mobile/src/db')
  const backupModule = await import('../mobile/src/backup')
  db = dbModule.db
  ensureSeed = dbModule.ensureSeed
  createTask = dbModule.createTask
  createHabit = dbModule.createHabit
  addPomodoroSession = dbModule.addPomodoroSession
  saveSettings = dbModule.saveSettings
  buildBackupJson = backupModule.buildBackupJson
  importBackupJson = backupModule.importBackupJson
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeed()
})

describe('mobile backup', () => {
  it('导出不含凭据，清库后可完整导入', async () => {
    const habit = await createHabit('备份习惯', '#30a46c')
    const task = await createTask({
      title: '备份任务',
      notes: '备注',
      tagNames: ['工作']
    })
    const session = await addPomodoroSession({
      durationMinutes: 25,
      startedAt: '2026-11-06T01:00:00.000Z',
      endedAt: '2026-11-06T01:25:00.000Z',
      completed: true
    })
    await saveSettings({ r2SecretAccessKey: 'should-not-export', theme: 'light' })

    const json = await buildBackupJson()
    const payload = JSON.parse(json) as {
      settings: Array<{ key: string }>
      tasks: Array<{ id: string }>
    }
    expect(payload.tasks.some((item) => item.id === task.id)).toBe(true)
    expect(payload.settings.some((item) => item.key === 'r2SecretAccessKey')).toBe(false)

    await db.delete()
    await db.open()
    await ensureSeed()

    const counts = await importBackupJson(json)
    expect(counts.tasks).toBe(1)
    expect(counts.habits).toBe(1)
    expect(counts.sessions).toBe(1)

    expect((await db.tasks.get(task.id))?.title).toBe('备份任务')
    expect((await db.habits.get(habit.id))?.name).toBe('备份习惯')
    expect((await db.pomodoroSessions.get(session.id))?.durationMinutes).toBe(25)
  })

  it('重复导入按 ID 跳过', async () => {
    await createTask({ title: '幂等任务' })
    const json = await buildBackupJson()
    const first = await importBackupJson(json)
    const second = await importBackupJson(json)
    expect(first.tasks).toBe(0)
    expect(second.tasks).toBe(0)
    expect(await db.tasks.count()).toBe(1)
  })

  it('拒绝非刻度清单备份', async () => {
    await expect(importBackupJson('{"hello":1}')).rejects.toThrow('不是刻度清单')
  })
})
