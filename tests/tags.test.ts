// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, getTaskWithMeta } from '../src/main/db/tasks'
import { deleteTag, listTags, renameTag } from '../src/main/db/tags'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

function tagId(name: string): string {
  const tag = listTags(db).find((item) => item.name === name)
  if (!tag) throw new Error(`missing tag ${name}`)
  return tag.id
}

describe('tags', () => {
  it('重命名标签并保留任务关联', () => {
    const task = createTask(db, {
      listId: getInboxId(db),
      title: '写周报',
      tagNames: ['工作']
    })

    renameTag(db, tagId('工作'), ' 职场 ')

    expect(listTags(db).map((tag) => tag.name)).toEqual(['职场'])
    expect(getTaskWithMeta(db, task.id)?.tags.map((tag) => tag.name)).toEqual(['职场'])
  })

  it('删除标签会从任务上移除且不删除任务', () => {
    const task = createTask(db, {
      listId: getInboxId(db),
      title: '整理桌面',
      tagNames: ['家务']
    })

    deleteTag(db, tagId('家务'))

    expect(listTags(db)).toHaveLength(0)
    expect(getTaskWithMeta(db, task.id)?.tags.map((tag) => tag.name)).toEqual([])
    expect(getTaskWithMeta(db, task.id)?.title).toBe('整理桌面')
  })

  it('重命名为已有标签时合并关联', () => {
    const first = createTask(db, {
      listId: getInboxId(db),
      title: '任务一',
      tagNames: ['工作']
    })
    const second = createTask(db, {
      listId: getInboxId(db),
      title: '任务二',
      tagNames: ['重要']
    })

    renameTag(db, tagId('工作'), '重要')

    const tags = listTags(db)
    expect(tags).toHaveLength(1)
    expect(tags[0]?.name).toBe('重要')
    expect(tags[0]?.taskCount).toBe(2)
    expect(getTaskWithMeta(db, first.id)?.tags.map((tag) => tag.name)).toEqual(['重要'])
    expect(getTaskWithMeta(db, second.id)?.tags.map((tag) => tag.name)).toEqual(['重要'])
  })

  it('拒绝空名称', () => {
    createTask(db, { listId: getInboxId(db), title: '任务', tagNames: ['工作'] })
    expect(() => renameTag(db, tagId('工作'), '   ')).toThrow('标签名称不能为空')
  })
})
