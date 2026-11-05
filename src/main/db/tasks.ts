import type { DatabaseSync } from 'node:sqlite'
import type {
  Counts,
  CreateTaskInput,
  Priority,
  Tag,
  TaskQuery,
  TaskStatus,
  TaskWithMeta,
  UpdateTaskInput
} from '@shared/types'
import { addDaysToKey, fromDateKey, toDateKey, todayKey } from '@shared/dates'
import { uuidv7 } from '@shared/uuid'
import { RRule } from 'rrule'
import { logChange } from './change-log'
import { getDeviceId, nowIso } from './util'
import { getInboxId } from './lists'
import { setTaskTags } from './tags'

interface TaskRow {
  id: string
  list_id: string
  parent_id: string | null
  title: string
  notes: string
  status: string
  priority: number
  due_date: string | null
  due_time: string | null
  all_day: number
  start_date: string | null
  recurrence: string | null
  pinned: number
  sort_order: number
  completed_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  device_id: string
  list_name: string
  list_color: string
  list_emoji: string | null
  tags_json: string
  subtask_count: number
  subtask_done: number
}

const BASE_SELECT = `
  SELECT
    t.*,
    l.name AS list_name,
    l.color AS list_color,
    l.emoji AS list_emoji,
    COALESCE((
      SELECT json_group_array(json_object(
        'id', tg.id,
        'name', tg.name,
        'color', tg.color,
        'createdAt', tg.created_at,
        'updatedAt', tg.updated_at
      ))
      FROM task_tags tt
      JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.task_id = t.id AND tg.deleted_at IS NULL
    ), '[]') AS tags_json,
    (SELECT COUNT(*) FROM tasks st
     WHERE st.parent_id = t.id AND st.deleted_at IS NULL) AS subtask_count,
    (SELECT COUNT(*) FROM tasks st
     WHERE st.parent_id = t.id AND st.deleted_at IS NULL AND st.status = 'completed') AS subtask_done
  FROM tasks t
  JOIN lists l ON l.id = t.list_id
`

function toTask(row: TaskRow): TaskWithMeta {
  const tags = JSON.parse(String(row.tags_json || '[]')) as Array<{
    id: string
    name: string
    color: string | null
    createdAt: string
    updatedAt: string
  }>

  return {
    id: String(row.id),
    listId: String(row.list_id),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    title: String(row.title),
    notes: String(row.notes),
    status: String(row.status) as TaskStatus,
    priority: Number(row.priority) as Priority,
    dueDate: row.due_date == null ? null : String(row.due_date),
    dueTime: row.due_time == null ? null : String(row.due_time),
    allDay: Number(row.all_day) === 1,
    startDate: row.start_date == null ? null : String(row.start_date),
    recurrence: row.recurrence == null ? null : String(row.recurrence),
    pinned: Number(row.pinned) === 1,
    sortOrder: Number(row.sort_order),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    tags: tags.map((tag) => ({
      id: String(tag.id),
      name: String(tag.name),
      color: tag.color == null ? null : String(tag.color),
      createdAt: String(tag.createdAt),
      updatedAt: String(tag.updatedAt)
    })) as Tag[],
    listName: String(row.list_name),
    listColor: String(row.list_color),
    listEmoji: row.list_emoji == null ? null : String(row.list_emoji),
    subtaskCount: Number(row.subtask_count),
    subtaskDone: Number(row.subtask_done)
  }
}

function nextRecurrenceDate(
  ruleText: string,
  dueDate: string | null,
  dueTime: string | null
): Date | null {
  try {
    const key = dueDate ?? todayKey()
    const [hours, minutes] = (dueTime ?? '09:00').split(':').map(Number)
    const base = fromDateKey(key)
    base.setHours(
      Number.isFinite(hours) ? hours : 9,
      Number.isFinite(minutes) ? minutes : 0,
      0,
      0
    )
    const options = RRule.parseString(ruleText)
    const rule = new RRule({ ...options, dtstart: base })
    const next = rule.after(base, false)
    if (next && next.getTime() >= Date.now()) return next
    return rule.after(new Date(), true)
  } catch {
    return null
  }
}

function buildQuery(query: TaskQuery): {
  where: string
  params: Array<string | number>
  order: string
  limit: number
} {
  const today = todayKey()
  const weekEnd = addDaysToKey(today, 7)
  const dueOrder =
    't.pinned DESC, t.due_date ASC, CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END, t.due_time ASC, t.created_at DESC'

  switch (query.view) {
    case 'today':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'open' AND t.parent_id IS NULL AND t.due_date IS NOT NULL AND t.due_date <= ?`,
        params: [today],
        order: dueOrder,
        limit: 1000
      }
    case 'next7':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'open' AND t.parent_id IS NULL AND t.due_date >= ? AND t.due_date <= ?`,
        params: [today, weekEnd],
        order: dueOrder,
        limit: 1000
      }
    case 'inbox':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'open' AND t.parent_id IS NULL AND l.is_inbox = 1`,
        params: [],
        order: 't.pinned DESC, t.sort_order ASC, t.created_at DESC',
        limit: 1000
      }
    case 'all':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'open' AND t.parent_id IS NULL`,
        params: [],
        order: dueOrder,
        limit: 5000
      }
    case 'completed':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'completed' AND t.parent_id IS NULL`,
        params: [],
        order: 't.completed_at DESC',
        limit: 500
      }
    case 'abandoned':
      return {
        where: `t.deleted_at IS NULL AND t.status = 'abandoned' AND t.parent_id IS NULL`,
        params: [],
        order: 't.updated_at DESC',
        limit: 500
      }
    case 'trash':
      return {
        where: `t.deleted_at IS NOT NULL AND t.parent_id IS NULL`,
        params: [],
        order: 't.deleted_at DESC',
        limit: 500
      }
    case 'list': {
      const statusClause = query.includeCompleted
        ? `t.status IN ('open', 'completed')`
        : `t.status = 'open'`
      return {
        where: `t.deleted_at IS NULL AND t.parent_id IS NULL AND ${statusClause} AND t.list_id = ?`,
        params: [query.listId],
        order: 't.pinned DESC, t.sort_order ASC, t.created_at DESC',
        limit: 2000
      }
    }
    case 'subtasks':
      return {
        where: `t.deleted_at IS NULL AND t.parent_id = ?`,
        params: [query.parentId],
        order: 't.created_at ASC',
        limit: 500
      }
    case 'search': {
      const q = query.q.trim()
      if (!q) return { where: '0', params: [], order: 't.updated_at DESC', limit: 0 }

      if (q.startsWith('#')) {
        const tagName = `%${q.slice(1).replace(/[%_]/g, (m) => `\\${m}`)}%`
        return {
          where: `t.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
            WHERE tt.task_id = t.id AND tg.name LIKE ? ESCAPE '\\'
          )`,
          params: [tagName],
          order: 't.updated_at DESC',
          limit: 200
        }
      }

      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`
      return {
        where: `t.deleted_at IS NULL AND (
          t.title LIKE ? ESCAPE '\\' OR
          t.notes LIKE ? ESCAPE '\\' OR
          EXISTS (
            SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
            WHERE tt.task_id = t.id AND tg.name LIKE ? ESCAPE '\\'
          )
        )`,
        params: [like, like, like],
        order: 't.updated_at DESC',
        limit: 200
      }
    }
  }
}

export function queryTasks(db: DatabaseSync, query: TaskQuery): TaskWithMeta[] {
  const { where, params, order, limit } = buildQuery(query)
  let sql = `${BASE_SELECT} WHERE ${where} ORDER BY ${order}`
  if (limit > 0) sql += ` LIMIT ${limit}`
  const rows = db.prepare(sql).all(...params) as unknown as TaskRow[]
  return rows.map(toTask)
}

export function getTaskWithMeta(db: DatabaseSync, id: string): TaskWithMeta | undefined {
  const row = db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id) as unknown as
    | TaskRow
    | undefined
  return row ? toTask(row) : undefined
}

export function createTask(db: DatabaseSync, input: CreateTaskInput): TaskWithMeta {
  const title = input.title.trim() || '新任务'
  const listId = input.listId || getInboxId(db)
  const id = uuidv7()
  const now = nowIso()
  const allDay = input.allDay ?? !input.dueTime
  const maxRow = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE list_id = ? AND deleted_at IS NULL'
    )
    .get(listId) as unknown as { m: number }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO tasks(
        id, list_id, parent_id, title, notes, status, priority,
        due_date, due_time, all_day, start_date, recurrence, pinned, sort_order,
        completed_at, created_at, updated_at, deleted_at, device_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      listId,
      input.parentId ?? null,
      title,
      input.notes ?? '',
      'open',
      input.priority ?? 0,
      input.dueDate ?? null,
      input.dueTime ?? null,
      allDay ? 1 : 0,
      input.startDate ?? null,
      input.recurrence ?? null,
      input.pinned ? 1 : 0,
      Number(maxRow.m) + 1,
      null,
      now,
      now,
      null,
      getDeviceId(db)
    )

    if (input.tagNames?.length) setTaskTags(db, id, input.tagNames)

    const created = getTaskWithMeta(db, id)
    if (!created) throw new Error('任务创建失败')
    logChange(db, 'task', id, 'create', created)
    db.exec('COMMIT')
    return created
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function updateTask(db: DatabaseSync, id: string, patch: UpdateTaskInput): TaskWithMeta {
  const existing = getTaskWithMeta(db, id)
  if (!existing) throw new Error('任务不存在')

  const next = {
    title: patch.title !== undefined ? patch.title.trim() || '新任务' : existing.title,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    listId: patch.listId !== undefined ? patch.listId : existing.listId,
    priority: patch.priority !== undefined ? patch.priority : existing.priority,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
    dueTime: patch.dueTime !== undefined ? patch.dueTime : existing.dueTime,
    allDay: patch.allDay !== undefined ? patch.allDay : existing.allDay,
    startDate: patch.startDate !== undefined ? patch.startDate : existing.startDate,
    recurrence: patch.recurrence !== undefined ? patch.recurrence : existing.recurrence,
    pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder,
    updatedAt: nowIso()
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `UPDATE tasks SET
        title = ?, notes = ?, list_id = ?, priority = ?,
        due_date = ?, due_time = ?, all_day = ?, start_date = ?, recurrence = ?,
        pinned = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      next.title,
      next.notes,
      next.listId,
      next.priority,
      next.dueDate,
      next.dueTime,
      next.allDay ? 1 : 0,
      next.startDate,
      next.recurrence,
      next.pinned ? 1 : 0,
      next.sortOrder,
      next.updatedAt,
      id
    )

    if (patch.tagNames !== undefined) setTaskTags(db, id, patch.tagNames)

    const updated = getTaskWithMeta(db, id)
    if (!updated) throw new Error('任务更新失败')
    logChange(db, 'task', id, 'update', updated)
    db.exec('COMMIT')
    return updated
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function setTaskStatus(
  db: DatabaseSync,
  id: string,
  status: TaskStatus
): TaskWithMeta {
  const existing = getTaskWithMeta(db, id)
  if (!existing) throw new Error('任务不存在')

  const now = nowIso()
  const completedAt = status === 'completed' ? now : null

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?'
    ).run(status, completedAt, now, id)

    if (status === 'completed' && existing.status !== 'completed' && existing.recurrence) {
      const next = nextRecurrenceDate(existing.recurrence, existing.dueDate, existing.dueTime)
      if (next) {
        const generatedId = uuidv7()
        const maxRow = db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE list_id = ? AND deleted_at IS NULL'
          )
          .get(existing.listId) as unknown as { m: number }

        db.prepare(
          `INSERT INTO tasks(
            id, list_id, parent_id, title, notes, status, priority,
            due_date, due_time, all_day, start_date, recurrence, pinned, sort_order,
            completed_at, created_at, updated_at, deleted_at, device_id
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generatedId,
          existing.listId,
          existing.parentId,
          existing.title,
          existing.notes,
          'open',
          existing.priority,
          toDateKey(next),
          existing.dueTime,
          existing.allDay ? 1 : 0,
          existing.startDate,
          existing.recurrence,
          existing.pinned ? 1 : 0,
          Number(maxRow.m) + 1,
          null,
          now,
          now,
          null,
          getDeviceId(db)
        )

        if (existing.tags.length) {
          setTaskTags(db, generatedId, existing.tags.map((tag) => tag.name))
        }
        const generated = getTaskWithMeta(db, generatedId)
        if (generated) logChange(db, 'task', generatedId, 'create', generated)
      }
    }

    const updated = getTaskWithMeta(db, id)
    if (!updated) throw new Error('任务状态更新失败')
    logChange(db, 'task', id, 'update', updated)
    db.exec('COMMIT')
    return updated
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function removeTask(db: DatabaseSync, id: string): void {
  const now = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(now, now, id)
    db.prepare(
      'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL'
    ).run(now, now, id)
    logChange(db, 'task', id, 'delete', { id })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function restoreTask(db: DatabaseSync, id: string): void {
  const now = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id)
    db.prepare(
      'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE parent_id = ? AND deleted_at IS NOT NULL'
    ).run(now, id)
    logChange(db, 'task', id, 'update', { id, deletedAt: null })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function purgeTask(db: DatabaseSync, id: string): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    logChange(db, 'task', id, 'delete', { id, purged: true })
    db.prepare('DELETE FROM tasks WHERE parent_id = ?').run(id)
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function reorderTasks(db: DatabaseSync, listId: string, orderedIds: string[]): void {
  const now = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    orderedIds.forEach((taskId, index) => {
      db.prepare(
        'UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND list_id = ?'
      ).run(index, now, taskId, listId)
      logChange(db, 'task', taskId, 'update', { id: taskId, sortOrder: index })
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getCounts(db: DatabaseSync): Counts {
  const today = todayKey()
  const weekEnd = addDaysToKey(today, 7)

  const count = (sql: string, ...params: Array<string | number>): number => {
    const row = db.prepare(sql).get(...params) as unknown as { c: number }
    return Number(row.c)
  }

  const inbox = count(
    `SELECT COUNT(*) AS c FROM tasks t JOIN lists l ON l.id = t.list_id
     WHERE l.is_inbox = 1 AND t.status = 'open' AND t.deleted_at IS NULL AND t.parent_id IS NULL`
  )
  const todayCount = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'open' AND deleted_at IS NULL AND parent_id IS NULL
       AND due_date IS NOT NULL AND due_date <= ?`,
    today
  )
  const next7 = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'open' AND deleted_at IS NULL AND parent_id IS NULL
       AND due_date >= ? AND due_date <= ?`,
    today,
    weekEnd
  )
  const completed = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'completed' AND deleted_at IS NULL AND parent_id IS NULL`
  )
  const abandoned = count(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE status = 'abandoned' AND deleted_at IS NULL AND parent_id IS NULL`
  )
  const trash = count(
    `SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NOT NULL AND parent_id IS NULL`
  )

  const listRows = db
    .prepare(
      `SELECT list_id, COUNT(*) AS c FROM tasks
       WHERE status = 'open' AND deleted_at IS NULL AND parent_id IS NULL
       GROUP BY list_id`
    )
    .all() as unknown as Array<{ list_id: string; c: number }>

  const lists: Record<string, number> = {}
  for (const row of listRows) lists[String(row.list_id)] = Number(row.c)

  return { inbox, today: todayCount, next7, completed, abandoned, trash, lists }
}
