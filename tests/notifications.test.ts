// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask } from '../src/main/db/tasks'
import {
  createReminder,
  listReminderCenter,
  markReminderSent
} from '../src/main/db/reminders'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('notification center', () => {
  it('区分待提醒与已提醒，并带上任务标题', () => {
    const now = new Date()
    const task = createTask(db, { listId: getInboxId(db), title: '交周报' })
    createReminder(db, task.id, new Date(now.getTime() + 3_600_000).toISOString())
    const sent = createReminder(
      db,
      task.id,
      new Date(now.getTime() - 3_600_000).toISOString()
    )
    markReminderSent(db, sent.id, now.toISOString())

    const center = listReminderCenter(db, now.toISOString())

    expect(center.upcoming).toHaveLength(1)
    expect(center.upcoming[0]?.taskTitle).toBe('交周报')
    expect(center.recent).toHaveLength(1)
    expect(center.recent[0]?.sentAt).toBe(now.toISOString())
  })

  it('忽略已删除任务的通知', () => {
    const now = new Date()
    const task = createTask(db, { listId: getInboxId(db), title: '临时任务' })
    createReminder(db, task.id, new Date(now.getTime() + 3_600_000).toISOString())
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(now.toISOString(), task.id)

    const center = listReminderCenter(db, now.toISOString())
    expect(center.upcoming).toHaveLength(0)
  })
})
