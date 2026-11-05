import type { DatabaseSync } from 'node:sqlite'
import type { Tag } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface TagRow {
  id: string
  name: string
  color: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

function toTag(row: TagRow): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color == null ? null : String(row.color),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export function listTags(db: DatabaseSync): Array<Tag & { taskCount: number }> {
  const rows = db
    .prepare(
      `SELECT tg.*, COUNT(t.id) AS task_count
       FROM tags tg
       LEFT JOIN task_tags tt ON tt.tag_id = tg.id
       LEFT JOIN tasks t
         ON t.id = tt.task_id AND t.deleted_at IS NULL AND t.status = 'open'
       WHERE tg.deleted_at IS NULL
       GROUP BY tg.id
       ORDER BY tg.name COLLATE NOCASE ASC`
    )
    .all() as unknown as Array<TagRow & { task_count: number }>

  return rows.map((row) => ({ ...toTag(row), taskCount: Number(row.task_count) }))
}

export function ensureTag(db: DatabaseSync, rawName: string): Tag {
  const name = rawName.trim()
  if (!name) throw new Error('标签名称不能为空')

  const existing = db
    .prepare('SELECT * FROM tags WHERE name = ?')
    .get(name) as unknown as TagRow | undefined
  if (existing) {
    if (existing.deleted_at) {
      db.prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
        nowIso(),
        existing.id
      )
      logChange(db, 'tag', String(existing.id), 'update', { id: existing.id, name, deletedAt: null })
      return { ...toTag(existing), updatedAt: nowIso() }
    }
    return toTag(existing)
  }

  const id = uuidv7()
  const now = nowIso()
  db.prepare(
    `INSERT INTO tags(id, name, color, created_at, updated_at, deleted_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, null, now, now, null, getDeviceId(db))

  const created: Tag = { id, name, color: null, createdAt: now, updatedAt: now }
  logChange(db, 'tag', id, 'create', created)
  return created
}

export function renameTag(db: DatabaseSync, id: string, rawName: string): void {
  const name = rawName.trim()
  if (!name) throw new Error('标签名称不能为空')

  const source = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as unknown as
    | TagRow
    | undefined
  if (!source || source.deleted_at) throw new Error('标签不存在')
  if (source.name === name) return

  const now = nowIso()
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as unknown as
    | TagRow
    | undefined

  if (existing && existing.id !== id) {
    if (existing.deleted_at) {
      db.prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
        now,
        existing.id
      )
    }
    db.prepare(
      `INSERT OR IGNORE INTO task_tags(task_id, tag_id)
       SELECT task_id, ? FROM task_tags WHERE tag_id = ?`
    ).run(existing.id, id)
    db.prepare('DELETE FROM task_tags WHERE tag_id = ?').run(id)
    db.prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    logChange(db, 'tag', id, 'delete', { id, deletedAt: now, mergedInto: existing.id })
    logChange(db, 'tag', existing.id, 'update', { id: existing.id, name, deletedAt: null })
    return
  }

  db.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
  logChange(db, 'tag', id, 'update', { id, name })
}

export function deleteTag(db: DatabaseSync, id: string): void {
  const now = nowIso()
  db.prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  db.prepare('DELETE FROM task_tags WHERE tag_id = ?').run(id)
  logChange(db, 'tag', id, 'delete', { id, deletedAt: now })
}

export function setTaskTags(db: DatabaseSync, taskId: string, names: string[]): void {
  db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId)
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
  for (const name of unique) {
    const tag = ensureTag(db, name)
    db.prepare('INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES(?, ?)').run(taskId, tag.id)
  }
}
