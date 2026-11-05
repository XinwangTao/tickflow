import type { DatabaseSync } from 'node:sqlite'
import type { Attachment } from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface AttachmentRow {
  id: string
  task_id: string
  name: string
  stored_name: string
  size: number
  mime: string
  created_at: string
  device_id: string
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    name: String(row.name),
    storedName: String(row.stored_name),
    size: Number(row.size),
    mime: String(row.mime),
    createdAt: String(row.created_at)
  }
}

export function listAttachments(db: DatabaseSync, taskId: string): Attachment[] {
  const rows = db
    .prepare(
      'SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC'
    )
    .all(taskId) as unknown as AttachmentRow[]
  return rows.map(toAttachment)
}

export interface NewAttachmentRecord {
  taskId: string
  name: string
  storedName: string
  size: number
  mime: string
}

export function createAttachment(
  db: DatabaseSync,
  input: NewAttachmentRecord
): Attachment {
  const id = uuidv7()
  const now = nowIso()
  db.prepare(
    `INSERT INTO attachments(id, task_id, name, stored_name, size, mime, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.taskId,
    input.name,
    input.storedName,
    Math.max(0, Math.round(input.size)),
    input.mime || 'application/octet-stream',
    now,
    getDeviceId(db)
  )
  const created: Attachment = {
    id,
    taskId: input.taskId,
    name: input.name,
    storedName: input.storedName,
    size: Math.max(0, Math.round(input.size)),
    mime: input.mime || 'application/octet-stream',
    createdAt: now
  }
  logChange(db, 'attachment', id, 'create', created)
  return created
}

export function getAttachment(
  db: DatabaseSync,
  id: string
): Attachment | undefined {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
    | AttachmentRow
    | undefined
  return row ? toAttachment(row) : undefined
}

export function deleteAttachment(
  db: DatabaseSync,
  id: string
): Attachment | undefined {
  const existing = getAttachment(db, id)
  if (!existing) return undefined
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
  logChange(db, 'attachment', id, 'delete', { id })
  return existing
}
