import type { DatabaseSync } from 'node:sqlite'
import type { PomodoroInput, PomodoroMode, PomodoroSession } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface SessionRow {
  id: string
  task_id: string | null
  mode: string
  duration_minutes: number
  started_at: string
  ended_at: string
  completed: number
  created_at: string
  device_id: string
}

function toSession(row: SessionRow): PomodoroSession {
  return {
    id: String(row.id),
    taskId: row.task_id == null ? null : String(row.task_id),
    mode: String(row.mode) as PomodoroMode,
    durationMinutes: Number(row.duration_minutes),
    startedAt: String(row.started_at),
    endedAt: String(row.ended_at),
    completed: Number(row.completed) === 1,
    createdAt: String(row.created_at)
  }
}

export function createPomodoroSession(
  db: DatabaseSync,
  input: PomodoroInput
): PomodoroSession {
  const mode: PomodoroMode = input.mode === 'break' ? 'break' : 'focus'
  const duration = Math.round(input.durationMinutes)
  if (!Number.isFinite(duration) || duration <= 0 || duration > 240) {
    throw new Error('专注时长无效')
  }
  const started = new Date(input.startedAt)
  const ended = new Date(input.endedAt)
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) {
    throw new Error('专注时间无效')
  }

  const id = uuidv7()
  const now = nowIso()
  db.prepare(
    `INSERT INTO pomodoro_sessions(id, task_id, mode, duration_minutes, started_at, ended_at, completed, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.taskId ?? null,
    mode,
    duration,
    started.toISOString(),
    ended.toISOString(),
    input.completed === false ? 0 : 1,
    now,
    getDeviceId(db)
  )

  const row = db
    .prepare('SELECT * FROM pomodoro_sessions WHERE id = ?')
    .get(id) as unknown as SessionRow
  const session = toSession(row)
  logChange(db, 'pomodoro', id, 'create', session)
  return session
}

export function listPomodoroSessions(
  db: DatabaseSync,
  fromIso: string,
  toIso: string
): PomodoroSession[] {
  const rows = db
    .prepare(
      `SELECT * FROM pomodoro_sessions
       WHERE started_at >= ? AND started_at <= ?
       ORDER BY started_at DESC`
    )
    .all(fromIso, toIso) as unknown as SessionRow[]
  return rows.map(toSession)
}
