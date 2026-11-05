// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, purgeTask } from '../src/main/db/tasks'
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments
} from '../src/main/db/attachments'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('attachments', () => {
  it('保存、查询、删除附件记录', () => {
    const task = createTask(db, { listId: getInboxId(db), title: '带附件任务' })
    const attachment = createAttachment(db, {
      taskId: task.id,
      name: '报告.pdf',
      storedName: 'stored-1.pdf',
      size: 1234,
      mime: 'application/pdf'
    })

    expect(listAttachments(db, task.id)).toHaveLength(1)
    expect(getAttachment(db, attachment.id)?.name).toBe('报告.pdf')
    expect(getAttachment(db, attachment.id)?.size).toBe(1234)

    const removed = deleteAttachment(db, attachment.id)
    expect(removed?.storedName).toBe('stored-1.pdf')
    expect(listAttachments(db, task.id)).toHaveLength(0)
  })

  it('永久删除任务时级联清理附件记录', () => {
    const task = createTask(db, { listId: getInboxId(db), title: '级联任务' })
    createAttachment(db, {
      taskId: task.id,
      name: 'a.txt',
      storedName: 'stored-2.txt',
      size: 2,
      mime: 'text/plain'
    })
    purgeTask(db, task.id)
    expect(listAttachments(db, task.id)).toHaveLength(0)
  })
})
