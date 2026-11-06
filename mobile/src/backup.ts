import type { Habit, HabitLog, PomodoroSession, TodoList } from '@shared/types'
import type { SyncTask } from '@shared/sync'
import { INBOX_ID } from '@shared/types'
import { db, nowIso } from './db'

const SECRET_SETTING_KEYS = new Set([
  'r2AccessKeyId',
  'r2SecretAccessKey',
  'r2LastSync',
  'deviceId'
])

export interface BackupCounts {
  lists: number
  tasks: number
  habits: number
  logs: number
  sessions: number
}

export async function buildBackupJson(): Promise<string> {
  const [lists, tasks, habits, habitLogs, pomodoroSessions, settings] = await Promise.all([
    db.lists.toArray(),
    db.tasks.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
    db.pomodoroSessions.toArray(),
    db.settings.toArray()
  ])
  return JSON.stringify(
    {
      app: 'tickflow-mobile',
      version: 1,
      exportedAt: nowIso(),
      lists,
      tasks,
      habits,
      habit_logs: habitLogs,
      pomodoro_sessions: pomodoroSessions,
      settings: settings.filter((row) => !SECRET_SETTING_KEYS.has(row.key))
    },
    null,
    2
  )
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export async function importBackupJson(text: string): Promise<BackupCounts> {
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('JSON 解析失败')
  }
  if (payload.app !== 'tickflow-mobile' && !Array.isArray(payload.tasks)) {
    throw new Error('不是刻度清单 Android 备份文件')
  }

  const lists = arrayOf<TodoList>(payload.lists)
  const tasks = arrayOf<SyncTask>(payload.tasks)
  const habits = arrayOf<Habit>(payload.habits)
  const logs = arrayOf<HabitLog>(payload.habit_logs)
  const sessions = arrayOf<PomodoroSession>(payload.pomodoro_sessions)

  const counts: BackupCounts = { lists: 0, tasks: 0, habits: 0, logs: 0, sessions: 0 }

  await db.transaction(
    'rw',
    [db.lists, db.tasks, db.habits, db.habitLogs, db.pomodoroSessions],
    async () => {
      const listIds = new Set((await db.lists.toArray()).map((row) => row.id))
      for (const list of lists) {
        if (!list.id || listIds.has(list.id)) continue
        await db.lists.put(list)
        listIds.add(list.id)
        counts.lists += 1
      }
      const taskIds = new Set((await db.tasks.toArray()).map((row) => row.id))
      for (const task of tasks) {
        if (!task.id || taskIds.has(task.id)) continue
        await db.tasks.put({
          ...task,
          listId: listIds.has(task.listId) ? task.listId : INBOX_ID
        })
        taskIds.add(task.id)
        counts.tasks += 1
      }
      const habitIds = new Set((await db.habits.toArray()).map((row) => row.id))
      for (const habit of habits) {
        if (!habit.id || habitIds.has(habit.id)) continue
        await db.habits.put(habit)
        habitIds.add(habit.id)
        counts.habits += 1
      }
      const logIds = new Set((await db.habitLogs.toArray()).map((row) => row.id))
      for (const log of logs) {
        if (!log.id || logIds.has(log.id) || !habitIds.has(log.habitId)) continue
        await db.habitLogs.put(log)
        logIds.add(log.id)
        counts.logs += 1
      }
      const sessionIds = new Set(
        (await db.pomodoroSessions.toArray()).map((row) => row.id)
      )
      for (const session of sessions) {
        if (!session.id || sessionIds.has(session.id)) continue
        await db.pomodoroSessions.put(session)
        sessionIds.add(session.id)
        counts.sessions += 1
      }
    }
  )

  return counts
}
