import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { fromDateKey, todayKey, toDateKey } from '@shared/dates'
import { parseCalendarAdd } from '@shared/calendar-add'
import {
  describeReminderOffset,
  reminderTriggerAt,
  type QuickAddResult
} from '@shared/quick-add'
import {
  createQuickAddDraft,
  draftToQuickAddResult,
  type QuickAddDraft
} from '@shared/quick-add-draft'
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
import { QuickAddDraftCard } from './QuickAddDraftCard'
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
  const [aiBusy, setAiBusy] = useState(false)
  const [aiElapsed, setAiElapsed] = useState(0)
  const [aiDraft, setAiDraft] = useState<QuickAddDraft | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const addInputRef = useRef<HTMLInputElement | null>(null)
  // 异步返回时用来核对输入是否已被改写，避免把上一条解析结果套到新输入上。
  const draftValueRef = useRef('')
  const aiRequestSeq = useRef(0)
  const activeAiRequest = useRef<{ id: string; text: string } | null>(null)
  const unmounted = useRef(false)

  const aiAvailable = Boolean(settings.aiEnabled && window.api.ai?.parseQuickAdd)
  const aiTimeoutSeconds = Math.max(1, Math.round((settings.aiTimeoutMs || 15000) / 1000))

  /** 中止进行中的 AI 解析；返回 false 表示当前没有挂起的请求。 */
  function cancelActiveAiRequest(): boolean {
    const active = activeAiRequest.current
    if (!active) return false
    activeAiRequest.current = null
    try {
      const pending = window.api.ai?.cancel?.(active.id)
      if (pending && typeof pending.catch === 'function') {
        void pending.catch(() => undefined)
      }
    } catch {
      // 旧 preload 或测试桩没有 cancel 时忽略，结果仍会按 requestId 丢弃。
    }
    return true
  }

  // 切换日期后表单跟着切走，避免把下一条任务建到看不见的那一天；
  // 同时中止进行中的 AI 请求，迟到的结果不会落到新日期上。
  useEffect(() => {
    cancelActiveAiRequest()
    setAdding(false)
    setDraft('')
    draftValueRef.current = ''
    setAddHint('')
    setAiDraft(null)
    setAiBusy(false)
    setAiElapsed(0)
  }, [addDay])

  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0)
      return
    }
    const timer = setInterval(() => setAiElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [aiBusy])

  // 切换视图导致日历卸载时，别让 AI 请求在后台白等到超时。
  useEffect(() => {
    return () => {
      unmounted.current = true
      cancelActiveAiRequest()
    }
  }, [])

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
    cancelActiveAiRequest()
    setAdding(false)
    setDraft('')
    draftValueRef.current = ''
    setAddHint('')
    setAiDraft(null)
    setAiBusy(false)
    setAiElapsed(0)
  }

  const openAddForm = (): void => {
    setAddHint('')
    setAdding(true)
  }

  /** `~清单` / AI listName 按名字匹配，忽略空白与大小写。 */
  const matchList = (name: string | null): (typeof lists)[number] | undefined => {
    if (!name) return undefined
    const lowered = name.replace(/\s+/g, '').toLowerCase()
    return lists.find((list) => list.name.replace(/\s+/g, '').toLowerCase() === lowered)
  }

  const fallbackList = (): (typeof lists)[number] | undefined =>
    lists.find((list) => list.id === defaultListId) ??
    lists.find((list) => list.isInbox) ??
    lists[0]

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

  /** 写库的唯一步骤：规则解析、AI 失败回落与 AI 草稿确认都走这里。 */
  const createFromResult = async (
    result: QuickAddResult,
    options: { listId?: string | null; applyDefaultDueDate?: boolean } = {}
  ): Promise<{ task: TaskWithMeta; reminderNote: string | null } | null> => {
    const matched = options.listId
      ? lists.find((list) => list.id === options.listId)
      : matchList(result.listName)
    const target = matched ?? fallbackList()
    if (!target) {
      setAddHint('没有可用清单，请先创建一个清单')
      return null
    }
    if (result.listName && !matched) {
      showToast(`未找到清单「${result.listName}」，已放入「${target.name}」`, 'info')
    }

    const dueDate =
      options.applyDefaultDueDate === false ? result.dueDate : (result.dueDate ?? addDay)
    const created = await createTask({
      listId: target.id,
      title: result.title,
      priority: result.priority,
      dueDate,
      dueTime: result.dueTime,
      allDay: result.allDay,
      recurrence: result.recurrence,
      tagNames: result.tags
    })
    if (!created) return null
    const reminderNote = await scheduleAddReminder(created, result.reminderOffsetMin, {
      dueDate,
      dueTime: result.dueTime
    })
    return { task: created, reminderNote }
  }

  /** 创建成功统一给「撤销」：直接移除刚建的任务（进垃圾箱，可恢复）。 */
  const notifyAdded = (
    created: TaskWithMeta,
    message: string,
    kind: 'success' | 'info' = 'success',
    duration = 6000
  ): void => {
    showToast(message, kind, {
      duration,
      actionLabel: '撤销',
      action: async () => {
        try {
          await window.api.tasks.remove(created.id)
          await refresh()
        } catch (error) {
          showToast(String(error), 'error')
        }
      }
    })
  }

  const submitTask = async (useAi: boolean): Promise<void> => {
    if (submitting || draftBusy) return
    const raw = draft.trim()
    if (!raw) {
      setAddHint('请输入任务标题')
      addInputRef.current?.focus()
      return
    }
    if (aiBusy) {
      // 普通 Enter 不绕过进行中的请求；Esc 或「取消」可中止。
      showToast('AI 正在解析，按 Esc 或点「取消」可中止', 'info')
      return
    }
    if (aiDraft) {
      if (!useAi) {
        showToast('请先添加或取消上方的 AI 解析结果', 'info')
        return
      }
      // 再点一次 AI 视为按当前输入重新解析。
      setAiDraft(null)
    }

    let result: QuickAddResult = parseCalendarAdd(raw, addDay)
    let aiWarning: string | null = null
    let aiUsed = false
    if (useAi && aiAvailable) {
      aiUsed = true
      const requestId = `calendar-add-${(aiRequestSeq.current += 1)}`
      activeAiRequest.current = { id: requestId, text: raw }
      setAiBusy(true)
      try {
        // 第三个参数让 main 在输入没写日期时落到选中的那一天。
        const response = await window.api.ai.parseQuickAdd(raw, requestId, addDay)
        if (unmounted.current) return
        // 已取消或已被新请求取代：迟到的结果一律丢弃。
        if (activeAiRequest.current?.id !== requestId) return
        if (draftValueRef.current.trim() !== raw) {
          showToast('输入已变化，已忽略上一次 AI 解析结果', 'info')
          return
        }
        if (response.ok && response.source === 'ai') {
          // AI 成功先进入草稿，不立即写库：可以改完标题、时间、清单再添加。
          const nextDraft = createQuickAddDraft(
            response.result,
            lists,
            defaultListId ?? null,
            addDay
          )
          setAiDraft(nextDraft)
          if (response.result.listName && !matchList(response.result.listName)) {
            const fallback = lists.find((list) => list.id === nextDraft.listId)
            showToast(
              `未找到清单「${response.result.listName}」，已选择「${fallback?.name ?? '当前清单'}」`,
              'info'
            )
          }
          return
        }
        result = response.result
        aiWarning = response.warning
      } catch (error) {
        if (activeAiRequest.current?.id !== requestId) return
        result = parseCalendarAdd(raw, addDay)
        aiWarning = String(error)
      } finally {
        if (activeAiRequest.current?.id === requestId) {
          activeAiRequest.current = null
          setAiBusy(false)
        }
      }
    }

    setSubmitting(true)
    try {
      const created = await createFromResult(result)
      if (!created) return
      closeAddForm()
      const suffix = created.reminderNote ? `（${created.reminderNote}）` : ''
      if (aiUsed) {
        notifyAdded(
          created.task,
          aiWarning
            ? `AI 未能解析，已按规则添加「${created.task.title}」：${aiWarning}${suffix}`
            : `AI 已添加「${created.task.title}」${suffix}`,
          aiWarning ? 'info' : 'success',
          aiWarning ? 7000 : 6000
        )
      } else {
        notifyAdded(created.task, `已添加「${created.task.title}」${suffix}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** 取消进行中的 AI 解析：中止 main 里的 fetch，输入内容保持不变。 */
  const cancelAiParse = (): void => {
    if (!cancelActiveAiRequest()) return
    setAiBusy(false)
    setAiElapsed(0)
    showToast('已取消 AI 解析，输入内容已保留', 'info')
    addInputRef.current?.focus()
  }

  const updateAiDraft = (patch: Partial<QuickAddDraft>): void => {
    setAiDraft((current) => (current ? { ...current, ...patch } : current))
  }

  const cancelAiDraft = (): void => {
    setAiDraft(null)
    addInputRef.current?.focus()
  }

  const confirmAiDraft = async (): Promise<void> => {
    if (!aiDraft || aiBusy || draftBusy) return
    const result = draftToQuickAddResult(aiDraft, lists)
    if (!result) {
      showToast('任务标题不能为空', 'error')
      return
    }
    setDraftBusy(true)
    try {
      const created = await createFromResult(result, {
        listId: aiDraft.listId,
        // 用户可能主动清空了日期，确认时不能再被选中日期补回来。
        applyDefaultDueDate: false
      })
      if (!created) return
      closeAddForm()
      const suffix = created.reminderNote ? `（${created.reminderNote}）` : ''
      notifyAdded(created.task, `AI 已添加「${created.task.title}」${suffix}`)
    } finally {
      setDraftBusy(false)
    }
  }

  const renderAddForm = (): React.ReactNode =>
    adding ? (
      <div className="calendar-add">
        <form
          className="calendar-add-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitTask(false)
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
              draftValueRef.current = event.target.value
              if (addHint) setAddHint('')
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void submitTask(true)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                void submitTask(false)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                if (aiBusy) cancelAiParse()
                else if (aiDraft) cancelAiDraft()
                else closeAddForm()
              }
            }}
          />
          {aiAvailable ? (
            aiBusy ? (
              <button
                type="button"
                className="quick-add-ai busy calendar-add-ai"
                aria-label="取消 AI 解析"
                title="取消本次 AI 解析"
                onClick={cancelAiParse}
              >
                <Icon name="sparkles" size={13} />
                {aiElapsed > 0 ? `解析中 ${aiElapsed}s` : '解析中'}
              </button>
            ) : (
              <button
                type="button"
                className="quick-add-ai calendar-add-ai"
                aria-label="AI 解析"
                title={`AI 解析（Ctrl+Enter）· 超过 ${aiTimeoutSeconds} 秒自动回落到规则解析`}
                disabled={submitting || draftBusy || !draft.trim()}
                onClick={() => void submitTask(true)}
              >
                <Icon name="sparkles" size={13} />
                AI
              </button>
            )
          ) : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || aiBusy || draftBusy || Boolean(aiDraft)}
          >
            添加
          </button>
          <button type="button" className="btn" onClick={closeAddForm}>
            取消
          </button>
        </form>
        {previewChips.length && !aiDraft ? (
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
        {aiDraft ? (
          <QuickAddDraftCard
            draft={aiDraft}
            lists={lists}
            busy={draftBusy}
            note="修改后点「确认添加」写库；放弃后仍可用普通 Enter 按规则添加。"
            confirmLabel="确认添加"
            cancelLabel="放弃"
            onChange={updateAiDraft}
            onConfirm={() => void confirmAiDraft()}
            onCancel={cancelAiDraft}
          />
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
