import { app } from 'electron'
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations'
import { ensureInbox } from './lists'

let db: DatabaseSync | null = null
let dataDir = ''

function backupDatabase(instance: DatabaseSync): void {
  try {
    const backupDir = join(app.getPath('userData'), 'backups')
    mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(backupDir, `tickflow-${stamp}.db`)
    instance.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

    const backups = readdirSync(backupDir)
      .filter((name) => name.startsWith('tickflow-') && name.endsWith('.db'))
      .sort()
    while (backups.length > 5) {
      const oldest = backups.shift()
      if (oldest) unlinkSync(join(backupDir, oldest))
    }
  } catch (error) {
    console.error('[tickflow] 自动备份失败：', error)
  }
}

export function initDatabase(): DatabaseSync {
  dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })

  const instance = new DatabaseSync(join(dataDir, 'tickflow.db'))
  instance.exec('PRAGMA journal_mode = WAL;')
  instance.exec('PRAGMA foreign_keys = ON;')
  instance.exec('PRAGMA busy_timeout = 5000;')

  migrate(instance)
  ensureInbox(instance)
  backupDatabase(instance)

  db = instance
  return instance
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function getDataDir(): string {
  return dataDir
}

export function closeDatabase(): void {
  if (!db) return
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    db.close()
  } catch (error) {
    console.error('[tickflow] 关闭数据库失败：', error)
  }
  db = null
}
