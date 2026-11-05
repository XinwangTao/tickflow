import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateHabitInput,
  Habit,
  HabitFrequency,
  HabitLog,
  HabitWithStats,
  UpdateHabitInput
} from '@shared/types'
import { addDaysToKey, startOfWeekKey, todayKey } from '@shared/dates'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface HabitRow {
  id: string
  name: string
  icon: string | null
  color: string
  frequency: string
  target_per_week: number
  archived: number
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

interface LogRow {
  id: string
  habit_id: string
  log_date: string
  value: number
  note: string
  created_at: string
  updated_at: string
  device_id: string
}

function toHabit(row: HabitRow): Habit {
  return {
    id: String(row.id),
    name: String(row.name),
    icon: row.icon == null ? null : String(row.icon),
    color: String(row.color),
    frequency: String(row.frequency) as HabitFrequency,
    targetPerWeek: Number(row.target_per_week),
    archived: Number(row.archived) === 1,
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at)
  }
}

function toLog(row: LogRow): HabitLog {
  return {
    id: String(row.id),
    habitId: String(row.habit_id),
    logDate: String(row.log_date),
    value: Number(row.value),
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function computeStreaks(dates: string[], today: string): {
  currentStreak: number
  longestStreak: number
} {
  const set = new Set(dates)
  let current = 0
  let cursor = set.has(today) ? today : addDaysToKey(today, -1)
  while (set.has(cursor)) {
    current += 1
    cursor = addDaysToKey(cursor, -1)
  }

  const sorted = [...set].sort()
  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const date of sorted) {
    if (previous && addDaysToKey(previous, 1) === date) run += 1
    else run = 1
    longest = Math.max(longest, run)
    previous = date
  }

  return { currentStreak: current, longestStreak: Math.max(longest, current) }
}

export function listHabits(db: DatabaseSync): HabitWithStats[] {
  const today = todayKey()
  const cutoff = addDaysToKey(today, -365)
  const weekStart = startOfWeekKey(today, 1)

  const habitRows = db
    .prepare(
      `SELECT * FROM habits
       WHERE deleted_at IS NULL AND archived = 0
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as unknown as HabitRow[]

  const logRows = db
    .prepare(
      `SELECT * FROM habit_logs WHERE log_date >= ? ORDER BY log_date ASC`
    )
    .all(cutoff) as unknown as LogRow[]

  const byHabit = new Map<string, HabitLog[]>()
  for (const row of logRows) {
    const log = toLog(row)
    const bucket = byHabit.get(log.habitId) ?? []
    bucket.push(log)
    byHabit.set(log.habitId, bucket)
  }

  return habitRows.map((row) => {
    const habit = toHabit(row)
    const logs = byHabit.get(habit.id) ?? []
    const dates = logs.map((log) => log.logDate)
    const streaks = computeStreaks(dates, today)
    return {
      ...habit,
      logs,
      ...streaks,
      weekCount: dates.filter((date) => date >= weekStart && date <= today).length
    }
  })
}

export function createHabit(db: DatabaseSync, input: CreateHabitInput): Habit {
  const name = input.name.trim()
  if (!name) throw new Error('习惯名称不能为空')

  const id = uuidv7()
  const now = nowIso()
  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM habits')
    .get() as unknown as { m: number }
  const frequency: HabitFrequency = input.frequency === 'weekly' ? 'weekly' : 'daily'
  const target = Math.min(7, Math.max(1, Math.round(input.targetPerWeek ?? 7)))

  db.prepare(
    `INSERT INTO habits(id, name, icon, color, frequency, target_per_week, archived, sort_order, created_at, updated_at, deleted_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    input.icon ?? null,
    input.color?.trim() || '#30a46c',
    frequency,
    target,
    0,
    Number(maxRow.m) + 1,
    now,
    now,
    null,
    getDeviceId(db)
  )

  const created = db
    .prepare('SELECT * FROM habits WHERE id = ?')
    .get(id) as unknown as HabitRow
  const habit = toHabit(created)
  logChange(db, 'habit', id, 'create', habit)
  return habit
}

export function updateHabit(db: DatabaseSync, id: string, patch: UpdateHabitInput): Habit {
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL').get(id) as
    | HabitRow
    | undefined
  if (!row) throw new Error('习惯不存在')

  const existing = toHabit(row)
  const name = patch.name !== undefined ? patch.name.trim() : existing.name
  if (!name) throw new Error('习惯名称不能为空')
  const icon = patch.icon !== undefined ? patch.icon : existing.icon
  const color = patch.color !== undefined ? patch.color : existing.color
  const frequency =
    patch.frequency !== undefined
      ? patch.frequency === 'weekly'
        ? 'weekly'
        : 'daily'
      : existing.frequency
  const target = Math.min(
    7,
    Math.max(1, Math.round(patch.targetPerWeek ?? existing.targetPerWeek))
  )
  const archived = patch.archived !== undefined ? patch.archived : existing.archived

  db.prepare(
    `UPDATE habits SET name = ?, icon = ?, color = ?, frequency = ?, target_per_week = ?, archived = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, icon, color, frequency, target, archived ? 1 : 0, nowIso(), id)

  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as unknown as HabitRow
  const habit = toHabit(updated)
  logChange(db, 'habit', id, 'update', habit)
  return habit
}

export function deleteHabit(db: DatabaseSync, id: string): void {
  const row = db.prepare('SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL').get(id) as
    | HabitRow
    | undefined
  if (!row) return
  const now = nowIso()
  db.prepare('UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  logChange(db, 'habit', id, 'delete', { id })
}

export function toggleHabitLog(db: DatabaseSync, habitId: string, logDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) throw new Error('日期格式无效')
  const habit = db
    .prepare('SELECT id FROM habits WHERE id = ? AND deleted_at IS NULL')
    .get(habitId) as { id: string } | undefined
  if (!habit) throw new Error('习惯不存在')

  const existing = db
    .prepare('SELECT id FROM habit_logs WHERE habit_id = ? AND log_date = ?')
    .get(habitId, logDate) as { id: string } | undefined
  const now = nowIso()

  if (existing) {
    db.prepare('DELETE FROM habit_logs WHERE id = ?').run(existing.id)
    logChange(db, 'habit_log', String(existing.id), 'delete', { id: existing.id })
    return
  }

  const id = uuidv7()
  db.prepare(
    `INSERT INTO habit_logs(id, habit_id, log_date, value, note, created_at, updated_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, habitId, logDate, 1, '', now, now, getDeviceId(db))
  logChange(db, 'habit_log', id, 'create', { id, habitId, logDate })
}
