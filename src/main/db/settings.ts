import type { DatabaseSync } from 'node:sqlite'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: null,
  showCompleted: false,
  fontScale: 1
}

export function getSettings(db: DatabaseSync): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{
    key: string
    value: string
  }>
  const map = new Map(rows.map((row) => [String(row.key), String(row.value)]))

  const theme = map.get('theme')
  const weekStart = map.get('weekStart')
  const fontScale = Number(map.get('fontScale') ?? DEFAULTS.fontScale)

  return {
    theme: theme === 'light' || theme === 'system' ? theme : 'dark',
    accent: map.get('accent') || DEFAULTS.accent,
    weekStart: weekStart === '0' ? 0 : 1,
    defaultListId: map.get('defaultListId') || null,
    showCompleted: map.get('showCompleted') === '1',
    fontScale: Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1
  }
}

export function setSettings(db: DatabaseSync, patch: Partial<Settings>): Settings {
  const allowed = new Set(Object.keys(DEFAULTS))
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || value === undefined) continue
    const stored =
      typeof value === 'boolean' ? (value ? '1' : '0') : value === null ? '' : String(value)
    db.prepare(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, stored)
  }
  return getSettings(db)
}
