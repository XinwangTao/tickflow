import type { DatabaseSync } from 'node:sqlite'
import type { Settings } from '@shared/types'
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS
} from '@shared/ai'

const DEFAULTS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: null,
  showCompleted: false,
  fontScale: 1,
  r2Endpoint: '',
  r2Bucket: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2Prefix: 'tickflow/snapshots/',
  r2AutoSync: false,
  r2LastSync: null,
  aiEnabled: true,
  aiBaseUrl: AI_DEFAULT_BASE_URL,
  aiModel: AI_DEFAULT_MODEL,
  aiToken: '',
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS
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
    fontScale: Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1,
    r2Endpoint: map.get('r2Endpoint') || '',
    r2Bucket: map.get('r2Bucket') || '',
    r2AccessKeyId: map.get('r2AccessKeyId') || '',
    r2SecretAccessKey: map.get('r2SecretAccessKey') || '',
    r2Prefix: map.get('r2Prefix') || DEFAULTS.r2Prefix,
    r2AutoSync: map.get('r2AutoSync') === '1',
    r2LastSync: map.get('r2LastSync') || null,
    aiEnabled: map.get('aiEnabled') !== '0',
    aiBaseUrl: map.get('aiBaseUrl') || DEFAULTS.aiBaseUrl,
    aiModel: map.get('aiModel') || DEFAULTS.aiModel,
    aiToken: map.get('aiToken') || '',
    aiTimeoutMs: Number(map.get('aiTimeoutMs') ?? DEFAULTS.aiTimeoutMs) || DEFAULTS.aiTimeoutMs
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
