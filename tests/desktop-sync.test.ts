// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, queryTasks } from '../src/main/db/tasks'
import { applySnapshot, buildSnapshot } from '../src/main/sync'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
  return db
}

function makeTask(db: DatabaseSync): void {
  const listId = getInboxId(db)
  createTask(db, {
    listId,
    title: '同步任务',
    notes: '备注',
    priority: 2,
    dueDate: '2026-11-05',
    allDay: true,
    tagNames: ['工作', '重要']
  })
}

describe('desktop sync snapshot', () => {
  let source: DatabaseSync
  let target: DatabaseSync

  beforeEach(() => {
    source = makeDb()
    target = makeDb()
    makeTask(source)
  })

  it('快照包含固定收集箱与任务标签', () => {
    const snapshot = buildSnapshot(source)
    expect(snapshot.version).toBe(1)
    expect(snapshot.lists).toHaveLength(1)
    expect(snapshot.lists[0].isInbox).toBe(true)
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0].tagNames.sort()).toEqual(['工作', '重要'].sort())
    expect(snapshot.deviceId).toBeTruthy()
  })

  it('应用到另一台设备后可查询到任务与标签', () => {
    const snapshot = buildSnapshot(source)
    const counts = applySnapshot(target, snapshot)
    expect(counts.tasks).toBe(1)
    const tasks = queryTasks(target, { view: 'inbox' })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('同步任务')
    expect(tasks[0].priority).toBe(2)
    expect(tasks[0].tags.map((tag) => tag.name).sort()).toEqual(['工作', '重要'].sort())
    expect(tasks[0].listId).toBe(getInboxId(target))
  })

  it('重复应用同一快照保持幂等', () => {
    const snapshot = buildSnapshot(source)
    applySnapshot(target, snapshot)
    applySnapshot(target, snapshot)
    expect(queryTasks(target, { view: 'inbox' })).toHaveLength(1)
  })
})
