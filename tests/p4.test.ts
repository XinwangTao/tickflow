// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { createList, ensureInbox, getInboxId } from '../src/main/db/lists'
import {
  createTask,
  queryTasks,
  setTaskStatus
} from '../src/main/db/tasks'
import {
  applyTemplate,
  createTemplateFromTask,
  deleteTemplate,
  listTemplates
} from '../src/main/db/templates'
import {
  createFilter,
  deleteFilter,
  listFilters
} from '../src/main/db/filters'
import { addDaysToKey, todayKey } from '../src/shared/dates'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('P4 templates', () => {
  it('从任务保存模板并应用', () => {
    const listId = getInboxId(db)
    const task = createTask(db, {
      listId,
      title: '周报',
      notes: '汇总本周进展',
      priority: 2,
      dueDate: todayKey(),
      allDay: true,
      tagNames: ['工作']
    })

    const template = createTemplateFromTask(db, task.id, '每周周报')
    expect(listTemplates(db)).toHaveLength(1)
    expect(template.payload.title).toBe('周报')
    expect(template.payload.tagNames).toEqual(['工作'])

    const applied = applyTemplate(db, template.id)
    expect(applied.title).toBe('周报')
    expect(applied.notes).toBe('汇总本周进展')
    expect(applied.priority).toBe(2)
    expect(applied.listId).toBe(listId)
    expect(applied.dueDate).toBe(todayKey())
    expect(applied.tags.map((tag) => tag.name)).toEqual(['工作'])
    expect(queryTasks(db, { view: 'all' })).toHaveLength(2)

    deleteTemplate(db, template.id)
    expect(listTemplates(db)).toHaveLength(0)
  })

  it('应用模板时可覆盖清单', () => {
    const listId = getInboxId(db)
    const work = createList(db, { name: '工作', color: '#0091ff' })
    const task = createTask(db, { listId, title: '晨会准备' })
    const template = createTemplateFromTask(db, task.id, '晨会')
    const applied = applyTemplate(db, template.id, { listId: work.id })
    expect(applied.listId).toBe(work.id)
  })
})

describe('P4 custom filters', () => {
  it('按状态、优先级、清单、标签和日期过滤', () => {
    const listId = getInboxId(db)
    const work = createList(db, { name: '工作', color: '#0091ff' })

    createTask(db, {
      listId,
      title: '今天高优先级',
      priority: 3,
      dueDate: todayKey(),
      allDay: true,
      tagNames: ['重要']
    })
    createTask(db, {
      listId: work.id,
      title: '逾期工作',
      priority: 1,
      dueDate: addDaysToKey(todayKey(), -1),
      allDay: true
    })
    createTask(db, {
      listId: work.id,
      title: '无日期工作',
      priority: 2,
      tagNames: ['工作']
    })
    const completed = createTask(db, {
      listId,
      title: '已完成',
      dueDate: todayKey(),
      allDay: true
    })
    setTaskStatus(db, completed.id, 'completed')

    const todayHigh = createFilter(db, {
      name: '今天高优先级',
      query: { listId: null, status: 'open', priority: 3, tag: null, due: 'today' }
    })
    expect(queryTasks(db, { view: 'filter', filter: todayHigh.query })).toHaveLength(1)

    const workFilter = createFilter(db, {
      name: '工作清单',
      query: { listId: work.id, status: 'open', priority: null, tag: null, due: 'any' }
    })
    expect(queryTasks(db, { view: 'filter', filter: workFilter.query })).toHaveLength(2)

    const tagFilter = createFilter(db, {
      name: '重要标签',
      query: { listId: null, status: 'open', priority: null, tag: '重要', due: 'any' }
    })
    expect(queryTasks(db, { view: 'filter', filter: tagFilter.query })).toHaveLength(1)

    const overdueFilter = createFilter(db, {
      name: '逾期',
      query: { listId: null, status: 'open', priority: null, tag: null, due: 'overdue' }
    })
    expect(queryTasks(db, { view: 'filter', filter: overdueFilter.query })).toHaveLength(1)

    const noDateFilter = createFilter(db, {
      name: '无日期',
      query: { listId: null, status: 'open', priority: null, tag: null, due: 'no_date' }
    })
    expect(queryTasks(db, { view: 'filter', filter: noDateFilter.query })).toHaveLength(1)

    const completedFilter = createFilter(db, {
      name: '已完成',
      query: { listId: null, status: 'completed', priority: null, tag: null, due: 'any' }
    })
    expect(queryTasks(db, { view: 'filter', filter: completedFilter.query })).toHaveLength(1)

    expect(listFilters(db)).toHaveLength(6)
    deleteFilter(db, workFilter.id)
    expect(listFilters(db)).toHaveLength(5)
  })
})
