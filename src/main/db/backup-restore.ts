import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function replaceDatabaseFile(
  dataDir: string,
  backupPath: string,
  safetyPath: string
): void {
  const current = join(dataDir, 'tickflow.db')
  if (!existsSync(current)) throw new Error('当前数据库不存在')
  if (!existsSync(backupPath)) throw new Error('备份文件不存在')

  mkdirSync(dirname(safetyPath), { recursive: true })
  copyFileSync(current, safetyPath)
  copyFileSync(backupPath, current)
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${current}${suffix}`, { force: true })
  }
}
