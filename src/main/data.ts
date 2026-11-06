import { app, BrowserWindow, dialog, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ImportCounts } from '@shared/types'
import { backupNow, closeDatabase, getBackupDir, getDataDir } from './db'
import { getInboxId } from './db/lists'
import { verifyLatestBackup } from './db/backup-verify'
import { replaceDatabaseFile } from './db/backup-restore'
import { listExportableSettings } from './db/settings'
import { getDeviceId, nowIso } from './db/util'
import { logChange } from './db/change-log'

type Row = Record<string, unknown>

function allRows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as unknown as Row[]
}

function str(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export async function openDataDir(): Promise<string> {
  const dir = getDataDir()
  const error = await shell.openPath(dir)
  if (error) throw new Error(`无法打开数据目录：${error}`)
  return dir
}

export async function openBackupDir(): Promise<string> {
  const dir = getBackupDir()
  const error = await shell.openPath(dir)
  if (error) throw new Error(`无法打开备份目录：${error}`)
  return dir
}

export async function restoreLatestBackup(
  parent: BrowserWindow | null
): Promise<{ canceled: boolean; path?: string }> {
  const check = verifyLatestBackup()
  if (!check.path || !check.ok) {
    throw new Error(`无法恢复：${check.message}`)
  }
  const options = {
    type: 'warning' as const,
    buttons: ['恢复并重启', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '恢复最近备份',
    message: '当前数据库将被备份替换，应用会立即重启。',
    detail: `备份文件：${check.path}
当前库会先保存为安全副本（pre-restore-*.db）。`
  }
  const confirm = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (confirm.response !== 0) return { canceled: true }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safety = join(getBackupDir(), `pre-restore-${stamp}.db`)
  closeDatabase()
  replaceDatabaseFile(getDataDir(), check.path, safety)
  app.relaunch()
  app.exit(0)
  return { canceled: false, path: check.path }
}

export function createManualBackup(): string {
  return backupNow()
}

export async function exportData(
  db: DatabaseSync,
  format: 'json' | 'csv' | 'ics',
  parent: BrowserWindow | null
): Promise<{ canceled: boolean; path?: string }> {
  const date = new Date().toISOString().slice(0, 10)
  const options = {
    title: '导出数据',
    defaultPath: join(app.getPath('documents'), `tickflow-${date}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }

  if (format === 'json') {
    const payload = {
      app: 'tickflow',
      version: 1,
      exportedAt: nowIso(),
      lists: allRows(db, 'SELECT * FROM lists'),
      tasks: allRows(db, 'SELECT * FROM tasks'),
      tags: allRows(db, 'SELECT * FROM tags'),
      task_tags: allRows(db, 'SELECT * FROM task_tags'),
      habits: allRows(db, 'SELECT * FROM habits'),
      habit_logs: allRows(db, 'SELECT * FROM habit_logs'),
      pomodoro_sessions: allRows(db, 'SELECT * FROM pomodoro_sessions'),
      settings: listExportableSettings(db)
    }
    writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  } else if (format === 'csv') {
    const tasks = allRows(
      db,
      `SELECT t.*, l.name AS list_name FROM tasks t
       JOIN lists l ON l.id = t.list_id
       WHERE t.deleted_at IS NULL
       ORDER BY t.created_at ASC`
    )
    const headers = [
      'id',
      'title',
      'list',
      'status',
      'priority',
      'due_date',
      'due_time',
      'notes',
      'created_at',
      'completed_at'
    ]
    const lines = [headers.join(',')]
    for (const task of tasks) {
      lines.push(
        [
          task.id,
          task.title,
          task.list_name,
          task.status,
          task.priority,
          task.due_date,
          task.due_time,
          task.notes,
          task.created_at,
          task.completed_at
        ]
          .map(csvCell)
          .join(',')
      )
    }
    writeFileSync(result.filePath, `﻿${lines.join('\r\n')}\r\n`, 'utf8')
  } else {
    const tasks = allRows(
      db,
      `SELECT * FROM tasks
       WHERE deleted_at IS NULL AND parent_id IS NULL AND due_date IS NOT NULL
       ORDER BY due_date ASC, due_time ASC`
    )
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TickFlow//TickFlow Calendar//CN',
      'CALSCALE:GREGORIAN'
    ]
    for (const task of tasks) {
      const dueDate = str(task.due_date).replace(/-/g, '')
      const dueTime = task.due_time == null ? '' : str(task.due_time).replace(':', '')
      const allDay = num(task.all_day, 1) === 1 || !dueTime
      const uid = `${str(task.id)}@tickflow`
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${uid}`)
      lines.push(`DTSTAMP:${stamp()}Z`)
      lines.push(
        allDay
          ? `DTSTART;VALUE=DATE:${dueDate}`
          : `DTSTART:${dueDate}T${dueTime}00`
      )
      lines.push(`SUMMARY:${icsEscape(str(task.title))}`)
      if (str(task.notes)) lines.push(`DESCRIPTION:${icsEscape(str(task.notes))}`)
      lines.push(`STATUS:${str(task.status) === 'completed' ? 'COMPLETED' : 'CONFIRMED'}`)
      lines.push('END:VEVENT')
    }
    lines.push('END:VCALENDAR')
    writeFileSync(result.filePath, `${lines.join('\r\n')}\r\n`, 'utf8')
  }

  return { canceled: false, path: result.filePath }
}

export async function importJson(
  db: DatabaseSync,
  parent: BrowserWindow | null
): Promise<{ canceled: boolean; counts?: ImportCounts }> {
  const options = {
    title: '导入 JSON 数据',
    properties: ['openFile' as const],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(readFileSync(result.filePaths[0], 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`无法读取 JSON：${error instanceof Error ? error.message : String(error)}`)
  }

  const lists = Array.isArray(payload.lists) ? (payload.lists as Row[]) : []
  const tasks = Array.isArray(payload.tasks) ? (payload.tasks as Row[]) : []
  const tags = Array.isArray(payload.tags) ? (payload.tags as Row[]) : []
  const taskTags = Array.isArray(payload.task_tags) ? (payload.task_tags as Row[]) : []
  const habits = Array.isArray(payload.habits) ? (payload.habits as Row[]) : []
  const habitLogs = Array.isArray(payload.habit_logs) ? (payload.habit_logs as Row[]) : []
  const sessions = Array.isArray(payload.pomodoro_sessions)
    ? (payload.pomodoro_sessions as Row[])
    : []

  const confirm = parent
    ? await dialog.showMessageBox(parent, {
        type: 'question',
        buttons: ['导入', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '导入数据',
        message: `准备导入 ${lists.length} 个清单、${tasks.length} 个任务、${habits.length} 个习惯。`,
        detail: '按 ID 合并，已存在的记录会跳过；不会删除现有数据。'
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons: ['导入', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '导入数据',
        message: `准备导入 ${lists.length} 个清单、${tasks.length} 个任务、${habits.length} 个习惯。`,
        detail: '按 ID 合并，已存在的记录会跳过；不会删除现有数据。'
      })
  if (confirm.response !== 0) return { canceled: true }

  const counts: ImportCounts = { lists: 0, tasks: 0, tags: 0, habits: 0, logs: 0, sessions: 0 }
  const now = nowIso()

  db.exec('BEGIN IMMEDIATE')
  try {
    const inboxId = getInboxId(db)
    const listIds = new Set(allRows(db, 'SELECT id FROM lists').map((row) => str(row.id)))
    const taskIds = new Set(allRows(db, 'SELECT id FROM tasks').map((row) => str(row.id)))
    const tagIds = new Set(allRows(db, 'SELECT id FROM tags').map((row) => str(row.id)))
    const habitIds = new Set(allRows(db, 'SELECT id FROM habits').map((row) => str(row.id)))

    for (const list of lists) {
      const id = str(list.id)
      if (!id || listIds.has(id)) continue
      if (num(list.is_inbox) === 1) continue
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO lists(id, name, color, emoji, sort_order, is_inbox, created_at, updated_at, deleted_at, device_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          str(list.name, '未命名清单'),
          str(list.color, '#f5c542'),
          list.emoji == null ? null : str(list.emoji),
          num(list.sort_order),
          0,
          str(list.created_at, now),
          str(list.updated_at, now),
          list.deleted_at == null ? null : str(list.deleted_at),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) {
        counts.lists += 1
        listIds.add(id)
      }
    }

    for (const tag of tags) {
      const id = str(tag.id)
      if (!id || tagIds.has(id)) continue
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO tags(id, name, color, created_at, updated_at, deleted_at, device_id)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          str(tag.name, '标签'),
          tag.color == null ? null : str(tag.color),
          str(tag.created_at, now),
          str(tag.updated_at, now),
          tag.deleted_at == null ? null : str(tag.deleted_at),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) {
        counts.tags += 1
        tagIds.add(id)
      }
    }

    for (const task of tasks) {
      const id = str(task.id)
      if (!id || taskIds.has(id)) continue
      let listId = str(task.list_id)
      if (!listIds.has(listId)) listId = inboxId
      const parentId = str(task.parent_id)
      const status = str(task.status)
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO tasks(
            id, list_id, parent_id, title, notes, status, priority,
            due_date, due_time, all_day, start_date, recurrence, pinned, sort_order,
            completed_at, created_at, updated_at, deleted_at, device_id
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          listId,
          parentId && taskIds.has(parentId) ? parentId : null,
          str(task.title, '未命名任务'),
          str(task.notes),
          status === 'completed' || status === 'abandoned' ? status : 'open',
          Math.min(3, Math.max(0, num(task.priority))),
          task.due_date == null ? null : str(task.due_date),
          task.due_time == null ? null : str(task.due_time),
          num(task.all_day, 1) ? 1 : 0,
          task.start_date == null ? null : str(task.start_date),
          task.recurrence == null ? null : str(task.recurrence),
          num(task.pinned) ? 1 : 0,
          num(task.sort_order),
          task.completed_at == null ? null : str(task.completed_at),
          str(task.created_at, now),
          str(task.updated_at, now),
          task.deleted_at == null ? null : str(task.deleted_at),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) {
        counts.tasks += 1
        taskIds.add(id)
      }
    }

    for (const task of tasks) {
      const id = str(task.id)
      const parentId = str(task.parent_id)
      if (id && parentId && taskIds.has(parentId)) {
        db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(
          parentId,
          id
        )
      }
    }

    for (const link of taskTags) {
      const taskId = str(link.task_id)
      const tagId = str(link.tag_id)
      if (!taskIds.has(taskId) || !tagIds.has(tagId)) continue
      db.prepare('INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES(?, ?)').run(
        taskId,
        tagId
      )
    }

    for (const habit of habits) {
      const id = str(habit.id)
      if (!id || habitIds.has(id)) continue
      const frequency = str(habit.frequency) === 'weekly' ? 'weekly' : 'daily'
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO habits(
            id, name, icon, color, frequency, target_per_week, archived, sort_order,
            created_at, updated_at, deleted_at, device_id
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          str(habit.name, '未命名习惯'),
          habit.icon == null ? null : str(habit.icon),
          str(habit.color, '#30a46c'),
          frequency,
          num(habit.target_per_week, 7),
          num(habit.archived) ? 1 : 0,
          num(habit.sort_order),
          str(habit.created_at, now),
          str(habit.updated_at, now),
          habit.deleted_at == null ? null : str(habit.deleted_at),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) {
        counts.habits += 1
        habitIds.add(id)
      }
    }

    for (const log of habitLogs) {
      const id = str(log.id)
      const habitId = str(log.habit_id)
      const logDate = str(log.log_date)
      if (!id || !habitIds.has(habitId) || !/^\d{4}-\d{2}-\d{2}$/.test(logDate)) continue
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO habit_logs(id, habit_id, log_date, value, note, created_at, updated_at, device_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          habitId,
          logDate,
          num(log.value, 1),
          str(log.note),
          str(log.created_at, now),
          str(log.updated_at, now),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) counts.logs += 1
    }

    for (const session of sessions) {
      const id = str(session.id)
      if (!id) continue
      const taskId = str(session.task_id)
      const mode = str(session.mode) === 'break' ? 'break' : 'focus'
      const changes = db
        .prepare(
          `INSERT OR IGNORE INTO pomodoro_sessions(
            id, task_id, mode, duration_minutes, started_at, ended_at, completed, created_at, device_id
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          taskId && taskIds.has(taskId) ? taskId : null,
          mode,
          num(session.duration_minutes, 25),
          str(session.started_at, now),
          str(session.ended_at, now),
          num(session.completed, 1) ? 1 : 0,
          str(session.created_at, now),
          getDeviceId(db)
        )
      if (Number(changes.changes) > 0) counts.sessions += 1
    }

    logChange(db, 'import', 'batch', 'create', counts)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { canceled: false, counts }
}
