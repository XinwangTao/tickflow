// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import {
  MAX_SNAPSHOT_BYTES,
  R2Client,
  assertSnapshotSize,
  syncWithR2,
  type SyncSnapshot,
  type SyncTask
} from '../src/shared/sync'
import { migrate } from '../src/main/db/migrations'
import { ensureInbox, getInboxId } from '../src/main/db/lists'
import { createTask, queryTasks, removeTask, updateTask } from '../src/main/db/tasks'
import { setSettings } from '../src/main/db/settings'
import { syncNow } from '../src/main/sync'

const BUCKET = 'test-bucket'
const objects = new Map<string, string>()
let server: Server
let endpoint = ''

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const contents = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => {
          const body = objects.get(key) ?? ''
          return `<Contents><Key>${escapeXml(key)}</Key><Size>${Buffer.byteLength(body)}</Size></Contents>`
        })
        .join('')
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${contents}</ListBucketResult>`
      )
      return
    }

    const key = decodeURIComponent(url.pathname).split('/').slice(2).join('/')
    if (request.method === 'GET') {
      const body = objects.get(key)
      if (body == null) {
        response.writeHead(404)
        response.end()
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(body)
      }
      return
    }
    if (request.method === 'PUT') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        objects.set(key, body)
        response.writeHead(200)
        response.end()
      })
      return
    }
    response.writeHead(405)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  endpoint = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function task(id: string, title: string, updatedAt: string): SyncTask {
  return {
    id,
    listId: 'inbox',
    parentId: null,
    title,
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
    updatedAt,
    deletedAt: null,
    tagNames: []
  }
}

function snapshot(deviceId: string, tasks: SyncTask[]): SyncSnapshot {
  return {
    version: 1,
    deviceId,
    updatedAt: new Date().toISOString(),
    lists: [
      {
        id: 'inbox',
        name: '收集箱',
        color: '#f5c542',
        emoji: null,
        sortOrder: 0,
        isInbox: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        deletedAt: null
      }
    ],
    tasks
  }
}

const config = () => ({
  endpoint,
  bucket: BUCKET,
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  prefix: 'tickflow/snapshots/'
})

describe('R2 sync against a local S3-compatible mock', () => {
  it('两台设备通过快照合并，后者覆盖较早的同 ID 记录', async () => {
    const deviceA = snapshot('device-a', [
      task('t1', 'A 的标题', '2026-11-06T01:00:00.000Z')
    ])
    const deviceB = snapshot('device-b', [
      task('t1', 'B 的新标题', '2026-11-06T02:00:00.000Z'),
      task('t2', '只有 B 有', '2026-11-06T02:00:00.000Z')
    ])

    const first = await syncWithR2(deviceA, config())
    expect(first.downloaded).toBe(0)

    const second = await syncWithR2(deviceB, config())
    expect(second.downloaded).toBe(1)
    expect(second.snapshot.tasks.map((item) => item.id).sort()).toEqual(['t1', 't2'])

    const third = await syncWithR2(deviceA, config())
    expect(third.downloaded).toBe(2)
    const merged = new Map(third.snapshot.tasks.map((item) => [item.id, item]))
    expect(merged.get('t1')?.title).toBe('B 的新标题')
    expect(merged.get('t2')?.title).toBe('只有 B 有')

    expect([...objects.keys()].sort()).toEqual([
      'tickflow/snapshots/device-a.json',
      'tickflow/snapshots/device-b.json'
    ])
  })

  it('tombstone 不复活，且空列表可同步', async () => {
    const deviceC = snapshot('device-c', [
      task('t1', '标题', '2026-11-06T03:00:00.000Z')
    ])
    deviceC.tasks[0]!.deletedAt = '2026-11-06T03:00:00.000Z'
    deviceC.tasks[0]!.status = 'completed'

    const result = await syncWithR2(deviceC, config())
    const merged = new Map(result.snapshot.tasks.map((item) => [item.id, item]))
    expect(merged.get('t1')?.deletedAt).toBe('2026-11-06T03:00:00.000Z')
  })
})

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureInbox(db)
  return db
}

function configureSync(db: DatabaseSync, prefix: string): void {
  setSettings(db, {
    r2Endpoint: endpoint,
    r2Bucket: BUCKET,
    r2AccessKeyId: 'test-key',
    r2SecretAccessKey: 'test-secret',
    r2Prefix: prefix,
    r2AutoSync: false
  })
}

describe('desktop syncNow against local S3 mock', () => {
  it('两台桌面数据库双向合并、LWW、标签与 tombstone', async () => {
    const prefix = `tickflow/it-${Date.now()}/`
    const a = makeDb()
    const b = makeDb()
    configureSync(a, prefix)
    configureSync(b, prefix)

    const taskA = createTask(a, {
      listId: getInboxId(a),
      title: 'A 任务',
      tagNames: ['工作']
    })
    expect((await syncNow(a)).ok).toBe(true)
    expect((await syncNow(b)).ok).toBe(true)

    const taskB = createTask(b, {
      listId: getInboxId(b),
      title: 'B 任务',
      tagNames: ['生活']
    })
    expect((await syncNow(b)).ok).toBe(true)
    expect((await syncNow(a)).ok).toBe(true)

    const aInbox = queryTasks(a, { view: 'inbox' })
    const bInbox = queryTasks(b, { view: 'inbox' })
    expect(aInbox.find((item) => item.id === taskA.id)?.title).toBe('A 任务')
    expect(aInbox.find((item) => item.id === taskA.id)?.tags.map((tag) => tag.name)).toContain('工作')
    expect(bInbox.find((item) => item.id === taskA.id)?.title).toBe('A 任务')
    expect(bInbox.find((item) => item.id === taskB.id)?.title).toBe('B 任务')
    expect(aInbox.find((item) => item.id === taskB.id)?.title).toBe('B 任务')
    expect(aInbox.find((item) => item.id === taskB.id)?.tags.map((tag) => tag.name)).toContain('生活')

    // LWW：A 的较新标题覆盖 B 的旧标题。
    updateTask(a, taskA.id, { title: 'A 任务（新）' })
    a.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(
      '2026-11-06T10:00:00.000Z',
      taskA.id
    )
    b.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(
      '2026-11-06T09:00:00.000Z',
      taskA.id
    )
    expect((await syncNow(a)).ok).toBe(true)
    expect((await syncNow(b)).ok).toBe(true)
    expect(queryTasks(b, { view: 'inbox' }).find((item) => item.id === taskA.id)?.title).toBe(
      'A 任务（新）'
    )

    // tombstone：B 删除后 A 同步，不复活。
    removeTask(b, taskA.id)
    b.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(
      '2026-11-06T11:00:00.000Z',
      taskA.id
    )
    expect((await syncNow(b)).ok).toBe(true)
    expect((await syncNow(a)).ok).toBe(true)
    expect(queryTasks(a, { view: 'inbox' }).some((item) => item.id === taskA.id)).toBe(false)
    const deleted = a.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(taskA.id) as
      | { deleted_at: string | null }
      | undefined
    expect(deleted?.deleted_at).toBeTruthy()
  })
})


describe('snapshot size guard', () => {
  it('小快照返回字节数，超过 5 MiB 直接拒绝', () => {
    expect(assertSnapshotSize('{"a":1}')).toBe(7)
    const tooBig = 'x'.repeat(MAX_SNAPSHOT_BYTES + 1)
    expect(() => assertSnapshotSize(tooBig)).toThrow('超过 5 MiB 上限')
  })
})


describe('R2 usage listing', () => {
  it('返回对象数量与字节数', async () => {
    const client = new R2Client(config())
    const objectsList = await client.listObjects()
    expect(objectsList.length).toBeGreaterThanOrEqual(3)
    expect(objectsList.every((item) => item.size > 0)).toBe(true)
    const total = objectsList.reduce((sum, item) => sum + item.size, 0)
    expect(total).toBeGreaterThan(0)
  })
})
