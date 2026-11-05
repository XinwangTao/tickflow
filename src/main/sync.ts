import type { DatabaseSync } from 'node:sqlite'
import type { Priority, SyncResult, TaskStatus, TodoList } from '@shared/types'
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

  return { version: 1, deviceId, updatedAt: nowIso(), lists, tasks }
}

export function applySnapshot(
  db: DatabaseSync,
  snapshot: SyncSnapshot
): { lists: number; tasks: number } {
  const lists = Array.isArray(snapshot.lists) ? snapshot.lists : []
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
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

    logChange(db, 'sync', 'batch', 'update', {
      lists: lists.length,
      tasks: tasks.length,
      at: now
    })
    db.exec('COMMIT')
    return { lists: lists.length, tasks: tasks.length }
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

export async function syncNow(db: DatabaseSync): Promise<SyncResult> {
  const config = getSyncConfig(db)
  if (!isSyncConfigured(config)) {
    return { ok: false, message: '请先填写完整的 R2 配置' }
  }
  try {
    const local = buildSnapshot(db)
    const { snapshot, downloaded } = await syncWithR2(local, config)
    const counts = applySnapshot(db, snapshot)
    setSettings(db, { r2LastSync: nowIso() })
    return {
      ok: true,
      message: `同步完成：${counts.tasks} 个任务、${counts.lists} 个清单（下载 ${downloaded} 份快照）`,
      downloaded,
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
