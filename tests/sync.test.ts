import { describe, expect, it } from 'vitest'
import { R2Client, mergeSnapshots } from '../src/shared/sync'
import type { SyncSnapshot, SyncTask } from '../src/shared/sync'
import type { TodoList } from '../src/shared/types'

const list: TodoList = {
  id: 'list-1',
  name: '清单',
  color: '#f5c542',
  emoji: null,
  sortOrder: 0,
  isInbox: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null
}

function task(overrides: Partial<SyncTask>): SyncTask {
  return {
    id: 'task-1',
    listId: 'list-1',
    parentId: null,
    title: '任务',
    notes: '',
    status: 'open',
    priority: 0,
    dueDate: null,
    dueTime: null,
    allDay: true,
    startDate: null,
    recurrence: null,
    pinned: false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    deletedAt: null,
    tagNames: [],
    ...overrides
  }
}

function snapshot(deviceId: string, tasks: SyncTask[]): SyncSnapshot {
  return {
    version: 1,
    deviceId,
    updatedAt: '2026-11-05T10:00:00.000Z',
    lists: [list],
    tasks
  }
}

describe('sync merge', () => {
  it('按 updated_at 做 last-write-wins', () => {
    const local = snapshot('pc', [task({ title: '本地较新' })])
    const remote = snapshot('phone', [
      task({ title: '远端较旧', updatedAt: '2026-11-05T09:00:00.000Z' })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks[0].title).toBe('本地较新')
    expect(merged.deviceId).toBe('pc')
  })

  it('远端更新的任务覆盖本地', () => {
    const local = snapshot('pc', [task({ title: '旧标题' })])
    const remote = snapshot('phone', [
      task({ title: '新标题', updatedAt: '2026-11-05T11:00:00.000Z' })
    ])
    expect(mergeSnapshots(local, [remote]).tasks[0].title).toBe('新标题')
  })

  it('删除 tombstone 参与比较', () => {
    const local = snapshot('pc', [task({ title: '任务' })])
    const remote = snapshot('phone', [
      task({
        title: '任务',
        deletedAt: '2026-11-05T12:00:00.000Z',
        updatedAt: '2026-11-05T12:00:00.000Z'
      })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks[0].deletedAt).toBe('2026-11-05T12:00:00.000Z')
  })

  it('远端新增任务会合并进来', () => {
    const local = snapshot('pc', [])
    const remote = snapshot('phone', [
      task({ id: 'task-2', title: '手机任务', updatedAt: '2026-11-05T11:00:00.000Z' })
    ])
    const merged = mergeSnapshots(local, [remote])
    expect(merged.tasks.map((item) => item.id)).toContain('task-2')
  })
})

describe('R2 client', () => {
  it('配置不完整时抛出明确错误', () => {
    expect(
      () =>
        new R2Client({
          endpoint: '',
          bucket: '',
          accessKeyId: '',
          secretAccessKey: ''
        })
    ).toThrow('R2 配置不完整')
  })

  it('生成快照 key', () => {
    const client = new R2Client({
      endpoint: 'https://example.r2.cloudflarestorage.com/',
      bucket: 'tickflow',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      prefix: 'tickflow/snapshots'
    })
    expect(client.keyFor('device-1')).toBe('tickflow/snapshots/device-1.json')
  })
})
