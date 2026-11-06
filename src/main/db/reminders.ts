import type { DatabaseSync } from 'node:sqlite'
import type { Reminder, ReminderCenterData, ReminderWithTask } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { listHabitReminderCenter } from './habit-reminders'
import { getDeviceId, nowIso } from './util'

interface ReminderRow {
  id: string
  task_id: string
  trigger_at: string
  sent_at: string | null
  created_at: string
  device_id: string
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    triggerAt: String(row.trigger_at),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    createdAt: String(row.created_at)
  }
}

export function listReminders(db: DatabaseSync, taskId: string): Reminder[] {
  const rows = db
    .prepare('SELECT * FROM reminders WHERE task_id = ? ORDER BY trigger_at ASC')
    .all(taskId) as unknown as ReminderRow[]
  return rows.map(toReminder)
}

export function createReminder(
  db: DatabaseSync,
  taskId: string,
  triggerAt: string
): Reminder {
  const trigger = new Date(triggerAt)
  if (Number.isNaN(trigger.getTime())) throw new Error('提醒时间无效')

  const id = uuidv7()
  const now = nowIso()
  const normalized = trigger.toISOString()

  db.prepare(
    `INSERT INTO reminders(id, task_id, trigger_at, sent_at, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`
  ).run(id, taskId, normalized, null, now, getDeviceId(db))

  const reminder: Reminder = {
    id,
    taskId,
    triggerAt: normalized,
    sentAt: null,
    createdAt: now
  }
  logChange(db, 'reminder', id, 'create', reminder)
  return reminder
}

export function deleteReminder(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id)
  logChange(db, 'reminder', id, 'delete', { id })
}

export function listDueReminders(db: DatabaseSync, now: string = nowIso()): ReminderWithTask[] {
  const rows = db
    .prepare(
      `SELECT r.*, t.title AS task_title
       FROM reminders r
       JOIN tasks t ON t.id = r.task_id
       WHERE r.sent_at IS NULL
         AND r.trigger_at <= ?
         AND t.deleted_at IS NULL
         AND t.status = 'open'
       ORDER BY r.trigger_at ASC`
    )
    .all(now) as unknown as Array<ReminderRow & { task_title: string }>

  return rows.map((row) => ({
    ...toReminder(row),
    taskTitle: String(row.task_title)
  }))
}

export function listReminderCenter(
  db: DatabaseSync,
  now: string = nowIso()
): ReminderCenterData {
  const upcomingRows = db
    .prepare(
      `SELECT r.*, t.title AS task_title
       FROM reminders r
       JOIN tasks t ON t.id = r.task_id
       WHERE r.sent_at IS NULL
         AND r.trigger_at > ?
         AND t.deleted_at IS NULL
         AND t.status = 'open'
       ORDER BY r.trigger_at ASC
       LIMIT 50`
    )
    .all(now) as unknown as Array<ReminderRow & { task_title: string }>

  const cutoff = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString()
  const recentRows = db
    .prepare(
      `SELECT r.*, t.title AS task_title
       FROM reminders r
       JOIN tasks t ON t.id = r.task_id
       WHERE r.sent_at IS NOT NULL
         AND r.sent_at >= ?
         AND t.deleted_at IS NULL
       ORDER BY r.sent_at DESC
       LIMIT 50`
    )
    .all(cutoff) as unknown as Array<ReminderRow & { task_title: string }>

  const toItem = (row: ReminderRow & { task_title: string }): ReminderWithTask => ({
    ...toReminder(row),
    taskTitle: String(row.task_title)
  })

  return {
    upcoming: upcomingRows.map(toItem),
    recent: recentRows.map(toItem),
    ...listHabitReminderCenter(db, now)
  }
}

export function markReminderSent(
  db: DatabaseSync,
  id: string,
  sentAt: string = nowIso()
): void {
  db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').run(sentAt, id)
  logChange(db, 'reminder', id, 'update', { id, sentAt })
}
