// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { createList, ensureInbox, getInboxId, listLists } from '../src/main/db/lists'
import {
  createTask,
  getCounts,
  getTaskWithMeta,
  queryTasks,
  removeTask,
  restoreTask,
  setTaskStatus,
  updateTask
} from '../src/main/db/tasks'
import { listTags } from '../src/main/db/tags'
import { getSettings, setSettings } from '../src/main/db/settings'
import { todayKey } from '../src/shared/dates'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('database', () => {
  it('迁移后自动创建收集箱', () => {
    const lists = listLists(db)
    expect(lists).toHaveLength(1)
    expect(lists[0].name).toBe('收集箱')
    expect(lists[0].isInbox).toBe(true)
    expect(getInboxId(db)).toBe(lists[0].id)
  })

  it('创建设置默认值', () => {
    const settings = getSettings(db)
    expect(settings.theme).toBe('dark')
    expect(settings.showCompleted).toBe(false)
    expect(setSettings(db, { theme: 'light', showCompleted: true }).theme).toBe('light')
    expect(getSettings(db).showCompleted).toBe(true)
  })

  it('创建清单并统计未完成任务', () => {
    const list = createList(db, { name: '工作', color: '#0091ff' })
    const inbox = getInboxId(db)
    createTask(db, { listId: list.id, title: '写周报' })
    createTask(db, { listId: inbox, title: '买菜' })

    const lists = listLists(db)
    const work = lists.find((item) => item.id === list.id)
    expect(work?.openCount).toBe(1)

    const counts = getCounts(db)
    expect(counts.inbox).toBe(1)
    expect(counts.lists[list.id]).toBe(1)
  })

  it('任务全字段与标签持久化', () => {
    const listId = getInboxId(db)
    const created = createTask(db, {
      listId,
      title: '交周报',
      notes: '本周进展',
      priority: 3,
      dueDate: todayKey(),
      dueTime: '15:00',
      allDay: false,
      tagNames: ['工作', '重要']
    })

    expect(created.tags.map((tag) => tag.name).sort()).toEqual(['工作', '重要'])
    const fetched = getTaskWithMeta(db, created.id)
    expect(fetched?.priority).toBe(3)
    expect(fetched?.dueTime).toBe('15:00')
    expect(fetched?.allDay).toBe(false)

    const updated = updateTask(db, created.id, { title: '交周报（终稿）', priority: 2 })
    expect(updated.title).toBe('交周报（终稿）')
    expect(updated.priority).toBe(2)

    const tags = listTags(db)
    expect(tags.find((tag) => tag.name === '工作')?.taskCount).toBe(1)
  })

  it('今天/最近7天/搜索查询', () => {
    const listId = getInboxId(db)
    createTask(db, {
      listId,
      title: '今天要做',
      dueDate: todayKey(),
      allDay: true
    })
    createTask(db, {
      listId,
      title: '三天后',
      dueDate: addDays(todayKey(), 3),
      allDay: true
    })
    createTask(db, { listId, title: '没有日期' })

    expect(queryTasks(db, { view: 'today' }).map((task) => task.title)).toEqual(['今天要做'])
    expect(queryTasks(db, { view: 'next7' })).toHaveLength(2)
    expect(queryTasks(db, { view: 'search', q: '三天' })).toHaveLength(1)
    expect(queryTasks(db, { view: 'search', q: '#工作' })).toHaveLength(0)
  })

  it('完成、删除与恢复', () => {
    const listId = getInboxId(db)
    const task = createTask(db, { listId, title: '待完成' })

    const completed = setTaskStatus(db, task.id, 'completed')
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(queryTasks(db, { view: 'today' })).toHaveLength(0)
    expect(queryTasks(db, { view: 'completed' })).toHaveLength(1)

    removeTask(db, task.id)
    expect(queryTasks(db, { view: 'trash' })).toHaveLength(1)

    restoreTask(db, task.id)
    expect(queryTasks(db, { view: 'trash' })).toHaveLength(0)
    expect(getTaskWithMeta(db, task.id)?.deletedAt).toBeNull()
  })

  it('搜索标签只匹配标签', () => {
    const listId = getInboxId(db)
    createTask(db, { listId, title: '普通任务', tagNames: ['工作'] })
    expect(queryTasks(db, { view: 'search', q: '#工作' })).toHaveLength(1)
    expect(queryTasks(db, { view: 'search', q: '#生活' })).toHaveLength(0)
  })
})

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}
