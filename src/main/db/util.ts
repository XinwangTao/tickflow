import type { DatabaseSync } from 'node:sqlite'
import { uuidv7 } from '@shared/uuid'

export function nowIso(): string {
  return new Date().toISOString()
}

export function getDeviceId(db: DatabaseSync): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('device_id') as
    | { value: string }
    | undefined
  if (row?.value) return row.value

  const id = uuidv7()
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING').run(
    'device_id',
    id
  )
  const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('device_id') as {
    value: string
  }
  return stored.value
}

export function asBool(value: unknown): boolean {
  return Number(value) === 1
}

export function asString(value: unknown): string {
  return value == null ? '' : String(value)
}
