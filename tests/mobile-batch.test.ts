import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: typeof import('../mobile/src/db').db
let ensureSeed: typeof import('../mobile/src/db').ensureSeed
let createTask: typeof import('../mobile/src/db').createTask
let setTasksStatus: typeof import('../mobile/src/db').setTasksStatus
let removeTasks: typeof import('../mobile/src/db').removeTasks

beforeAll(async () => {
  // @ts-expect-error fake-indexeddb 的 exports 未暴露 auto 的声明文件
  await import('fake-indexeddb/auto')
  const dbModule = await import('../mobile/src/db')
  db = dbModule.db
  ensureSeed = dbModule.ensureSeed
  createTask = dbModule.createTask
  setTasksStatus = dbModule.setTasksStatus
  removeTasks = dbModule.removeTasks
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeed()
})

describe('mobile batch actions', () => {
  it('批量完成写入 completedAt，改回未完成会清空', async () => {
    const first = await createTask({ title: '批量 A' })
    const second = await createTask({ title: '批量 B' })

    expect(await setTasksStatus([first.id, second.id], 'completed')).toBe(2)
    const completed = await db.tasks.bulkGet([first.id, second.id])
    expect(
      completed.every((task) => task?.status === 'completed' && Boolean(task.completedAt))
    ).toBe(true)

    expect(await setTasksStatus([first.id], 'open')).toBe(1)
    expect((await db.tasks.get(first.id))?.completedAt).toBeNull()
    expect((await db.tasks.get(second.id))?.status).toBe('completed')
  })

  it('批量删除软删选中任务及其子任务，不影响未选中任务', async () => {
    const parent = await createTask({ title: '父任务' })
    const child = await createTask({ title: '子任务', parentId: parent.id })
    const other = await createTask({ title: '其他任务' })

    expect(await removeTasks([parent.id])).toBe(1)
    expect((await db.tasks.get(parent.id))?.deletedAt).toBeTruthy()
    expect((await db.tasks.get(child.id))?.deletedAt).toBeTruthy()
    expect((await db.tasks.get(other.id))?.deletedAt).toBeNull()
  })

  it('空选择不写库', async () => {
    const task = await createTask({ title: '保持不变' })
    expect(await setTasksStatus([], 'completed')).toBe(0)
    expect(await removeTasks([])).toBe(0)
    expect((await db.tasks.get(task.id))?.status).toBe('open')
    expect((await db.tasks.get(task.id))?.deletedAt).toBeNull()
  })
})
