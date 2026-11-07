import type { DatabaseSync } from 'node:sqlite'
import type {
  Habit,
  HabitLog,
  HabitReminder,
  PomodoroSession,
  Priority,
  SyncResult,
  TaskStatus,
  TodoList
} from '@shared/types'
import type { R2Config, SyncSnapshot, SyncTask } from '@shared/sync'
import { R2Client, syncWithR2 } from '@shared/sync'
import { logChange } from './db/change-log'
import { getInboxId } from './db/lists'
import { getSettings, setSettings } from './db/settings'
import { setTaskTags } from './db/tags'
import { getDeviceId, nowIso } from './db/util'

function text(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function bool(value: unknown): boolean {
  return Number(value) === 1
}

export function buildSnapshot(db: DatabaseSync): SyncSnapshot {
  const deviceId = getDeviceId(db)
  const listRows = db.prepare('SELECT * FROM lists').all() as unknown as Array<
    Record<string, unknown>
  >
  const lists: TodoList[] = listRows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    color: text(row.color, '#f5c542'),
    emoji: row.emoji == null ? null : text(row.emoji),
    sortOrder: Number(row.sort_order ?? 0),
    isInbox: bool(row.is_inbox),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: row.deleted_at == null ? null : text(row.deleted_at)
  }))

  const taskRows = db
    .prepare(
      `SELECT t.*,
        COALESCE((
          SELECT json_group_array(tg.name)
          FROM task_tags tt
          JOIN tags tg ON tg.id = tt.tag_id
          WHERE tt.task_id = t.id AND tg.deleted_at IS NULL
        ), '[]') AS tag_names
       FROM tasks t`
    )
    .all() as unknown as Array<Record<string, unknown>>

  const tasks: SyncTask[] = taskRows.map((row) => {
    let tagNames: string[] = []
    try {
      const parsed = JSON.parse(text(row.tag_names, '[]'))
      if (Array.isArray(parsed)) tagNames = parsed.map(String)
    } catch {
      tagNames = []
    }
    const status = text(row.status) as TaskStatus
    return {
      id: text(row.id),
      listId: text(row.list_id),
      parentId: row.parent_id == null ? null : text(row.parent_id),
      title: text(row.title, '未命名任务'),
      notes: text(row.notes),
      status: status === 'completed' || status === 'abandoned' ? status : 'open',
      priority: Math.min(3, Math.max(0, Number(row.priority ?? 0))) as Priority,
      dueDate: row.due_date == null ? null : text(row.due_date),
      dueTime: row.due_time == null ? null : text(row.due_time),
      allDay: bool(row.all_day),
      startDate: row.start_date == null ? null : text(row.start_date),
      recurrence: row.recurrence == null ? null : text(row.recurrence),
      pinned: bool(row.pinned),
      sortOrder: Number(row.sort_order ?? 0),
      completedAt: row.completed_at == null ? null : text(row.completed_at),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      deletedAt: row.deleted_at == null ? null : text(row.deleted_at),
      tagNames
    }
  })

  const habitRows = db.prepare('SELECT * FROM habits').all() as unknown as Array<
    Record<string, unknown>
  >
  const habits: Habit[] = habitRows.map((row) => ({
    id: text(row.id),
    name: text(row.name, '习惯'),
    icon: row.icon == null ? null : text(row.icon),
    color: text(row.color, '#30a46c'),
    frequency: text(row.frequency) === 'weekly' ? 'weekly' : 'daily',
    targetPerWeek: Number(row.target_per_week ?? 7),
    archived: bool(row.archived),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: row.deleted_at == null ? null : text(row.deleted_at)
  }))

  const logRows = db.prepare('SELECT * FROM habit_logs').all() as unknown as Array<
    Record<string, unknown>
  >
  const habitLogs: HabitLog[] = logRows.map((row) => ({
    id: text(row.id),
    habitId: text(row.habit_id),
    logDate: text(row.log_date),
    value: Number(row.value ?? 1),
    note: text(row.note),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: row.deleted_at == null ? null : text(row.deleted_at)
  }))

  const sessionRows = db
    .prepare('SELECT * FROM pomodoro_sessions')
    .all() as unknown as Array<Record<string, unknown>>
  const pomodoroSessions: PomodoroSession[] = sessionRows.map((row) => ({
    id: text(row.id),
    taskId: row.task_id == null ? null : text(row.task_id),
    mode: text(row.mode) === 'break' ? 'break' : 'focus',
    durationMinutes: Number(row.duration_minutes ?? 0),
    startedAt: text(row.started_at),
    endedAt: text(row.ended_at),
    completed: bool(row.completed),
    createdAt: text(row.created_at)
  }))

  const reminderRows = db
    .prepare('SELECT * FROM habit_reminders')
    .all() as unknown as Array<Record<string, unknown>>
  const habitReminders: HabitReminder[] = reminderRows.map((row) => ({
    id: text(row.id),
    habitId: text(row.habit_id),
    triggerAt: text(row.trigger_at),
    enabled: bool(row.enabled),
    sentAt: row.sent_at == null ? null : text(row.sent_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: row.deleted_at == null ? null : text(row.deleted_at)
  }))

  return {
    version: 1,
    deviceId,
    updatedAt: nowIso(),
    lists,
    tasks,
    habits,
    habitLogs,
    pomodoroSessions,
    habitReminders
  }
}

export function applySnapshot(
  db: DatabaseSync,
  snapshot: SyncSnapshot
): {
  lists: number
  tasks: number
  habits: number
  habitLogs: number
  pomodoroSessions: number
  habitReminders: number
} {
  const lists = Array.isArray(snapshot.lists) ? snapshot.lists : []
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const habits = Array.isArray(snapshot.habits) ? snapshot.habits : []
  const habitLogs = Array.isArray(snapshot.habitLogs) ? snapshot.habitLogs : []
  const pomodoroSessions = Array.isArray(snapshot.pomodoroSessions)
    ? snapshot.pomodoroSessions
    : []
  const habitReminders = Array.isArray(snapshot.habitReminders)
    ? snapshot.habitReminders
    : []
  const inboxId = getInboxId(db)
  const deviceId = getDeviceId(db)
  const now = nowIso()

  db.exec('BEGIN IMMEDIATE')
  try {
    const listIds = new Set(
      (db.prepare('SELECT id FROM lists').all() as unknown as Array<{ id: string }>).map(
        (row) => String(row.id)
      )
    )

    for (const list of lists) {
      if (!list.id) continue
      db.prepare(
        `INSERT INTO lists(id, name, color, emoji, sort_order, is_inbox, created_at, updated_at, deleted_at, device_id)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           emoji = excluded.emoji,
           sort_order = excluded.sort_order,
           is_inbox = excluded.is_inbox,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      ).run(
        text(list.id),
        text(list.name, '未命名清单'),
        text(list.color, '#f5c542'),
        list.emoji == null ? null : text(list.emoji),
        Number(list.sortOrder ?? 0),
        list.isInbox ? 1 : 0,
        text(list.createdAt, now),
        text(list.updatedAt, now),
        list.deletedAt == null ? null : text(list.deletedAt),
        deviceId
      )
      listIds.add(text(list.id))
    }

    const taskIds = new Set(
      (db.prepare('SELECT id FROM tasks').all() as unknown as Array<{ id: string }>).map(
        (row) => String(row.id)
      )
    )

    for (const task of tasks) {
      if (!task.id) continue
      const listId = listIds.has(text(task.listId)) ? text(task.listId) : inboxId
      db.prepare(
        `INSERT INTO tasks(
          id, list_id, parent_id, title, notes, status, priority,
          due_date, due_time, all_day, start_date, recurrence, pinned, sort_order,
          completed_at, created_at, updated_at, deleted_at, device_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          list_id = excluded.list_id,
          parent_id = excluded.parent_id,
          title = excluded.title,
          notes = excluded.notes,
          status = excluded.status,
          priority = excluded.priority,
          due_date = excluded.due_date,
          due_time = excluded.due_time,
          all_day = excluded.all_day,
          start_date = excluded.start_date,
          recurrence = excluded.recurrence,
          pinned = excluded.pinned,
          sort_order = excluded.sort_order,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at`
      ).run(
        text(task.id),
        listId,
        null,
        text(task.title, '未命名任务'),
        text(task.notes),
        task.status === 'completed' || task.status === 'abandoned' ? task.status : 'open',
        Math.min(3, Math.max(0, Number(task.priority ?? 0))),
        task.dueDate == null ? null : text(task.dueDate),
        task.dueTime == null ? null : text(task.dueTime),
        task.allDay ? 1 : 0,
        task.startDate == null ? null : text(task.startDate),
        task.recurrence == null ? null : text(task.recurrence),
        task.pinned ? 1 : 0,
        Number(task.sortOrder ?? 0),
        task.completedAt == null ? null : text(task.completedAt),
        text(task.createdAt, now),
        text(task.updatedAt, now),
        task.deletedAt == null ? null : text(task.deletedAt),
        deviceId
      )
      taskIds.add(text(task.id))
    }

    for (const task of tasks) {
      if (!task.id) continue
      const parentId = task.parentId ? text(task.parentId) : null
      if (parentId && taskIds.has(parentId)) {
        db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(parentId, text(task.id))
      } else {
        db.prepare('UPDATE tasks SET parent_id = NULL WHERE id = ?').run(text(task.id))
      }
    }

    for (const task of tasks) {
      if (!task.id) continue
      setTaskTags(
        db,
        text(task.id),
        Array.isArray(task.tagNames) ? task.tagNames.map(String) : []
      )
    }

    const habitIds = new Set(
      (
        db.prepare('SELECT id FROM habits').all() as unknown as Array<{ id: string }>
      ).map((row) => String(row.id))
    )
    for (const habit of habits) {
      if (!habit.id) continue
      habitIds.add(text(habit.id))
      db.prepare(
        `INSERT INTO habits(
          id, name, icon, color, frequency, target_per_week, archived, sort_order,
          created_at, updated_at, deleted_at, device_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          icon = excluded.icon,
          color = excluded.color,
          frequency = excluded.frequency,
          target_per_week = excluded.target_per_week,
          archived = excluded.archived,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at`
      ).run(
        text(habit.id),
        text(habit.name, '习惯'),
        habit.icon == null ? null : text(habit.icon),
        text(habit.color, '#30a46c'),
        habit.frequency === 'weekly' ? 'weekly' : 'daily',
        Math.min(7, Math.max(1, Number(habit.targetPerWeek ?? 7))),
        habit.archived ? 1 : 0,
        Number(habit.sortOrder ?? 0),
        text(habit.createdAt, now),
        text(habit.updatedAt, now),
        habit.deletedAt == null ? null : text(habit.deletedAt),
        deviceId
      )
    }

    for (const log of habitLogs) {
      if (!log.id || !log.habitId || !log.logDate) continue
      if (!habitIds.has(text(log.habitId))) continue
      const existing = db
        .prepare('SELECT id FROM habit_logs WHERE habit_id = ? AND log_date = ?')
        .get(text(log.habitId), text(log.logDate)) as { id: string } | undefined
      if (existing && String(existing.id) !== text(log.id)) {
        db.prepare('DELETE FROM habit_logs WHERE id = ?').run(String(existing.id))
      }
      db.prepare(
        `INSERT INTO habit_logs(
          id, habit_id, log_date, value, note, created_at, updated_at, deleted_at, device_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          habit_id = excluded.habit_id,
          log_date = excluded.log_date,
          value = excluded.value,
          note = excluded.note,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at`
      ).run(
        text(log.id),
        text(log.habitId),
        text(log.logDate),
        Number(log.value ?? 1),
        text(log.note),
        text(log.createdAt, now),
        text(log.updatedAt, now),
        log.deletedAt == null ? null : text(log.deletedAt),
        deviceId
      )
    }

    for (const session of pomodoroSessions) {
      if (!session.id) continue
      const taskId =
        session.taskId != null && taskIds.has(text(session.taskId))
          ? text(session.taskId)
          : null
      db.prepare(
        `INSERT OR REPLACE INTO pomodoro_sessions(
          id, task_id, mode, duration_minutes, started_at, ended_at, completed, created_at, device_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        text(session.id),
        taskId,
        session.mode === 'break' ? 'break' : 'focus',
        Number(session.durationMinutes ?? 0),
        text(session.startedAt, now),
        text(session.endedAt, now),
        session.completed ? 1 : 0,
        text(session.createdAt, now),
        deviceId
      )
    }

    for (const reminder of habitReminders) {
      if (!reminder.id || !reminder.habitId) continue
      if (!habitIds.has(text(reminder.habitId))) continue
      const existing = db
        .prepare('SELECT id FROM habit_reminders WHERE habit_id = ?')
        .get(text(reminder.habitId)) as { id: string } | undefined
      if (existing && String(existing.id) !== text(reminder.id)) {
        db.prepare('DELETE FROM habit_reminders WHERE id = ?').run(String(existing.id))
      }
      db.prepare(
        `INSERT INTO habit_reminders(
          id, habit_id, trigger_at, enabled, sent_at, created_at, updated_at, deleted_at, device_id
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          habit_id = excluded.habit_id,
          trigger_at = excluded.trigger_at,
          enabled = excluded.enabled,
          sent_at = excluded.sent_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at`
      ).run(
        text(reminder.id),
        text(reminder.habitId),
        text(reminder.triggerAt, now),
        reminder.enabled ? 1 : 0,
        reminder.sentAt == null ? null : text(reminder.sentAt),
        text(reminder.createdAt, now),
        text(reminder.updatedAt, now),
        reminder.deletedAt == null ? null : text(reminder.deletedAt),
        deviceId
      )
    }

    logChange(db, 'sync', 'batch', 'update', {
      lists: lists.length,
      tasks: tasks.length,
      habits: habits.length,
      habitLogs: habitLogs.length,
      pomodoroSessions: pomodoroSessions.length,
      habitReminders: habitReminders.length,
      at: now
    })
    db.exec('COMMIT')
    return {
      lists: lists.length,
      tasks: tasks.length,
      habits: habits.length,
      habitLogs: habitLogs.length,
      pomodoroSessions: pomodoroSessions.length,
      habitReminders: habitReminders.length
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getSyncConfig(db: DatabaseSync): R2Config {
  const settings = getSettings(db)
  return {
    endpoint: settings.r2Endpoint,
    bucket: settings.r2Bucket,
    accessKeyId: settings.r2AccessKeyId,
    secretAccessKey: settings.r2SecretAccessKey,
    prefix: settings.r2Prefix
  }
}

export function isSyncConfigured(config: R2Config): boolean {
  return Boolean(
    config.endpoint?.trim() &&
      config.bucket?.trim() &&
      config.accessKeyId?.trim() &&
      config.secretAccessKey?.trim()
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function testSync(db: DatabaseSync): Promise<SyncResult> {
  const config = getSyncConfig(db)
  if (!isSyncConfigured(config)) {
    return { ok: false, message: '请先填写完整的 R2 配置' }
  }
  try {
    await new R2Client(config).test()
    return { ok: true, message: 'R2 连接成功' }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function getSyncUsage(
  db: DatabaseSync
): Promise<{ objects: number; bytes: number }> {
  const config = getSyncConfig(db)
  if (!isSyncConfigured(config)) throw new Error('请先填写完整的 R2 配置')
  const objects = await new R2Client(config).listObjects()
  return {
    objects: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.size, 0)
  }
}

export async function syncNow(db: DatabaseSync): Promise<SyncResult> {
  const config = getSyncConfig(db)
  if (!isSyncConfigured(config)) {
    return { ok: false, message: '请先填写完整的 R2 配置' }
  }
  try {
    const local = buildSnapshot(db)
    const { snapshot, downloaded, bytes } = await syncWithR2(local, config)
    const counts = applySnapshot(db, snapshot)
    setSettings(db, { r2LastSync: nowIso() })
    return {
      ok: true,
      message: `同步完成：${counts.tasks} 个任务、${counts.lists} 个清单（下载 ${downloaded} 份快照，上传 ${(bytes / 1024).toFixed(1)} KB）`,
      downloaded,
      bytes,
      updatedAt: snapshot.updatedAt
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function autoSync(db: DatabaseSync): Promise<SyncResult | null> {
  const settings = getSettings(db)
  if (!settings.r2AutoSync) return null
  return syncNow(db)
}
