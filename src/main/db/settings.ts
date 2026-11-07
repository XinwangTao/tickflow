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
  autoLaunch: false,
  startMinimized: false,
  fontScale: 1,
  r2Endpoint: '',
  r2Bucket: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2Prefix: 'tickflow/snapshots/',
  r2AutoSync: false,
  r2LastSync: null,
  r2LastError: '',
  aiEnabled: true,
  aiBaseUrl: AI_DEFAULT_BASE_URL,
  aiModel: AI_DEFAULT_MODEL,
  asrPython: '',
  asrModel: '',
  aiToken: '',
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS
}

export const SECRET_PREFIX = 'enc:v1:'
const SECRET_KEYS = new Set(['r2AccessKeyId', 'r2SecretAccessKey', 'aiToken'])

export interface SecretCodec {
  seal(value: string): string
  open(value: string): string
}

let secretCodec: SecretCodec | null = null

/** 主进程启动时注入 safeStorage 实现；测试/无 keyring 环境保持明文。 */
export function setSecretCodec(codec: SecretCodec | null): void {
  secretCodec = codec
}

export function isSealedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX)
}

function sealSecret(key: string, value: string): string {
  if (!secretCodec || !SECRET_KEYS.has(key) || !value) return value
  return secretCodec.seal(value)
}

function openSecret(value: string): string {
  if (!secretCodec || !isSealedSecret(value)) return value
  try {
    return secretCodec.open(value)
  } catch {
    return ''
  }
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
    autoLaunch: map.get('autoLaunch') === '1',
    startMinimized: map.get('startMinimized') === '1',
    fontScale: Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1,
    r2Endpoint: map.get('r2Endpoint') || '',
    r2Bucket: map.get('r2Bucket') || '',
    r2AccessKeyId: openSecret(map.get('r2AccessKeyId') || ''),
    r2SecretAccessKey: openSecret(map.get('r2SecretAccessKey') || ''),
    r2Prefix: map.get('r2Prefix') || DEFAULTS.r2Prefix,
    r2AutoSync: map.get('r2AutoSync') === '1',
    r2LastSync: map.get('r2LastSync') || null,
    r2LastError: map.get('r2LastError') || '',
    aiEnabled: map.get('aiEnabled') !== '0',
    aiBaseUrl: map.get('aiBaseUrl') || DEFAULTS.aiBaseUrl,
    aiModel: map.get('aiModel') || DEFAULTS.aiModel,
    asrPython: map.get('asrPython') || '',
    asrModel: map.get('asrModel') || '',
    aiToken: openSecret(map.get('aiToken') || ''),
    aiTimeoutMs: Number(map.get('aiTimeoutMs') ?? DEFAULTS.aiTimeoutMs) || DEFAULTS.aiTimeoutMs
  }
}

export function setSettings(db: DatabaseSync, patch: Partial<Settings>): Settings {
  const allowed = new Set(Object.keys(DEFAULTS))
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || value === undefined) continue
    const raw =
      typeof value === 'boolean' ? (value ? '1' : '0') : value === null ? '' : String(value)
    const stored = sealSecret(key, raw)
    db.prepare(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, stored)
  }
  return getSettings(db)
}

const EXPORT_EXCLUDED_KEYS = ['r2SecretAccessKey', 'r2AccessKeyId', 'aiToken'] as const

/** 导出用设置行：剔除 R2/AI 凭据，避免 JSON 备份泄露密钥。 */
export function listExportableSettings(
  db: DatabaseSync
): Array<{ key: string; value: string }> {
  const placeholders = EXPORT_EXCLUDED_KEYS.map(() => '?').join(', ')
  return db
    .prepare(`SELECT key, value FROM settings WHERE key NOT IN (${placeholders})`)
    .all(...EXPORT_EXCLUDED_KEYS) as unknown as Array<{ key: string; value: string }>
}
