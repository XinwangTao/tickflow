import type { ListMode } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Icon, type IconName } from './Icon'

const MODES: Array<{ value: ListMode; label: string; icon: IconName }> = [
  { value: 'list', label: '列表', icon: 'list' },
  { value: 'board', label: '看板', icon: 'board' },
  { value: 'timeline', label: '时间线', icon: 'calendar-range' }
]

export function ViewSwitcher(): React.ReactNode {
  const listMode = useAppStore((state) => state.listMode)
  const setListMode = useAppStore((state) => state.setListMode)

  return (
    <div className="segmented view-switcher" role="group" aria-label="视图切换">
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={listMode === mode.value ? 'selected' : ''}
          onClick={() => setListMode(mode.value)}
          title={mode.label}
        >
          <Icon name={mode.icon} size={13} />
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  )
}
