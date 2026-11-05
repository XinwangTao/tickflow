import type { DatabaseSync } from 'node:sqlite'
import type { CreateListInput, ListWithCount, TodoList, UpdateListInput } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface ListRow {
  id: string
  name: string
  color: string
  emoji: string | null
  sort_order: number
  is_inbox: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

function toList(row: ListRow): TodoList {
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    emoji: row.emoji == null ? null : String(row.emoji),
    sortOrder: Number(row.sort_order),
    isInbox: Number(row.is_inbox) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at)
  }
}

export function getList(db: DatabaseSync, id: string): TodoList | undefined {
  const row = db
    .prepare('SELECT * FROM lists WHERE id = ? AND deleted_at IS NULL')
    .get(id) as unknown as ListRow | undefined
  return row ? toList(row) : undefined
}

export function listLists(db: DatabaseSync): ListWithCount[] {
  const rows = db
    .prepare(
      `SELECT l.*,
        (SELECT COUNT(*) FROM tasks t
         WHERE t.list_id = l.id AND t.status = 'open' AND t.deleted_at IS NULL) AS open_count
       FROM lists l
       WHERE l.deleted_at IS NULL
       ORDER BY l.is_inbox DESC, l.sort_order ASC, l.created_at ASC`
    )
    .all() as unknown as Array<ListRow & { open_count: number }>

  return rows.map((row) => ({ ...toList(row), openCount: Number(row.open_count) }))
}

export function createList(
  db: DatabaseSync,
  input: CreateListInput,
  options: { isInbox?: boolean } = {}
): TodoList {
  const name = input.name.trim()
  if (!name) throw new Error('清单名称不能为空')

  const id = uuidv7()
  const now = nowIso()
  const color = input.color?.trim() || '#f5c542'
  const emoji = input.emoji ?? null
  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM lists')
    .get() as unknown as { m: number }
  const sortOrder = Number(maxRow.m) + 1
  const isInbox = options.isInbox ? 1 : 0

  db.prepare(
    `INSERT INTO lists(id, name, color, emoji, sort_order, is_inbox, created_at, updated_at, deleted_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, color, emoji, sortOrder, isInbox, now, now, null, getDeviceId(db))

  const created = getList(db, id)
  if (!created) throw new Error('清单创建失败')
  logChange(db, 'list', id, 'create', created)
  return created
}

export function updateList(db: DatabaseSync, id: string, patch: UpdateListInput): TodoList {
  const existing = getList(db, id)
  if (!existing) throw new Error('清单不存在')

  const name = patch.name !== undefined ? patch.name.trim() : existing.name
  if (!name) throw new Error('清单名称不能为空')
  const color = patch.color !== undefined ? patch.color : existing.color
  const emoji = patch.emoji !== undefined ? patch.emoji : existing.emoji
  const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder

  db.prepare(
    `UPDATE lists SET name = ?, color = ?, emoji = ?, sort_order = ?, updated_at = ? WHERE id = ?`
  ).run(name, color, emoji, sortOrder, nowIso(), id)

  const updated = getList(db, id)
  if (!updated) throw new Error('清单更新失败')
  logChange(db, 'list', id, 'update', updated)
  return updated
}

export function deleteList(db: DatabaseSync, id: string): void {
  const existing = getList(db, id)
  if (!existing) return
  if (existing.isInbox) throw new Error('收集箱不能删除')

  const now = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    const taskRows = db
      .prepare('SELECT id FROM tasks WHERE list_id = ? AND deleted_at IS NULL')
      .all(id) as Array<{ id: string }>

    db.prepare(
      'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE list_id = ? AND deleted_at IS NULL'
    ).run(now, now, id)
    db.prepare('UPDATE lists SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)

    logChange(db, 'list', id, 'delete', { id })
    for (const task of taskRows) {
      logChange(db, 'task', String(task.id), 'delete', { id: String(task.id), listId: id })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function reorderLists(db: DatabaseSync, ids: string[]): void {
  const now = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    ids.forEach((id, index) => {
      db.prepare('UPDATE lists SET sort_order = ?, updated_at = ? WHERE id = ?').run(index, now, id)
      logChange(db, 'list', id, 'update', { id, sortOrder: index })
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function ensureInbox(db: DatabaseSync): TodoList {
  const row = db
    .prepare('SELECT * FROM lists WHERE is_inbox = 1 AND deleted_at IS NULL LIMIT 1')
    .get() as unknown as ListRow | undefined
  if (row) return toList(row)
  return createList(db, { name: '收集箱', color: '#f5c542', emoji: '📥' }, { isInbox: true })
}

export function getInboxId(db: DatabaseSync): string {
  const row = db
    .prepare('SELECT id FROM lists WHERE is_inbox = 1 AND deleted_at IS NULL LIMIT 1')
    .get() as unknown as { id: string } | undefined
  if (!row) throw new Error('收集箱不存在')
  return String(row.id)
}
