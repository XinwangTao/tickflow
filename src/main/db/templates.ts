import type { DatabaseSync } from 'node:sqlite'
import type {
  ApplyTemplateInput,
  CreateTemplateInput,
  Priority,
  TaskWithMeta,
  Template,
  TemplatePayload
} from '@shared/types'
import { todayKey } from '@shared/dates'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getInboxId } from './lists'
import { createTask, getTaskWithMeta } from './tasks'
import { getDeviceId, nowIso } from './util'

interface TemplateRow {
  id: string
  name: string
  payload: string
  created_at: string
  updated_at: string
  device_id: string
}

function normalizePayload(raw: unknown): TemplatePayload {
  const value = (raw ?? {}) as Partial<TemplatePayload>
  const priority = Math.min(
    3,
    Math.max(0, Math.round(Number(value.priority ?? 0)))
  ) as Priority
  return {
    title: String(value.title ?? '').trim() || '新任务',
    notes: String(value.notes ?? ''),
    priority,
    tagNames: Array.isArray(value.tagNames)
      ? Array.from(new Set(value.tagNames.map(String).map((name) => name.trim()).filter(Boolean)))
      : [],
    listId: value.listId == null ? null : String(value.listId),
    dueTime: value.dueTime == null ? null : String(value.dueTime),
    allDay: value.allDay !== false
  }
}

function toTemplate(row: TemplateRow): Template {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(String(row.payload))
  } catch {
    parsed = {}
  }
  return {
    id: String(row.id),
    name: String(row.name),
    payload: normalizePayload(parsed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function getTemplate(db: DatabaseSync, id: string): Template | undefined {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined
  return row ? toTemplate(row) : undefined
}

export function listTemplates(db: DatabaseSync): Template[] {
  const rows = db
    .prepare('SELECT * FROM templates ORDER BY created_at DESC')
    .all() as unknown as TemplateRow[]
  return rows.map(toTemplate)
}

export function createTemplate(db: DatabaseSync, input: CreateTemplateInput): Template {
  const name = input.name.trim()
  if (!name) throw new Error('模板名称不能为空')
  const id = uuidv7()
  const now = nowIso()
  const payload = normalizePayload(input.payload)
  db.prepare(
    `INSERT INTO templates(id, name, payload, created_at, updated_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`
  ).run(id, name, JSON.stringify(payload), now, now, getDeviceId(db))
  const template = getTemplate(db, id)
  if (!template) throw new Error('模板创建失败')
  logChange(db, 'template', id, 'create', template)
  return template
}

export function deleteTemplate(db: DatabaseSync, id: string): void {
  const existing = getTemplate(db, id)
  if (!existing) return
  db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  logChange(db, 'template', id, 'delete', { id })
}

export function createTemplateFromTask(
  db: DatabaseSync,
  taskId: string,
  name: string
): Template {
  const task = getTaskWithMeta(db, taskId)
  if (!task) throw new Error('任务不存在')
  return createTemplate(db, {
    name,
    payload: {
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      tagNames: task.tags.map((tag) => tag.name),
      listId: task.listId,
      dueTime: task.dueTime,
      allDay: task.allDay
    }
  })
}

export function applyTemplate(
  db: DatabaseSync,
  id: string,
  input: ApplyTemplateInput = {}
): TaskWithMeta {
  const template = getTemplate(db, id)
  if (!template) throw new Error('模板不存在')

  let listId = input.listId ?? template.payload.listId
  if (listId) {
    const exists = db
      .prepare('SELECT id FROM lists WHERE id = ? AND deleted_at IS NULL')
      .get(listId) as { id: string } | undefined
    if (!exists) listId = null
  }
  if (!listId) listId = getInboxId(db)

  return createTask(db, {
    listId,
    title: template.payload.title,
    notes: template.payload.notes,
    priority: template.payload.priority,
    tagNames: template.payload.tagNames,
    dueDate: input.dueDate ?? todayKey(),
    dueTime: template.payload.dueTime,
    allDay: template.payload.allDay
  })
}
