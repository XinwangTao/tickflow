import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getBackupDir } from './index'
import { verifyBackupFiles, verifyDatabaseFile } from './backup-integrity'

export interface BackupCheck {
  path: string | null
  ok: boolean
  message: string
}

export { verifyBackupFiles, verifyDatabaseFile }

export function verifyLatestBackup(): BackupCheck {
  let files: string[]
  try {
    files = readdirSync(getBackupDir())
      .filter((name) => name.startsWith('tickflow-') && name.endsWith('.db'))
      .sort()
  } catch {
    return { path: null, ok: false, message: '备份目录不存在或不可读' }
  }
  const latest = files.at(-1)
  if (!latest) return { path: null, ok: false, message: '还没有自动备份' }
  const path = join(getBackupDir(), latest)
  return { path, ...verifyDatabaseFile(path) }
}

export function verifyAllBackups(): BackupCheck[] {
  let paths: string[]
  try {
    paths = readdirSync(getBackupDir())
      .filter((name) => name.startsWith('tickflow-') && name.endsWith('.db'))
      .sort()
      .map((name) => join(getBackupDir(), name))
  } catch {
    return [{ path: null, ok: false, message: '备份目录不存在或不可读' }]
  }
  if (paths.length === 0) return [{ path: null, ok: false, message: '还没有自动备份' }]
  return verifyBackupFiles(paths)
}
