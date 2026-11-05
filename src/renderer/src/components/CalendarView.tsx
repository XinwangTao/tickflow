import { Fragment, useMemo, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { todayKey, toDateKey } from '@shared/dates'
import { monthDays, monthLabel, shiftDateKey, weekDays, weekLabel, weekdayLabels } from '../lib/calendar'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface CalendarViewProps {
  tasks: TaskWithMeta[]
  month: string
  weekStart: 0 | 1
  onShiftMonth: (delta: number) => void
  onSetMonth: (month: string) => void
}

export function CalendarView({
  tasks,
  month,
  weekStart,
  onShiftMonth,
  onSetMonth
}: CalendarViewProps): React.ReactNode {
  const updateTask = useAppStore((state) => state.updateTask)
  const openDetail = useAppStore((state) => state.openDetail)

  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [weekAnchor, setWeekAnchor] = useState(todayKey())
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, TaskWithMeta[]>()
    for (const task of tasks) {
      if (!task.dueDate) continue
      const bucket = map.get(task.dueDate) ?? []
      bucket.push(task)
      map.set(task.dueDate, bucket)
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
        return (a.dueTime ?? '').localeCompare(b.dueTime ?? '')
      })
    }
    return map
  }, [tasks])

  const days = mode === 'month' ? monthDays(month, weekStart) : weekDays(weekAnchor, weekStart)
  const labels = weekdayLabels(weekStart)
  const today = todayKey()

  const shift = (delta: number): void => {
    if (mode === 'month') onShiftMonth(delta)
    else setWeekAnchor((anchor) => shiftDateKey(anchor, delta * 7))
  }

  const goToday = (): void => {
    setWeekAnchor(today)
    onSetMonth(today.slice(0, 7))
  }

  const handleDrop = (key: string, event: React.DragEvent): void => {
    event.preventDefault()
    setDropTarget(null)
    const taskId = event.dataTransfer.getData('text/plain')
    if (!taskId) return
    void updateTask(taskId, { dueDate: key })
  }

  const renderChip = (task: TaskWithMeta): React.ReactNode => (
    <button
      type="button"
      className="calendar-chip"
      style={{ borderLeftColor: task.listColor }}
      draggable
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(event) => {
        event.stopPropagation()
        openDetail(task.id)
      }}
      title={`${task.title} · ${task.listName}`}
    >
      {task.allDay ? null : <span className="calendar-chip-time">{task.dueTime}</span>}
      <span className="calendar-chip-title">{task.title}</span>
    </button>
  )

  const title = mode === 'month' ? monthLabel(month) : weekLabel(weekAnchor, weekStart)

  return (
    <section className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-title">{title}</div>
        <div className="calendar-actions">
          <button type="button" className="icon-btn" aria-label="上一页" onClick={() => shift(-1)}>
            <Icon name="chevron-left" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="下一页" onClick={() => shift(1)}>
            <Icon name="chevron-right" size={16} />
          </button>
          <button type="button" className="btn" onClick={goToday}>
            今天
          </button>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'month' ? 'selected' : ''}
              onClick={() => setMode('month')}
            >
              月
            </button>
            <button
              type="button"
              className={mode === 'week' ? 'selected' : ''}
              onClick={() => setMode('week')}
            >
              周
            </button>
          </div>
        </div>
      </div>

      {mode === 'month' ? (
        <>
          <div className="calendar-weekdays">
            {labels.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const key = toDateKey(day)
              const list = byDay.get(key) ?? []
              const inMonth = key.startsWith(month)
              return (
                <div
                  key={key}
                  className={`calendar-cell ${inMonth ? '' : 'outside'} ${
                    key === today ? 'today' : ''
                  } ${dropTarget === key ? 'drop' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropTarget(key)
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => handleDrop(key, event)}
                >
                  <div className="calendar-day">
                    <span>{day.getDate()}</span>
                  </div>
                  <div className="calendar-tasks">
                    {list.slice(0, 3).map((task) => (
                      <Fragment key={task.id}>{renderChip(task)}</Fragment>
                    ))}
                    {list.length > 3 ? (
                      <span className="calendar-more">+{list.length - 3}</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="calendar-week">
          {days.map((day, index) => {
            const key = toDateKey(day)
            const list = byDay.get(key) ?? []
            return (
              <div
                key={key}
                className={`calendar-week-col ${key === today ? 'today' : ''} ${
                  dropTarget === key ? 'drop' : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropTarget(key)
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => handleDrop(key, event)}
              >
                <div className="calendar-week-head">
                  <span>{labels[index]}</span>
                  <strong>{day.getDate()}</strong>
                </div>
                <div className="calendar-week-body">
                  {list.length === 0 ? (
                    <span className="calendar-week-empty">—</span>
                  ) : (
                    list.map((task) => <Fragment key={task.id}>{renderChip(task)}</Fragment>)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
