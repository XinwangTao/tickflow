import { useCallback, useEffect, useState } from 'react'
import type { ViewKey } from '@shared/types'
import { AboutDialog } from './AboutDialog'
import { Icon, type IconName } from './Icon'
import { NotificationCenter } from './NotificationCenter'
import { useAppStore } from '../store/useAppStore'

const READ_KEY = 'tickflow.notificationsReadAt'

function readTimestamp(): string {
  const stored = localStorage.getItem(READ_KEY)
  if (stored) return stored
  const now = new Date().toISOString()
  localStorage.setItem(READ_KEY, now)
  return now
}

const PRIMARY: Array<{ view: ViewKey; icon: IconName; label: string }> = [
  { view: 'today', icon: 'tasks', label: '今天' },
  { view: 'next7', icon: 'calendar-range', label: '最近 7 天' },
  { view: 'inbox', icon: 'inbox', label: '收集箱' }
]

const VIEWS: Array<{ view: ViewKey; icon: IconName; label: string }> = [
  { view: 'calendar', icon: 'calendar', label: '日历' },
  { view: 'matrix', icon: 'grid', label: '四象限' }
]

const FOCUS: Array<{ view: ViewKey; icon: IconName; label: string }> = [
  { view: 'pomodoro', icon: 'timer', label: '番茄专注' },
  { view: 'habits', icon: 'habit', label: '习惯' },
  { view: 'stats', icon: 'stats', label: '统计' }
]

export function IconRail(): React.ReactNode {
  const view = useAppStore((state) => state.view)
  const settings = useAppStore((state) => state.settings)
  const selectView = useAppStore((state) => state.selectView)
  const setSearchOpen = useAppStore((state) => state.setSearchOpen)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const setSettings = useAppStore((state) => state.setSettings)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  const refreshUnread = useCallback(async (): Promise<void> => {
    try {
      const data = await window.api.reminders.center()
      const since = readTimestamp()
      setUnread(
        data.recent.filter((item) => item.sentAt != null && item.sentAt > since).length +
          data.habitRecent.filter((item) => item.sentAt != null && item.sentAt > since).length
      )
    } catch {
      // notification badge is best-effort
    }
  }, [])

  useEffect(() => {
    void refreshUnread()
    const timer = window.setInterval(() => void refreshUnread(), 60_000)
    const onFocus = (): void => void refreshUnread()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshUnread])

  const handleRead = useCallback((): void => {
    localStorage.setItem(READ_KEY, new Date().toISOString())
    setUnread(0)
  }, [])

  const openNotifications = (): void => {
    setNotificationsOpen(true)
    void refreshUnread()
  }

  const toggleTheme = (): void => {
    const next = settings.theme === 'dark' ? 'light' : 'dark'
    void setSettings({ theme: next })
  }

  return (
    <>
      <aside className="rail" aria-label="主导航">
      <div className="rail-top">
        <button
          type="button"
          className="avatar"
          title="账户与设置"
          aria-label="账户与设置"
          onClick={() => setSettingsOpen(true)}
        >
          刻
        </button>
      </div>

      <nav className="rail-nav">
        {PRIMARY.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`rail-item ${view === item.view ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => void selectView(item.view)}
          >
            <Icon name={item.icon} size={20} />
          </button>
        ))}

        <div className="rail-divider" />

        {VIEWS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`rail-item ${view === item.view ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => void selectView(item.view)}
          >
            <Icon name={item.icon} size={20} />
          </button>
        ))}

        {FOCUS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`rail-item ${view === item.view ? 'active' : ''}`}
            title={item.label}
            aria-label={item.label}
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => void selectView(item.view)}
          >
            <Icon name={item.icon} size={20} />
          </button>
        ))}

        <button
          type="button"
          className="rail-item"
          title="搜索（Ctrl+K）"
          aria-label="搜索"
          onClick={() => setSearchOpen(true)}
        >
          <Icon name="search" size={20} />
        </button>
      </nav>

      <div className="rail-spacer" />

      <div className="rail-bottom">
        <button
          type="button"
          className="rail-item"
          title="通知"
          aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'}
          onClick={openNotifications}
        >
          <Icon name="bell" size={19} />
          {unread > 0 ? (
            <span className="rail-badge">{unread > 9 ? '9+' : unread}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="rail-item"
          title={settings.theme === 'dark' ? '切换到浅色' : '切换到深色'}
          aria-label="切换主题"
          onClick={toggleTheme}
        >
          <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} size={19} />
        </button>
        <button
          type="button"
          className="rail-item"
          title="设置"
          aria-label="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={19} />
        </button>
        <button
          type="button"
          className="rail-item"
          title="关于"
          aria-label="关于"
          onClick={() => setAboutOpen(true)}
        >
          <Icon name="help" size={19} />
        </button>
      </div>
    </aside>

    {notificationsOpen ? (
      <NotificationCenter
        onClose={() => setNotificationsOpen(false)}
        onRead={handleRead}
      />
    ) : null}

    {aboutOpen ? <AboutDialog onClose={() => setAboutOpen(false)} /> : null}
    </>
  )
}
