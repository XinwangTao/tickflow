import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from './store/useAppStore'
import { TitleBar } from './components/TitleBar'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { MainView } from './components/MainView'
import { DetailDrawer } from './components/DetailDrawer'
import { SearchOverlay } from './components/SearchOverlay'
import { SettingsDialog } from './components/SettingsDialog'
import { NewListDialog } from './components/NewListDialog'
import { Toast } from './components/Toast'

function Splash(): React.ReactNode {
  return (
    <div className="splash">
      <div className="brand-mark brand-mark-lg">✓</div>
      <div className="splash-text">正在加载刻度清单…</div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }): React.ReactNode {
  return (
    <div className="splash">
      <div className="brand-mark brand-mark-lg error">!</div>
      <div className="splash-text">启动失败</div>
      <div className="splash-error">{message}</div>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        重试
      </button>
    </div>
  )
}

export default function App(): React.ReactNode {
  const ready = useAppStore((state) => state.ready)
  const bootError = useAppStore((state) => state.bootError)
  const settings = useAppStore((state) => state.settings)
  const detailId = useAppStore((state) => state.detailId)
  const searchOpen = useAppStore((state) => state.searchOpen)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const newListOpen = useAppStore((state) => state.newListOpen)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const showToast = useAppStore((state) => state.showToast)

  const booted = useRef(false)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    return window.api.reminders.onMissed((items) => {
      if (items.length === 0) return
      const titles = items
        .slice(0, 3)
        .map((item) => item.taskTitle)
        .join('、')
      const suffix = items.length > 3 ? ' 等' : ''
      showToast(`有 ${items.length} 条错过的提醒：${titles}${suffix}`, 'info', {
        duration: 6000
      })
    })
  }, [showToast])

  useEffect(() => {
    return window.api.app.onQuickAdd(() => {
      void useAppStore.getState().selectView('today').then(() => {
        useAppStore.getState().focusQuickAdd()
      })
    })
  }, [])

  const resolvedTheme =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent)
    document.documentElement.style.setProperty('--font-scale', String(settings.fontScale))
  }, [settings.accent, settings.fontScale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useAppStore.getState()
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        state.focusQuickAdd()
      } else if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        state.setSearchOpen(true)
      } else if (event.key === 'Escape') {
        if (state.searchOpen) state.setSearchOpen(false)
        else if (state.settingsOpen) state.setSettingsOpen(false)
        else if (state.newListOpen) state.setNewListOpen(false)
        else if (state.detailId) state.openDetail(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) return <Splash />
  if (bootError) return <ErrorScreen message={bootError} />

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <IconRail />
        <Sidebar />
        <MainView />
      </div>

      <AnimatePresence>
        {detailId ? <DetailDrawer key="detail" /> : null}
      </AnimatePresence>
      {searchOpen ? <SearchOverlay /> : null}
      {settingsOpen ? <SettingsDialog /> : null}
      {newListOpen ? <NewListDialog /> : null}
      <Toast />
    </div>
  )
}
