import type { DatabaseSync } from 'node:sqlite'
import type { StatsOverview } from '@shared/types'
import { addDaysToKey, todayKey } from '@shared/dates'

function startOfLocalDayIso(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

export function getStatsOverview(db: DatabaseSync): StatsOverview {
  const today = todayKey()
  const days = Array.from({ length: 7 }, (_, index) => addDaysToKey(today, index - 6))
  const startKey = days[0]
  const startIso = startOfLocalDayIso(startKey)
  const monthStartIso = startOfLocalDayIso(addDaysToKey(today, -29))

  const count = (sql: string, ...params: Array<string | number>): number => {
    const row = db.prepare(sql).get(...params) as unknown as { c: number }
    return Number(row.c)
  }

  const tasksCompleted7d = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'completed' AND deleted_at IS NULL AND parent_id IS NULL
       AND completed_at >= ?`,
    startIso
  )
  const tasksCompleted30d = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'completed' AND deleted_at IS NULL AND parent_id IS NULL
       AND completed_at >= ?`,
    monthStartIso
  )
  const tasksCreated7d = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE deleted_at IS NULL AND parent_id IS NULL AND created_at >= ?`,
    startIso
  )
  const overdue = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'open' AND deleted_at IS NULL AND parent_id IS NULL
       AND due_date IS NOT NULL AND due_date < ?`,
    today
  )

  const completedRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', completed_at, 'localtime') AS day, COUNT(*) AS c
       FROM tasks
       WHERE status = 'completed' AND deleted_at IS NULL AND parent_id IS NULL
         AND completed_at >= ?
       GROUP BY day`
    )
    .all(startIso) as unknown as Array<{ day: string; c: number }>
  const completedMap = new Map(completedRows.map((row) => [String(row.day), Number(row.c)]))
  const completedByDay = days.map((date) => ({
    date,
    count: completedMap.get(date) ?? 0
  }))

  const priorityRows = db
    .prepare(
      `SELECT priority, COUNT(*) AS c FROM tasks
       WHERE status = 'open' AND deleted_at IS NULL AND parent_id IS NULL
       GROUP BY priority`
    )
    .all() as unknown as Array<{ priority: number; c: number }>
  const priorityMap = new Map(priorityRows.map((row) => [Number(row.priority), Number(row.c)]))
  const byPriority = [0, 1, 2, 3].map((priority) => ({
    priority,
    count: priorityMap.get(priority) ?? 0
  }))

  const listRows = db
    .prepare(
      `SELECT l.id AS list_id, l.name, l.color, COUNT(t.id) AS c
       FROM lists l
       LEFT JOIN tasks t
         ON t.list_id = l.id AND t.status = 'open'
        AND t.deleted_at IS NULL AND t.parent_id IS NULL
       WHERE l.deleted_at IS NULL
       GROUP BY l.id
       ORDER BY c DESC, l.sort_order ASC`
    )
    .all() as unknown as Array<{ list_id: string; name: string; color: string; c: number }>
  const byList = listRows.map((row) => ({
    listId: String(row.list_id),
    name: String(row.name),
    color: String(row.color),
    count: Number(row.c)
  }))

  const focusRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', started_at, 'localtime') AS day,
              SUM(duration_minutes) AS minutes,
              COUNT(*) AS c
       FROM pomodoro_sessions
       WHERE mode = 'focus' AND completed = 1 AND started_at >= ?
       GROUP BY day`
    )
    .all(startIso) as unknown as Array<{ day: string; minutes: number; c: number }>
  const focusMap = new Map(
    focusRows.map((row) => [String(row.day), { minutes: Number(row.minutes), count: Number(row.c) }])
  )
  const focusByDay = days.map((date) => ({
    date,
    minutes: focusMap.get(date)?.minutes ?? 0
  }))
  const focusMinutes7d = focusByDay.reduce((sum, item) => sum + item.minutes, 0)
  const focusSessions7d = count(
    `SELECT COUNT(*) AS c FROM pomodoro_sessions
     WHERE mode = 'focus' AND completed = 1 AND started_at >= ?`,
    startIso
  )

  const habitRows = db
    .prepare(
      `SELECT l.log_date AS day, COUNT(*) AS c
       FROM habit_logs l
       JOIN habits h ON h.id = l.habit_id
       WHERE l.log_date >= ? AND h.deleted_at IS NULL AND h.archived = 0
       GROUP BY day`
    )
    .all(startKey) as unknown as Array<{ day: string; c: number }>
  const habitMap = new Map(habitRows.map((row) => [String(row.day), Number(row.c)]))
  const habitByDay = days.map((date) => ({ date, count: habitMap.get(date) ?? 0 }))
  const habitCheckins7d = habitByDay.reduce((sum, item) => sum + item.count, 0)

  const topRows = db
    .prepare(
      `SELECT h.id, h.name, h.color, COUNT(l.id) AS c
       FROM habits h
       LEFT JOIN habit_logs l ON l.habit_id = h.id AND l.log_date >= ?
       WHERE h.deleted_at IS NULL AND h.archived = 0
       GROUP BY h.id
       ORDER BY c DESC, h.sort_order ASC
       LIMIT 5`
    )
    .all(startKey) as unknown as Array<{ id: string; name: string; color: string; c: number }>
  const topHabits = topRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    count: Number(row.c)
  }))

  return {
    tasksCompleted7d,
    tasksCompleted30d,
    tasksCreated7d,
    overdue,
    completedByDay,
    byPriority,
    byList,
    focusMinutes7d,
    focusSessions7d,
    focusByDay,
    habitCheckins7d,
    habitByDay,
    topHabits
  }
}
