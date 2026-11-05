import { useEffect, useState } from 'react'
import { Icon } from './Icon'

export function TitleBar(): React.ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="brand-mark">✓</span>
        <span className="titlebar-name">刻度清单</span>
      </div>
      <div className="titlebar-drag" />
      <div className="window-controls">
        <button
          type="button"
          className="window-btn"
          aria-label="最小化"
          title="最小化"
          onClick={() => window.api.window.minimize()}
        >
          <Icon name="minimize" size={15} />
        </button>
        <button
          type="button"
          className="window-btn"
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
          onClick={() => window.api.window.toggleMaximize()}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button
          type="button"
          className="window-btn window-btn-close"
          aria-label="关闭"
          title="关闭"
          onClick={() => window.api.window.close()}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  )
}
