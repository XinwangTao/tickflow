import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { LIST_COLORS } from '../lib/colors'
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
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

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
