// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceDatabaseFile } from '../src/main/db/backup-restore'

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dir = ''
})

describe('backup restore', () => {
  it('替换当前库前先保存安全副本', () => {
    dir = mkdtempSync(join(tmpdir(), 'tickflow-restore-'))
    const current = join(dir, 'tickflow.db')
    const backup = join(dir, 'backup.db')
    const safety = join(dir, 'backups', 'pre-restore.db')
    writeFileSync(current, 'old database')
    writeFileSync(backup, 'restored database')

    replaceDatabaseFile(dir, backup, safety)

    expect(readFileSync(current, 'utf8')).toBe('restored database')
    expect(readFileSync(safety, 'utf8')).toBe('old database')
  })

  it('缺少当前库或备份时拒绝执行', () => {
    dir = mkdtempSync(join(tmpdir(), 'tickflow-restore-'))
    expect(() =>
      replaceDatabaseFile(dir, join(dir, 'missing.db'), join(dir, 'safety.db'))
    ).toThrow()
  })
})
