import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { fromDateKey, todayKey, toDateKey } from '@shared/dates'
import { parseCalendarAdd } from '@shared/calendar-add'
import { describeReminderOffset, reminderTriggerAt } from '@shared/quick-add'
import {
  monthDays,
  monthLabel,
  shiftDateKey,
  weekDays,
  weekLabel,
  weekdayLabels
} from '../lib/calendar'
import { formatDateLabel, formatDueLabel, describeRecurrence } from '../lib/format'
import { PRIORITY_LABELS } from '../lib/colors'
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
  const createTask = useAppStore((state) => state.createTask)
  const refresh = useAppStore((state) => state.refresh)
  const showToast = useAppStore((state) => state.showToast)
  const lists = useAppStore((state) => state.lists)
  const settings = useAppStore((state) => state.settings)
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
  const defaultListId =
    settings.defaultListId ?? lists.find((list) => list.isInbox)?.id ?? lists[0]?.id

  // 行内添加的目标日期：月/周视图用选中的格子，日视图用当前天。
  const addDay = mode === 'day' ? weekAnchor : selectedDay
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [addHint, setAddHint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const addInputRef = useRef<HTMLInputElement | null>(null)

  // 切换日期后表单跟着切走，避免把下一条任务建到看不见的那一天。
  useEffect(() => {
    setAdding(false)
    setDraft('')
    setAddHint('')
  }, [addDay])

  const parsed = useMemo(
    () => (draft.trim() ? parseCalendarAdd(draft, addDay) : null),
    [draft, addDay]
  )

  const previewChips = useMemo(() => {
    if (!parsed) return []
    const chips: string[] = []
    const due = formatDueLabel(parsed.dueDate, parsed.dueTime, parsed.allDay)
    if (due) chips.push(due)
    if (parsed.priority > 0) chips.push(`${PRIORITY_LABELS[parsed.priority]}优先级`)
    for (const tag of parsed.tags) chips.push(`#${tag}`)
    if (parsed.listName) chips.push(`~${parsed.listName}`)
    if (parsed.recurrence) chips.push(describeRecurrence(parsed.recurrence))
    if (parsed.reminderOffsetMin != null) {
      chips.push(describeReminderOffset(parsed.reminderOffsetMin))
    }
    return chips
  }, [parsed])

  const closeAddForm = (): void => {
    setAdding(false)
    setDraft('')
    setAddHint('')
  }

  const openAddForm = (): void => {
    setAddHint('')
    setAdding(true)
  }

  /** `~清单` 写法与快速添加一致：按名字匹配（忽略空白与大小写），找不到就落默认清单。 */
  const resolveAddList = (name: string | null): (typeof lists)[number] | undefined => {
    if (name) {
      const lowered = name.replace(/\s+/g, '').toLowerCase()
      const matched = lists.find(
        (list) => list.name.replace(/\s+/g, '').toLowerCase() === lowered
      )
      if (matched) return matched
    }
    return (
      lists.find((list) => list.id === defaultListId) ??
      lists.find((list) => list.isInbox) ??
      lists[0]
    )
  }

  /**
   * 提前提醒落到 reminders 表：提醒时间已过或没有截止日期时不硬建一条永不触发的记录，
   * 而是把原因拼进“已添加”提示里。
   */
  const scheduleAddReminder = async (
    task: TaskWithMeta,
    offsetMinutes: number | null,
    due: { dueDate: string | null; dueTime: string | null }
  ): Promise<string | null> => {
    if (offsetMinutes == null) return null
    const triggerAt = reminderTriggerAt({
      dueDate: due.dueDate,
      dueTime: due.dueTime,
      reminderOffsetMin: offsetMinutes
    })
    if (!triggerAt) return '未设置截止日期，提醒未创建'
    if (new Date(triggerAt).getTime() <= Date.now()) return '提醒时间已过，提醒未创建'
    try {
      await window.api.reminders?.create(task.id, triggerAt)
      return null
    } catch (error) {
      return `提醒创建失败：${String(error)}`
    }
  }

  const submitTask = async (): Promise<void> => {
    if (submitting) return
    const raw = draft.trim()
    if (!raw) {
      setAddHint('请输入任务标题')
      addInputRef.current?.focus()
      return
    }
    const result = parseCalendarAdd(draft, addDay)
    const target = resolveAddList(result.listName)
    if (!target) {
      setAddHint('没有可用清单，请先创建一个清单')
      return
    }
    if (result.listName && target.name.replace(/\s+/g, '') !== result.listName.replace(/\s+/g, '')) {
      showToast(`未找到清单「${result.listName}」，已放入「${target.name}」`, 'info')
    }

    setSubmitting(true)
    try {
      const created = await createTask({
        listId: target.id,
        title: result.title,
        priority: result.priority,
        dueDate: result.dueDate,
        dueTime: result.dueTime,
        allDay: result.allDay,
        recurrence: result.recurrence,
        tagNames: result.tags
      })
      if (!created) return
      const reminderNote = await scheduleAddReminder(created, result.reminderOffsetMin, result)
      closeAddForm()
      showToast(
        `已添加「${created.title}」${reminderNote ? `（${reminderNote}）` : ''}`,
        'success',
        {
          duration: 6000,
          actionLabel: '撤销',
          action: async () => {
            try {
              await window.api.tasks.remove(created.id)
              await refresh()
            } catch (error) {
              showToast(String(error), 'error')
            }
          }
        }
      )
    } finally {
      setSubmitting(false)
    }
  }

  const renderAddForm = (): React.ReactNode =>
    adding ? (
      <div className="calendar-add">
        <form
          className="calendar-add-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitTask()
          }}
        >
          <input
            ref={addInputRef}
            className="input"
            aria-label="日历添加任务标题"
            autoFocus
            value={draft}
            placeholder="任务标题，可写 9点 / #标签 / !高 / 每3天"
            onChange={(event) => {
              setDraft(event.target.value)
              if (addHint) setAddHint('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitTask()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeAddForm()
              }
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            添加
          </button>
          <button type="button" className="btn" onClick={closeAddForm}>
            取消
          </button>
        </form>
        {previewChips.length ? (
          <div className="calendar-add-preview" aria-label="解析预览">
            {previewChips.map((chip) => (
              <span className="calendar-add-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        {addHint ? (
          <span className="calendar-add-hint" role="status">
            {addHint}
          </span>
        ) : null}
      </div>
    ) : null

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
          <div className="calendar-day-view-actions">
            <button type="button" className="btn calendar-add-btn" onClick={openAddForm}>
              <Icon name="plus" size={14} />
              添加任务
            </button>
          </div>
          {renderAddForm()}
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
            <button
              type="button"
              className="btn calendar-add-btn"
              onClick={openAddForm}
            >
              <Icon name="plus" size={14} />
              添加任务
            </button>
          </div>
          {renderAddForm()}
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
