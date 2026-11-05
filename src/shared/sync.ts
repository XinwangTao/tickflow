import { AwsClient } from 'aws4fetch'
import type { Priority, TaskStatus, TodoList } from './types'

export const DEFAULT_R2_PREFIX = 'tickflow/snapshots/'

export interface SyncTask {
  id: string
  listId: string
  parentId: string | null
  title: string
  notes: string
  status: TaskStatus
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  allDay: boolean
  startDate: string | null
  recurrence: string | null
  pinned: boolean
  sortOrder: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  tagNames: string[]
}

export interface SyncSnapshot {
  version: 1
  deviceId: string
  updatedAt: string
  lists: TodoList[]
  tasks: SyncTask[]
}

export interface R2Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix?: string
}

function mergeById<T extends { id: string; updatedAt: string }>(
  local: T[],
  remote: T[]
): T[] {
  const map = new Map(local.map((item) => [item.id, item]))
  for (const item of remote) {
    const existing = map.get(item.id)
    if (!existing || item.updatedAt > existing.updatedAt) {
      map.set(item.id, item)
    }
  }
  return Array.from(map.values())
}

/** 按实体 updated_at 做 last-write-wins；删除用 tombstone（deletedAt）参与比较。 */
export function mergeSnapshots(
  local: SyncSnapshot,
  remotes: SyncSnapshot[]
): SyncSnapshot {
  let lists = local.lists
  let tasks = local.tasks
  for (const remote of remotes) {
    if (!remote || remote.version !== 1) continue
    lists = mergeById(lists, Array.isArray(remote.lists) ? remote.lists : [])
    tasks = mergeById(tasks, Array.isArray(remote.tasks) ? remote.tasks : [])
  }
  return {
    version: 1,
    deviceId: local.deviceId,
    updatedAt: new Date().toISOString(),
    lists,
    tasks
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

async function errorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

export class R2Client {
  private client: AwsClient
  private base: string
  readonly prefix: string

  constructor(config: R2Config) {
    const endpoint = config.endpoint?.trim() ?? ''
    const bucket = config.bucket?.trim() ?? ''
    const accessKeyId = config.accessKeyId?.trim() ?? ''
    const secretAccessKey = config.secretAccessKey?.trim() ?? ''
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 配置不完整：需要 Endpoint、Bucket、Access Key ID 和 Secret')
    }
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto'
    })
    this.base = `${endpoint.replace(/\/+$/, '')}/${bucket}`
    const prefix = (config.prefix?.trim() || DEFAULT_R2_PREFIX).replace(/^\/+/, '')
    this.prefix = prefix.endsWith('/') ? prefix : `${prefix}/`
  }

  keyFor(deviceId: string): string {
    return `${this.prefix}${deviceId}.json`
  }

  async listKeys(): Promise<string[]> {
    const url = `${this.base}?list-type=2&prefix=${encodeURIComponent(this.prefix)}`
    const response = await this.client.fetch(url, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`R2 列表失败：${response.status} ${await errorText(response)}`)
    }
    const xml = await response.text()
    const keys: string[] = []
    for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      const key = decodeXml(match[1])
      if (key.endsWith('.json')) keys.push(key)
    }
    return keys
  }

  async getJson<T>(key: string): Promise<T | null> {
    const response = await this.client.fetch(`${this.base}/${encodeKey(key)}`, {
      method: 'GET'
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`R2 下载失败：${response.status} ${await errorText(response)}`)
    }
    return (await response.json()) as T
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const response = await this.client.fetch(`${this.base}/${encodeKey(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    })
    if (!response.ok) {
      throw new Error(`R2 上传失败：${response.status} ${await errorText(response)}`)
    }
  }

  async test(): Promise<void> {
    await this.listKeys()
  }
}

export async function syncWithR2(
  local: SyncSnapshot,
  config: R2Config
): Promise<{ snapshot: SyncSnapshot; downloaded: number }> {
  const client = new R2Client(config)
  const keys = await client.listKeys()
  const remotes: SyncSnapshot[] = []
  for (const key of keys) {
    const remote = await client.getJson<SyncSnapshot>(key)
    if (remote && remote.version === 1) remotes.push(remote)
  }
  const snapshot = mergeSnapshots(local, remotes)
  await client.putJson(client.keyFor(local.deviceId), snapshot)
  return { snapshot, downloaded: remotes.length }
}
