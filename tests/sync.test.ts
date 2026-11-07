import { describe, expect, it } from 'vitest'
import { R2Client, mergeSnapshots } from '../src/shared/sync'
import type { SyncSnapshot, SyncTask } from '../src/shared/sync'
import type { Habit, HabitLog, HabitReminder, PomodoroSession, TodoList } from '../src/shared/types'

const list: TodoList = {
  id: 'list-1',
  name: '清单',
  color: '#f5c542',
  emoji: null,
  sortOrder: 0,
  isInbox: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null
}

function task(overrides: Partial<SyncTask>): SyncTask {
  return {
    id: 'task-1',
    listId: 'list-1',
    parentId: null,
    title: '任务',
    notes: '',
    status: 'open',
    priority: 0,
    dueDate: null,
    dueTime: null,
    allDay: true,
    startDate: null,
    recurrence: null,
    pinned: false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    deletedAt: null,
    tagNames: [],
    ...overrides
  }
}

function snapshot(deviceId: string, tasks: SyncTask[]): SyncSnapshot {
  return {
    version: 1,
    deviceId,
    updatedAt: '2026-11-05T10:00:00.000Z',
    lists: [list],
    tasks
  }
}

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: '喝水',
    icon: null,
    color: '#30a46c',
    frequency: 'daily',
    targetPerWeek: 7,
    archived: false,
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    deletedAt: null,
    ...overrides
  }
}

function habitLog(overrides: Partial<HabitLog> = {}): HabitLog {
  return {
    id: 'log-1',
    habitId: 'habit-1',
    logDate: '2026-11-05',
    value: 1,
    note: '',
    createdAt: '2026-11-05T08:00:00.000Z',
    updatedAt: '2026-11-05T08:00:00.000Z',
    deletedAt: null,
    ...overrides
  }
}

function habitReminder(overrides: Partial<HabitReminder> = {}): HabitReminder {
  return {
    id: 'reminder-1',
    habitId: 'habit-1',
    triggerAt: '2026-11-06T09:00:00.000Z',
    enabled: true,
    sentAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    deletedAt: null,
    ...overrides
  }
}

function pomodoro(overrides: Partial<PomodoroSession> = {}): PomodoroSession {
  return {
    id: 'session-1',
    taskId: null,
    mode: 'focus',
    durationMinutes: 25,
    startedAt: '2026-11-05T08:00:00.000Z',
    endedAt: '2026-11-05T08:25:00.000Z',
    completed: true,
    createdAt: '2026-11-05T08:00:00.000Z',
    ...overrides
  }
}

describe('sync merge', () => {
  it('按 updated_at 做 last-write-wins', () => {
    const local = snapshot('pc', [task({ title: '本地较新' })])
    const remote = snapshot('phone', [
      task({ title: '远端较旧', updatedAt: '2026-11-05T09:00:00.000Z' })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks[0].title).toBe('本地较新')
    expect(merged.deviceId).toBe('pc')
  })

  it('远端更新的任务覆盖本地', () => {
    const local = snapshot('pc', [task({ title: '旧标题' })])
    const remote = snapshot('phone', [
      task({ title: '新标题', updatedAt: '2026-11-05T11:00:00.000Z' })
    ])
    expect(mergeSnapshots(local, [remote]).tasks[0].title).toBe('新标题')
  })

  it('删除 tombstone 参与比较', () => {
    const local = snapshot('pc', [task({ title: '任务' })])
    const remote = snapshot('phone', [
      task({
        title: '任务',
        deletedAt: '2026-11-05T12:00:00.000Z',
        updatedAt: '2026-11-05T12:00:00.000Z'
      })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks[0].deletedAt).toBe('2026-11-05T12:00:00.000Z')
  })

  it('远端新增任务会合并进来', () => {
    const local = snapshot('pc', [])
    const remote = snapshot('phone', [
      task({ id: 'task-2', title: '手机任务', updatedAt: '2026-11-05T11:00:00.000Z' })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks.map((item) => item.id)).toContain('task-2')
  })

  it('习惯按 id 做 LWW，删除 tombstone 参与比较', () => {
    const local = snapshot('pc', [])
    local.habits = [habit()]
    const remote = snapshot('phone', [])
    remote.habits = [
      habit({
        name: '喝水（已删）',
        deletedAt: '2026-11-05T12:00:00.000Z',
        updatedAt: '2026-11-05T12:00:00.000Z'
      })
    ]
    const merged = mergeSnapshots(local, [remote])
    expect(merged.habits).toHaveLength(1)
    expect(merged.habits?.[0].name).toBe('喝水（已删）')
    expect(merged.habits?.[0].deletedAt).toBe('2026-11-05T12:00:00.000Z')
  })

  it('打卡按习惯 + 日期去重，较新的取消打卡覆盖旧记录', () => {
    const local = snapshot('pc', [])
    local.habitLogs = [habitLog({ id: 'log-local' })]
    const remote = snapshot('phone', [])
    remote.habitLogs = [
      habitLog({
        id: 'log-remote',
        updatedAt: '2026-11-05T09:00:00.000Z',
        deletedAt: '2026-11-05T09:00:00.000Z'
      })
    ]
    const merged = mergeSnapshots(local, [remote])
    expect(merged.habitLogs).toHaveLength(1)
    expect(merged.habitLogs?.[0].id).toBe('log-remote')
    expect(merged.habitLogs?.[0].deletedAt).toBe('2026-11-05T09:00:00.000Z')
  })

  it('番茄记录按 id 并集且不重复', () => {
    const local = snapshot('pc', [])
    local.pomodoroSessions = [pomodoro()]
    const remote = snapshot('phone', [])
    remote.pomodoroSessions = [
      pomodoro(),
      pomodoro({ id: 'session-2', startedAt: '2026-11-05T10:00:00.000Z' })
    ]
    const merged = mergeSnapshots(local, [remote])
    expect(merged.pomodoroSessions?.map((item) => item.id).sort()).toEqual([
      'session-1',
      'session-2'
    ])
  })

  it('习惯提醒按 habitId 取新，取消提醒的 tombstone 生效', () => {
    const local = snapshot('pc', [])
    local.habitReminders = [habitReminder()]
    const remote = snapshot('phone', [])
    remote.habitReminders = [
      habitReminder({
        id: 'reminder-2',
        triggerAt: '2026-11-06T10:00:00.000Z',
        deletedAt: '2026-11-05T11:00:00.000Z',
        updatedAt: '2026-11-05T11:00:00.000Z'
      })
    ]
    const merged = mergeSnapshots(local, [remote])
    expect(merged.habitReminders).toHaveLength(1)
    expect(merged.habitReminders?.[0].id).toBe('reminder-2')
    expect(merged.habitReminders?.[0].deletedAt).toBe('2026-11-05T11:00:00.000Z')
  })

  it('旧快照缺少扩展数组时按空处理', () => {
    const local = snapshot('pc', [])
    const remote = snapshot('phone', [])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.habits).toEqual([])
    expect(merged.habitLogs).toEqual([])
    expect(merged.pomodoroSessions).toEqual([])
    expect(merged.habitReminders).toEqual([])
  })
})

describe('R2 client', () => {
  it('配置不完整时抛出明确错误', () => {
    expect(
      () =>
        new R2Client({
          endpoint: '',
          bucket: '',
          accessKeyId: '',
          secretAccessKey: ''
        })
    ).toThrow('R2 配置不完整')
  })

  it('生成快照 key', () => {
    const client = new R2Client({
      endpoint: 'https://example.r2.cloudflarestorage.com/',
      bucket: 'tickflow',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      prefix: 'tickflow/snapshots'
    })
    expect(client.keyFor('device-1')).toBe('tickflow/snapshots/device-1.json')
  })
})
