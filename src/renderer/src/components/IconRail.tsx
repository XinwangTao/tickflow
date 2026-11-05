import { Icon, type IconName } from './Icon'
import { useAppStore } from '../store/useAppStore'

const PRIMARY: Array<{ view: 'today' | 'next7' | 'inbox'; icon: IconName; label: string }> = [
  { view: 'today', icon: 'tasks', label: '今天' },
  { view: 'next7', icon: 'calendar-range', label: '最近 7 天' },
  { view: 'inbox', icon: 'inbox', label: '收集箱' }
]

const SECONDARY: Array<{ icon: IconName; label: string; hint: string }> = [
  { icon: 'calendar', label: '日历', hint: '日历视图将在 P2 开放' },
  { icon: 'grid', label: '四象限', hint: '四象限视图将在 P2 开放' },
  { icon: 'timer', label: '番茄专注', hint: '番茄专注将在 P3 开放' },
  { icon: 'habit', label: '习惯', hint: '习惯打卡将在 P3 开放' }
]

export function IconRail(): React.ReactNode {
  const view = useAppStore((state) => state.view)
  const settings = useAppStore((state) => state.settings)
  const selectView = useAppStore((state) => state.selectView)
  const setSearchOpen = useAppStore((state) => state.setSearchOpen)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const setSettings = useAppStore((state) => state.setSettings)
  const showToast = useAppStore((state) => state.showToast)

  const toggleTheme = (): void => {
    const next = settings.theme === 'dark' ? 'light' : 'dark'
    void setSettings({ theme: next })
  }

  return (
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

        {SECONDARY.map((item) => (
          <button
            key={item.label}
            type="button"
            className="rail-item"
            title={item.hint}
            aria-label={item.label}
            onClick={() => showToast(item.hint, 'info')}
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
          onClick={() => showToast('刻度清单 TickFlow · P1', 'info')}
        >
          <Icon name="help" size={19} />
        </button>
      </div>
    </aside>
  )
}
