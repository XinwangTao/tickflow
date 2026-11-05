import type { SyncResult } from '@shared/types'
import type { R2Config } from '@shared/sync'
import { R2Client, syncWithR2 } from '@shared/sync'
import {
  applySnapshot,
  buildSnapshot,
  getSettingsMap,
  setSetting
} from './db'

export async function getSyncConfig(): Promise<R2Config> {
  const settings = await getSettingsMap()
  return {
    endpoint: settings.r2Endpoint ?? '',
    bucket: settings.r2Bucket ?? '',
    accessKeyId: settings.r2AccessKeyId ?? '',
    secretAccessKey: settings.r2SecretAccessKey ?? '',
    prefix: settings.r2Prefix || 'tickflow/snapshots/'
  }
}

export function isSyncConfigured(config: R2Config): boolean {
  return Boolean(
    config.endpoint?.trim() &&
      config.bucket?.trim() &&
      config.accessKeyId?.trim() &&
      config.secretAccessKey?.trim()
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function testSync(): Promise<SyncResult> {
  const config = await getSyncConfig()
  if (!isSyncConfigured(config)) {
    return { ok: false, message: '请先填写完整的 R2 配置' }
  }
  try {
    await new R2Client(config).test()
    return { ok: true, message: 'R2 连接成功' }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function syncNow(): Promise<SyncResult> {
  const config = await getSyncConfig()
  if (!isSyncConfigured(config)) {
    return { ok: false, message: '请先填写完整的 R2 配置' }
  }
  try {
    const local = await buildSnapshot()
    const { snapshot, downloaded } = await syncWithR2(local, config)
    await applySnapshot(snapshot)
    await setSetting('r2LastSync', new Date().toISOString())
    return {
      ok: true,
      message: `同步完成：${snapshot.tasks.length} 个任务、${snapshot.lists.length} 个清单（下载 ${downloaded} 份快照）`,
      downloaded,
      updatedAt: snapshot.updatedAt
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function autoSync(): Promise<SyncResult | null> {
  const settings = await getSettingsMap()
  if (settings.r2AutoSync !== '1') return null
  return syncNow()
}
