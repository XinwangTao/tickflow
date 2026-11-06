import type { DatabaseSync } from 'node:sqlite'
import type { HabitReminder, HabitReminderWithHabit } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

interface HabitReminderRow {
  id: string
  habit_id: string
  trigger_at: string
  enabled: number
  sent_at: string | null
  created_at: string
  updated_at: string
  device_id: string
}

function toReminder(row: HabitReminderRow): HabitReminder {
  return {
    id: String(row.id),
    habitId: String(row.habit_id),
    triggerAt: String(row.trigger_at),
    enabled: Number(row.enabled) === 1,
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export function nextDailyTrigger(time: string, from: Date = new Date()): string {
  const match = TIME_PATTERN.exec(time)
  if (!match) throw new Error('提醒时间格式应为 HH:MM')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const next = new Date(from)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

export function localTimeOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function getHabitReminder(
  db: DatabaseSync,
  habitId: string
): HabitReminder | null {
  const row = db
    .prepare('SELECT * FROM habit_reminders WHERE habit_id = ?')
    .get(habitId) as unknown as HabitReminderRow | undefined
  return row ? toReminder(row) : null
}

export function setHabitReminder(
  db: DatabaseSync,
  habitId: string,
  time: string | null
): HabitReminder | null {
  const habit = db
    .prepare('SELECT id FROM habits WHERE id = ? AND deleted_at IS NULL')
    .get(habitId) as { id: string } | undefined
  if (!habit) throw new Error('习惯不存在')

  const existing = getHabitReminder(db, habitId)
  if (time == null || time.trim() === '') {
    if (existing) {
      db.prepare('DELETE FROM habit_reminders WHERE habit_id = ?').run(habitId)
      logChange(db, 'habit_reminder', existing.id, 'delete', { id: existing.id, habitId })
    }
    return null
  }

  const triggerAt = nextDailyTrigger(time.trim())
  const now = nowIso()

  if (existing) {
    db.prepare(
      'UPDATE habit_reminders SET trigger_at = ?, enabled = 1, updated_at = ? WHERE id = ?'
    ).run(triggerAt, now, existing.id)
    logChange(db, 'habit_reminder', existing.id, 'update', {
      id: existing.id,
      habitId,
      triggerAt
    })
    return { ...existing, triggerAt, enabled: true, updatedAt: now }
  }

  const id = uuidv7()
  db.prepare(
    `INSERT INTO habit_reminders(id, habit_id, trigger_at, enabled, sent_at, created_at, updated_at, device_id)
     VALUES(?, ?, ?, 1, NULL, ?, ?, ?)`
  ).run(id, habitId, triggerAt, now, now, getDeviceId(db))

  const created: HabitReminder = {
    id,
    habitId,
    triggerAt,
    enabled: true,
    sentAt: null,
    createdAt: now,
    updatedAt: now
  }
  logChange(db, 'habit_reminder', id, 'create', created)
  return created
}

export function listDueHabitReminders(
  db: DatabaseSync,
  now: string = nowIso()
): HabitReminderWithHabit[] {
  const rows = db
    .prepare(
      `SELECT r.*, h.name AS habit_name, h.color AS habit_color
       FROM habit_reminders r
       JOIN habits h ON h.id = r.habit_id
       WHERE r.enabled = 1
         AND r.trigger_at <= ?
         AND h.deleted_at IS NULL
         AND h.archived = 0
       ORDER BY r.trigger_at ASC`
    )
    .all(now) as unknown as Array<
    HabitReminderRow & { habit_name: string; habit_color: string }
  >

  return rows.map((row) => ({
    ...toReminder(row),
    habitName: String(row.habit_name),
    habitColor: String(row.habit_color)
  }))
}

export function advanceHabitReminder(
  db: DatabaseSync,
  id: string,
  sentAt: string,
  triggerAt: string
): void {
  db.prepare(
    'UPDATE habit_reminders SET trigger_at = ?, sent_at = ?, updated_at = ? WHERE id = ?'
  ).run(triggerAt, sentAt, sentAt, id)
  logChange(db, 'habit_reminder', id, 'update', { id, triggerAt, sentAt })
}

export function listHabitReminderCenter(
  db: DatabaseSync,
  now: string = nowIso()
): { habitUpcoming: HabitReminderWithHabit[]; habitRecent: HabitReminderWithHabit[] } {
  const upcomingRows = db
    .prepare(
      `SELECT r.*, h.name AS habit_name, h.color AS habit_color
       FROM habit_reminders r
       JOIN habits h ON h.id = r.habit_id
       WHERE r.enabled = 1
         AND r.trigger_at > ?
         AND h.deleted_at IS NULL
         AND h.archived = 0
       ORDER BY r.trigger_at ASC
       LIMIT 50`
    )
    .all(now) as unknown as Array<
    HabitReminderRow & { habit_name: string; habit_color: string }
  >

  const cutoff = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString()
  const recentRows = db
    .prepare(
      `SELECT r.*, h.name AS habit_name, h.color AS habit_color
       FROM habit_reminders r
       JOIN habits h ON h.id = r.habit_id
       WHERE r.sent_at IS NOT NULL
         AND r.sent_at >= ?
         AND h.deleted_at IS NULL
       ORDER BY r.sent_at DESC
       LIMIT 50`
    )
    .all(cutoff) as unknown as Array<
    HabitReminderRow & { habit_name: string; habit_color: string }
  >

  const toItem = (
    row: HabitReminderRow & { habit_name: string; habit_color: string }
  ): HabitReminderWithHabit => ({
    ...toReminder(row),
    habitName: String(row.habit_name),
    habitColor: String(row.habit_color)
  })

  return {
    habitUpcoming: upcomingRows.map(toItem),
    habitRecent: recentRows.map(toItem)
  }
}

export function deleteHabitRemindersForHabit(db: DatabaseSync, habitId: string): void {
  const rows = db
    .prepare('SELECT id FROM habit_reminders WHERE habit_id = ?')
    .all(habitId) as Array<{ id: string }>
  if (rows.length === 0) return
  db.prepare('DELETE FROM habit_reminders WHERE habit_id = ?').run(habitId)
  for (const row of rows) {
    logChange(db, 'habit_reminder', String(row.id), 'delete', {
      id: String(row.id),
      habitId
    })
  }
}
