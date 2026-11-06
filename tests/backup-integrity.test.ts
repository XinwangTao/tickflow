// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/main/db/migrations'
import { verifyBackupFiles, verifyDatabaseFile } from '../src/main/db/backup-integrity'

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dir = ''
})

describe('backup integrity', () => {
  it('校验正常的 SQLite 备份', () => {
    dir = mkdtempSync(join(tmpdir(), 'tickflow-backup-'))
    const path = join(dir, 'backup.db')
    const db = new DatabaseSync(path)
    migrate(db)
    db.close()
    expect(verifyDatabaseFile(path)).toEqual({ ok: true, message: 'ok' })
  })

  it('批量校验只标记损坏文件', () => {
    dir = mkdtempSync(join(tmpdir(), 'tickflow-backup-'))
    const good = join(dir, 'good.db')
    const db = new DatabaseSync(good)
    migrate(db)
    db.close()
    const broken = join(dir, 'broken.db')
    writeFileSync(broken, 'not a sqlite database')
    const results = verifyBackupFiles([good, broken])
    expect(results.map((item) => item.ok)).toEqual([true, false])
  })

  it('拒绝损坏文件与不存在的路径', () => {
    dir = mkdtempSync(join(tmpdir(), 'tickflow-backup-'))
    const broken = join(dir, 'broken.db')
    writeFileSync(broken, 'not a sqlite database')
    expect(verifyDatabaseFile(broken).ok).toBe(false)
    expect(verifyDatabaseFile(join(dir, 'missing.db')).ok).toBe(false)
  })
})
