import { useEffect, useRef, useState } from 'react'
import type { GroupBy, SortBy } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

const SORTS: Array<{ value: SortBy; label: string }> = [
  { value: 'default', label: '默认顺序' },
  { value: 'due', label: '截止日期' },
  { value: 'priority', label: '优先级' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '标题' }
]

const GROUPS: Array<{ value: GroupBy; label: string }> = [
  { value: 'none', label: '不分组' },
  { value: 'list', label: '按清单' },
  { value: 'priority', label: '按优先级' },
  { value: 'date', label: '按日期' }
]

export function ViewOptionsMenu(): React.ReactNode {
  const sortBy = useAppStore((state) => state.sortBy)
  const groupBy = useAppStore((state) => state.groupBy)
  const setSortBy = useAppStore((state) => state.setSortBy)
  const setGroupBy = useAppStore((state) => state.setGroupBy)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="view-options" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn ${sortBy !== 'default' || groupBy !== 'none' ? 'active' : ''}`}
        title="排序与分组"
        aria-label="排序与分组"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" size={17} />
      </button>
      {open ? (
        <div className="view-options-menu" role="menu">
          <div className="view-options-section">
            <span>排序</span>
            {SORTS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={sortBy === option.value ? 'selected' : ''}
                onClick={() => {
                  setSortBy(option.value)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                {sortBy === option.value ? <Icon name="check" size={13} /> : null}
              </button>
            ))}
          </div>
          <div className="view-options-section">
            <span>分组</span>
            {GROUPS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={groupBy === option.value ? 'selected' : ''}
                onClick={() => {
                  setGroupBy(option.value)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                {groupBy === option.value ? <Icon name="check" size={13} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
