import { Fragment, useMemo, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { fromDateKey, todayKey, toDateKey } from '@shared/dates'
import {
  monthDays,
  monthLabel,
  shiftDateKey,
  weekDays,
  weekLabel,
  weekdayLabels
} from '../lib/calendar'
import { formatDateLabel } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { TaskCard } from './TaskCard'

interface CalendarViewProps {
  tasks: TaskWithMeta[]
  month: string
  weekStart: 0 | 1
  onShiftMonth: (delta: number) => void
  onSetMonth: (month: string) => void
}

function weekdayIndex(day: Date, weekStart: 0 | 1): number {
  return weekStart === 1
    ? day.getDay() === 0
      ? 6
      : day.getDay() - 1
    : day.getDay()
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

  const [mode, setMode] = useState<'month' | 'week' | 'day'>('month')
  const [weekAnchor, setWeekAnchor] = useState(todayKey())
  const [selectedDay, setSelectedDay] = useState(todayKey())
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

  const days =
    mode === 'month'
      ? monthDays(month, weekStart)
      : mode === 'week'
        ? weekDays(weekAnchor, weekStart)
        : [fromDateKey(weekAnchor)]
  const labels = weekdayLabels(weekStart)
  const today = todayKey()
  const selectedTasks = byDay.get(selectedDay) ?? []

  const shift = (delta: number): void => {
    if (mode === 'month') onShiftMonth(delta)
    else if (mode === 'week') setWeekAnchor((anchor) => shiftDateKey(anchor, delta * 7))
    else setWeekAnchor((anchor) => shiftDateKey(anchor, delta))
  }

  const goToday = (): void => {
    setWeekAnchor(today)
    setSelectedDay(today)
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

  const title =
    mode === 'month'
      ? monthLabel(month)
      : mode === 'week'
        ? weekLabel(weekAnchor, weekStart)
        : formatDateLabel(weekAnchor)

  const selectedDate = fromDateKey(selectedDay)

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
            <button
              type="button"
              className={mode === 'day' ? 'selected' : ''}
              onClick={() => setMode('day')}
            >
              日
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
                  } ${key === selectedDay ? 'selected' : ''} ${
                    dropTarget === key ? 'drop' : ''
                  }`}
                  onClick={() => setSelectedDay(key)}
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
      ) : mode === 'week' ? (
        <div className="calendar-week">
          {days.map((day, index) => {
            const key = toDateKey(day)
            const list = byDay.get(key) ?? []
            return (
              <div
                key={key}
                className={`calendar-week-col ${key === today ? 'today' : ''} ${
                  key === selectedDay ? 'selected' : ''
                } ${dropTarget === key ? 'drop' : ''}`}
                onClick={() => setSelectedDay(key)}
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
      ) : (
        <div
          className={`calendar-day-view ${dropTarget === weekAnchor ? 'drop' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDropTarget(weekAnchor)
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => handleDrop(weekAnchor, event)}
        >
          <div className="calendar-week-head">
            <span>{labels[weekdayIndex(fromDateKey(weekAnchor), weekStart)]}</span>
            <strong>{fromDateKey(weekAnchor).getDate()}</strong>
          </div>
          <div className="calendar-week-body">
            {(byDay.get(weekAnchor) ?? []).length === 0 ? (
              <span className="calendar-week-empty">这一天还没有任务</span>
            ) : (
              (byDay.get(weekAnchor) ?? []).map((task) => (
                <Fragment key={task.id}>{renderChip(task)}</Fragment>
              ))
            )}
          </div>
        </div>
      )}

      {mode !== 'day' ? (
        <div className="calendar-day-panel">
          <div className="calendar-day-panel-head">
            <strong>
              {formatDateLabel(selectedDay)} · {selectedDate.getMonth() + 1}月
              {selectedDate.getDate()}日
            </strong>
            <span>{selectedTasks.length} 个任务</span>
          </div>
          <div className="calendar-day-panel-body">
            {selectedTasks.length === 0 ? (
              <span className="calendar-day-panel-empty">这一天还没有任务</span>
            ) : (
              selectedTasks.map((task) => <TaskCard key={task.id} task={task} showList />)
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
