// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import {
  createTask,
  getCounts,
  getTaskWithMeta,
  queryTasks,
  setTaskStatus
} from '../src/main/db/tasks'
import {
  createReminder,
  deleteReminder,
  listDueReminders,
  listReminders,
  markReminderSent
} from '../src/main/db/reminders'
import { addDaysToKey, todayKey } from '../src/shared/dates'

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
})

describe('P2 subtasks', () => {
  it('子任务不计入主视图和计数，但计入父任务进度', () => {
    const listId = getInboxId(db)
    const parent = createTask(db, {
      listId,
      title: '父任务',
      dueDate: todayKey(),
      allDay: true
    })
    const child = createTask(db, {
      listId,
      parentId: parent.id,
      title: '子任务'
    })

    expect(queryTasks(db, { view: 'subtasks', parentId: parent.id })).toHaveLength(1)
    expect(queryTasks(db, { view: 'today' })).toHaveLength(1)
    expect(queryTasks(db, { view: 'all' })).toHaveLength(1)
    expect(getCounts(db).today).toBe(1)

    expect(getTaskWithMeta(db, parent.id)?.subtaskCount).toBe(1)
    setTaskStatus(db, child.id, 'completed')
    expect(getTaskWithMeta(db, parent.id)?.subtaskDone).toBe(1)
  })
})

describe('P2 recurrence', () => {
  it('完成重复任务时生成下一次任务', () => {
    const listId = getInboxId(db)
    const task = createTask(db, {
      listId,
      title: '每日站会',
      dueDate: todayKey(),
      dueTime: '09:00',
      allDay: false,
      recurrence: 'FREQ=DAILY'
    })

    setTaskStatus(db, task.id, 'completed')

    const open = queryTasks(db, { view: 'all' })
    expect(open).toHaveLength(1)
    expect(open[0].title).toBe('每日站会')
    expect(open[0].dueDate).toBe(addDaysToKey(todayKey(), 1))
    expect(open[0].dueTime).toBe('09:00')
    expect(open[0].recurrence).toBe('FREQ=DAILY')
  })

  it('每周重复按 BYDAY 生成下一周', () => {
    const listId = getInboxId(db)
    const task = createTask(db, {
      listId,
      title: '每周复盘',
      dueDate: todayKey(),
      allDay: true,
      recurrence: 'FREQ=WEEKLY;BYDAY=TH'
    })
    setTaskStatus(db, task.id, 'completed')
    const open = queryTasks(db, { view: 'all' })
    expect(open).toHaveLength(1)
    expect(open[0].title).toBe('每周复盘')
    const nextDue = open[0].dueDate
    expect(nextDue).not.toBeNull()
    expect((nextDue as string) > todayKey()).toBe(true)
  })
})

describe('P2 reminders', () => {
  it('创建、到期查询、标记已发送、删除', () => {
    const listId = getInboxId(db)
    const task = createTask(db, { listId, title: '提醒我' })
    const future = new Date(Date.now() + 60_000).toISOString()
    const reminder = createReminder(db, task.id, future)

    expect(listReminders(db, task.id)).toHaveLength(1)
    expect(listDueReminders(db, new Date().toISOString())).toHaveLength(0)

    const dueAt = new Date(Date.now() + 120_000).toISOString()
    const due = listDueReminders(db, dueAt)
    expect(due).toHaveLength(1)
    expect(due[0].taskTitle).toBe('提醒我')

    markReminderSent(db, reminder.id, dueAt)
    expect(listDueReminders(db, dueAt)).toHaveLength(0)

    deleteReminder(db, reminder.id)
    expect(listReminders(db, task.id)).toHaveLength(0)
  })

  it('已完成任务的提醒不再触发', () => {
    const listId = getInboxId(db)
    const task = createTask(db, { listId, title: '已完成任务' })
    createReminder(db, task.id, new Date(Date.now() - 60_000).toISOString())
    setTaskStatus(db, task.id, 'completed')
    expect(listDueReminders(db, new Date().toISOString())).toHaveLength(0)
  })
})
