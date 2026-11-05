import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { R2_CORS_POLICY } from '@shared/r2-cors'
import { LIST_COLORS } from '../lib/colors'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'

const THEMES: Array<{ value: 'dark' | 'light' | 'system'; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' }
]

const FONT_SCALES: Array<{ value: number; label: string }> = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.1, label: '大' }
]

export function SettingsDialog(): React.ReactNode {
  const settings = useAppStore((state) => state.settings)
  const lists = useAppStore((state) => state.lists)
  const setSettings = useAppStore((state) => state.setSettings)
  const close = useAppStore((state) => state.setSettingsOpen)
  const showToast = useAppStore((state) => state.showToast)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [r2, setR2] = useState({
    endpoint: settings.r2Endpoint,
    bucket: settings.r2Bucket,
    accessKeyId: settings.r2AccessKeyId,
    secretAccessKey: settings.r2SecretAccessKey,
    prefix: settings.r2Prefix,
    autoSync: settings.r2AutoSync
  })

  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  const saveSync = async (): Promise<void> => {
    await setSettings({
      r2Endpoint: r2.endpoint.trim(),
      r2Bucket: r2.bucket.trim(),
      r2AccessKeyId: r2.accessKeyId.trim(),
      r2SecretAccessKey: r2.secretAccessKey.trim(),
      r2Prefix: r2.prefix.trim() || 'tickflow/snapshots/',
      r2AutoSync: r2.autoSync
    })
  }

  const testConnection = async (): Promise<void> => {
    await saveSync()
    const result = await window.api.sync.test()
    showToast(result.message, result.ok ? 'success' : 'error', { duration: 5000 })
  }

  const runSync = async (): Promise<void> => {
    await saveSync()
    const result = await window.api.sync.now()
    showToast(result.message, result.ok ? 'success' : 'error', { duration: 6000 })
    if (result.ok) await setSettings({})
  }

  const copyCors = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(R2_CORS_POLICY)
      showToast('CORS 配置已复制', 'success')
    } catch {
      showToast('复制失败，请手动查看文档 docs/sync-r2.md', 'error')
    }
  }

  const handleExport = async (format: 'json' | 'csv' | 'ics'): Promise<void> => {
    try {
      const result = await window.api.data.export(format)
      if (!result.canceled) {
        showToast(`已导出到 ${result.path ?? ''}`, 'success', { duration: 5000 })
      }
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const result = await window.api.data.importJson()
      if (!result.canceled && result.counts) {
        showToast(
          `导入完成：${result.counts.tasks} 个任务、${result.counts.habits} 个习惯`,
          'success',
          { duration: 5000 }
        )
      }
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <Modal title="设置" onClose={() => close(false)} width={560}>
      <section className="settings-section">
        <h3>外观</h3>
        <div className="settings-row">
          <span className="settings-label">主题</span>
          <div className="segmented">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                className={settings.theme === theme.value ? 'selected' : ''}
                onClick={() => void setSettings({ theme: theme.value })}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">强调色</span>
          <div className="color-swatches">
            {LIST_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${settings.accent === color ? 'selected' : ''}`}
                style={{ background: color }}
                aria-label={`强调色 ${color}`}
                onClick={() => void setSettings({ accent: color })}
              />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">字号</span>
          <div className="segmented">
            {FONT_SCALES.map((scale) => (
              <button
                key={scale.value}
                type="button"
                className={settings.fontScale === scale.value ? 'selected' : ''}
                onClick={() => void setSettings({ fontScale: scale.value })}
              >
                {scale.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>行为</h3>
        <div className="settings-row">
          <span className="settings-label">显示已完成任务</span>
          <button
            type="button"
            className={`switch ${settings.showCompleted ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.showCompleted}
            onClick={() => void setSettings({ showCompleted: !settings.showCompleted })}
          >
            <span />
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-label">每周起始日</span>
          <div className="segmented">
            <button
              type="button"
              className={settings.weekStart === 1 ? 'selected' : ''}
              onClick={() => void setSettings({ weekStart: 1 })}
            >
              周一
            </button>
            <button
              type="button"
              className={settings.weekStart === 0 ? 'selected' : ''}
              onClick={() => void setSettings({ weekStart: 0 })}
            >
              周日
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">默认清单</span>
          <select
            className="input settings-select"
            value={settings.defaultListId ?? ''}
            onChange={(event) =>
              void setSettings({ defaultListId: event.target.value || null })
            }
          >
            <option value="">跟随当前视图</option>
            {lists.map((list) => (
              <option value={list.id} key={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>数据</h3>
        <div className="settings-row settings-row-vertical">
          <span className="settings-label">数据目录</span>
          <code className="settings-path">{info?.dataDir ?? '加载中…'}</code>
        </div>
        <p className="settings-note">
          每次启动自动备份，保留最近 5 份。当前版本 {info?.version ?? '—'}。
        </p>
        <div className="settings-row">
          <span className="settings-label">导出</span>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => void handleExport('json')}>
              JSON
            </button>
            <button type="button" className="btn" onClick={() => void handleExport('csv')}>
              CSV
            </button>
            <button type="button" className="btn" onClick={() => void handleExport('ics')}>
              ICS
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">导入</span>
          <button type="button" className="btn" onClick={() => void handleImport()}>
            导入 JSON
          </button>
        </div>
        <p className="settings-note">导入按 ID 合并，已存在的记录会跳过，不会删除现有数据。</p>
      </section>

      <section className="settings-section">
        <h3>同步（Cloudflare R2）</h3>
        <div className="sync-grid">
          <label className="field sync-grid-wide">
            <span className="field-label">Endpoint</span>
            <input
              className="input"
              value={r2.endpoint}
              placeholder="https://<account>.r2.cloudflarestorage.com"
              onChange={(event) => setR2({ ...r2, endpoint: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Bucket</span>
            <input
              className="input"
              value={r2.bucket}
              placeholder="tickflow"
              onChange={(event) => setR2({ ...r2, bucket: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">前缀</span>
            <input
              className="input"
              value={r2.prefix}
              placeholder="tickflow/snapshots/"
              onChange={(event) => setR2({ ...r2, prefix: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Access Key ID</span>
            <input
              className="input"
              value={r2.accessKeyId}
              onChange={(event) => setR2({ ...r2, accessKeyId: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Secret Access Key</span>
            <input
              className="input"
              type="password"
              value={r2.secretAccessKey}
              onChange={(event) =>
                setR2({ ...r2, secretAccessKey: event.target.value })
              }
            />
          </label>
        </div>
        <div className="settings-row">
          <span className="settings-label">启动时自动同步</span>
          <button
            type="button"
            className={`switch ${r2.autoSync ? 'on' : ''}`}
            role="switch"
            aria-checked={r2.autoSync}
            onClick={() => setR2({ ...r2, autoSync: !r2.autoSync })}
          >
            <span />
          </button>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => void saveSync()}>
            保存配置
          </button>
          <button type="button" className="btn" onClick={() => void testConnection()}>
            测试连接
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void runSync()}>
            立即同步
          </button>
        </div>
        <p className="settings-note">
          上次同步：
          {settings.r2LastSync ? formatDateTime(settings.r2LastSync) : '从未'}。
          R2 密钥保存在本机数据库，建议使用仅限该桶的 API Token。
        </p>
        <p className="settings-note">
          Android 端需要给 R2 桶配置 CORS（允许 https://localhost）。
          <button type="button" className="btn sync-copy" onClick={() => void copyCors()}>
            复制 CORS 配置
          </button>
        </p>
      </section>

      <section className="settings-section">
        <h3>快捷键</h3>
        <div className="shortcut-list">
          <div>
            <span>快速添加</span>
            <kbd>Ctrl</kbd>
            <kbd>N</kbd>
          </div>
          <div>
            <span>搜索</span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </div>
          <div>
            <span>全局快速添加</span>
            <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>N</kbd>
          </div>
          <div>
            <span>关闭面板</span>
            <kbd>Esc</kbd>
          </div>
        </div>
      </section>

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => close(false)}>
          完成
        </button>
      </div>
    </Modal>
  )
}
