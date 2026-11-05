import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateFilterInput,
  CustomFilter,
  FilterDue,
  FilterQuery,
  FilterStatus,
  Priority
} from '@shared/types'
import { uuidv7 } from '@shared/uuid'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'

interface FilterRow {
  id: string
  name: string
  query_json: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
}

const STATUSES: FilterStatus[] = ['open', 'completed', 'abandoned', 'all']
const DUES: FilterDue[] = ['any', 'today', 'overdue', 'next7', 'no_date']

function normalizeQuery(raw: unknown): FilterQuery {
  const value = (raw ?? {}) as Partial<FilterQuery>
  const status = STATUSES.includes(value.status as FilterStatus)
    ? (value.status as FilterStatus)
    : 'open'
  const due = DUES.includes(value.due as FilterDue) ? (value.due as FilterDue) : 'any'
  const priorityValue =
    value.priority == null ? null : Math.min(3, Math.max(0, Math.round(Number(value.priority))))
  return {
    listId: value.listId == null || value.listId === '' ? null : String(value.listId),
    status,
    priority: priorityValue as Priority | null,
    tag: value.tag == null || value.tag === '' ? null : String(value.tag),
    due
  }
}

function toFilter(row: FilterRow): CustomFilter {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(String(row.query_json))
  } catch {
    parsed = {}
  }
  return {
    id: String(row.id),
    name: String(row.name),
    query: normalizeQuery(parsed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export function listFilters(db: DatabaseSync): CustomFilter[] {
  const rows = db
    .prepare(
      `SELECT * FROM filters WHERE deleted_at IS NULL
       ORDER BY created_at ASC`
    )
    .all() as unknown as FilterRow[]
  return rows.map(toFilter)
}

export function createFilter(db: DatabaseSync, input: CreateFilterInput): CustomFilter {
  const name = input.name.trim()
  if (!name) throw new Error('过滤器名称不能为空')
  const id = uuidv7()
  const now = nowIso()
  const query = normalizeQuery(input.query)
  db.prepare(
    `INSERT INTO filters(id, name, query_json, created_at, updated_at, deleted_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, JSON.stringify(query), now, now, null, getDeviceId(db))
  const row = db.prepare('SELECT * FROM filters WHERE id = ?').get(id) as unknown as FilterRow
  const filter = toFilter(row)
  logChange(db, 'filter', id, 'create', filter)
  return filter
}

export function deleteFilter(db: DatabaseSync, id: string): void {
  const now = nowIso()
  db.prepare(
    'UPDATE filters SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(now, now, id)
  logChange(db, 'filter', id, 'delete', { id })
}
