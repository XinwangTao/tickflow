import { DatabaseSync } from 'node:sqlite'

export function verifyDatabaseFile(path: string): { ok: boolean; message: string } {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const row = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined
    const value = row?.integrity_check ?? ''
    return { ok: value === 'ok', message: value || '无返回结果' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    try {
      db?.close()
    } catch {
      // 打不开的文件无需关闭
    }
  }
}

export function verifyBackupFiles(
  paths: string[]
): Array<{ path: string; ok: boolean; message: string }> {
  return paths.map((path) => ({ path, ...verifyDatabaseFile(path) }))
}
