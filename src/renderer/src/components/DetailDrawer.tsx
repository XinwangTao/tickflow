import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Attachment, Priority, Reminder, TaskWithMeta } from '@shared/types'
import { AI_CANCELED_SUBTASKS_HINT, filterNewSubtasks, type AiSubtaskDraft } from '@shared/ai'
import {
  collectSelectedSubtasks,
  createSubtaskDraftRows,
  type AiSubtaskDraftRow
} from '@shared/subtask-draft'
import { fromDateKey, todayKey } from '@shared/dates'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import {
  describeRecurrence,
  formatBytes,
  formatDateLabel,
  formatDateTime,
  isoToLocalDateTime,
  localDateTimeToIso
} from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { Modal } from './Modal'

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function recurrenceKind(rule: string | null): string {
  if (!rule) return 'none'
  const upper = rule.toUpperCase()
  if (upper === 'FREQ=DAILY') return 'daily'
  if (upper.includes('MO,TU,WE,TH,FR')) return 'weekdays'
  if (upper.startsWith('FREQ=WEEKLY')) return 'weekly'
  if (upper.startsWith('FREQ=MONTHLY')) return 'monthly'
  if (upper.startsWith('FREQ=YEARLY')) return 'yearly'
  return 'none'
}

function recurrenceRule(kind: string, task: TaskWithMeta): string | null {
  if (kind === 'none') return null
  const date = task.dueDate ? fromDateKey(task.dueDate) : new Date()
  if (kind === 'daily') return 'FREQ=DAILY'
  if (kind === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  if (kind === 'weekly') return `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[date.getDay()]}`
  if (kind === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${date.getDate()}`
  if (kind === 'yearly') {
    return `FREQ=YEARLY;BYMONTH=${date.getMonth() + 1};BYMONTHDAY=${date.getDate()}`
  }
  return null
}

export function Subtasks({ task }: { task: TaskWithMeta }): React.ReactNode {
  const refresh = useAppStore((state) => state.refresh)
  const showToast = useAppStore((state) => state.showToast)
  const aiEnabled = useAppStore((state) => state.settings.aiEnabled)
  const [subtasks, setSubtasks] = useState<TaskWithMeta[]>([])
  const [value, setValue] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  // AI 成功返回后先进入可编辑草稿，用户确认才批量写库。
  const [aiDraftRows, setAiDraftRows] = useState<AiSubtaskDraftRow[] | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  // 切换任务时丢弃旧任务的草稿与迟到响应，避免把结果写到新任务下。
  const aiRequestSeq = useRef(0)
  const taskIdRef = useRef(task.id)
  // 进行中的拆解请求 id：取消、切任务或面板卸载时用它精确中止 main 里的那次 fetch。
  const activeAiRequest = useRef<string | null>(null)

  /** 中止进行中的拆解请求；返回被中止的 id，没有请求时返回 null。 */
  const abortActiveAiRequest = (): string | null => {
    const active = activeAiRequest.current
    if (!active) return null
    activeAiRequest.current = null
    try {
      void window.api.ai.cancel(active).catch(() => undefined)
    } catch {
      // 旧 preload 或测试桩没有 cancel 时忽略，界面状态仍照常复位。
    }
    return active
  }

  const load = async (): Promise<void> => {
    try {
      const rows = await window.api.tasks.query({ view: 'subtasks', parentId: task.id })
      // 切换任务后旧任务的查询可能才返回，不能覆盖新任务的子任务列表。
      if (taskIdRef.current === task.id) setSubtasks(rows)
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  useEffect(() => {
    taskIdRef.current = task.id
    aiRequestSeq.current += 1
    // 切到别的任务时，旧任务的拆解请求没有意义了，直接中止，别让它在后台跑满超时。
    abortActiveAiRequest()
    setAiDraftRows(null)
    setAiBusy(false)
    setDraftBusy(false)
    void load()
  }, [task.id])

  // 面板关闭（组件卸载）时同样中止进行中的请求。
  useEffect(() => {
    return () => {
      abortActiveAiRequest()
    }
  }, [])

  const add = async (): Promise<void> => {
    const title = value.trim()
    if (!title) return
    try {
      await window.api.tasks.create({ listId: task.listId, parentId: task.id, title })
      setValue('')
      await load()
      await refresh()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const toggle = async (subtask: TaskWithMeta): Promise<void> => {
    try {
      await window.api.tasks.setStatus(
        subtask.id,
        subtask.status === 'completed' ? 'open' : 'completed'
      )
      await load()
      await refresh()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.api.tasks.remove(id)
      await load()
      await refresh()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  /** 批量写入子任务；成功后提供一次撤销，失败时保留已写入条目的撤销入口。 */
  const createSubtasks = async (
    drafts: AiSubtaskDraft[],
    options: { fromAi: boolean; warning: string | null }
  ): Promise<boolean> => {
    const createdIds: string[] = []
    const removeCreated = async (): Promise<void> => {
      try {
        for (const id of createdIds) {
          await window.api.tasks.remove(id)
        }
        await load()
        await refresh()
      } catch (error) {
        showToast(String(error), 'error')
      }
    }

    try {
      for (const draft of drafts) {
        const created = await window.api.tasks.create({
          listId: task.listId,
          parentId: task.id,
          title: draft.title,
          priority: draft.priority,
          dueDate: draft.dueDate,
          dueTime: draft.dueTime,
          allDay: draft.allDay
        })
        createdIds.push(created.id)
      }
    } catch (error) {
      await load()
      await refresh()
      if (createdIds.length > 0) {
        showToast(`创建子任务中断，已添加 ${createdIds.length} 个：${String(error)}`, 'error', {
          actionLabel: '撤销',
          duration: 7000,
          action: removeCreated
        })
      } else {
        showToast(`创建子任务失败：${String(error)}`, 'error')
      }
      return false
    }

    await load()
    await refresh()
    if (createdIds.length > 0) {
      // AI 拆解可能一次写入多条，撤销时一并移除刚创建的子任务。
      showToast(
        options.fromAi
          ? `AI 已添加 ${createdIds.length} 个子任务`
          : `AI 拆解不可用，已按规则添加 ${createdIds.length} 个子任务${
              options.warning ? `：${options.warning}` : ''
            }`,
        options.fromAi ? 'success' : 'info',
        {
          actionLabel: '撤销',
          duration: options.fromAi ? 6000 : 7000,
          action: removeCreated
        }
      )
    }
    return true
  }

  const breakdown = async (): Promise<void> => {
    // 草稿未处理时再点 AI 会覆盖用户改过的内容，先要求确认或取消。
    if (aiBusy || draftBusy || aiDraftRows) return
    const requestId = `subtasks-${(aiRequestSeq.current += 1)}`
    const requestTaskId = task.id
    activeAiRequest.current = requestId
    setAiBusy(true)
    try {
      const response = await window.api.ai.breakdownSubtasks(task.id, requestId)
      // 已取消、切换了任务或被新请求取代：迟到的结果不再展示，也不写库。
      if (activeAiRequest.current !== requestId || taskIdRef.current !== requestTaskId) return
      // 主进程已按数据库现有子任务过滤；这里再按当前面板状态兜底，
      // 避免连续点击或列表刚好刷新时写入重复子任务。
      const drafts = filterNewSubtasks(
        response.subtasks,
        [task.title, ...subtasks.map((item) => item.title)]
      )
      if (drafts.length === 0) {
        if (!response.ok) {
          showToast(
            `AI 拆解不可用，已使用规则拆解${response.warning ? `：${response.warning}` : ''}`,
            'info',
            { duration: 7000, actionLabel: '重试', action: () => breakdown() }
          )
        } else {
          showToast(
            response.warning ?? '没有新的子任务可添加，可能已存在或内容不足',
            'info',
            { duration: 5000 }
          )
        }
        return
      }
      if (response.ok) {
        // AI 结果不直接写库：先摊平成可编辑草稿，用户可以改标题、调优先级或去掉某条。
        setAiDraftRows(createSubtaskDraftRows(drafts))
        return
      }
      // 规则拆解是确定性结果，保持原先的一步添加；提示里保留 AI 失败原因。
      await createSubtasks(drafts, { fromAi: false, warning: response.warning })
    } catch (error) {
      if (activeAiRequest.current !== requestId) return
      showToast(`AI 拆解失败：${String(error)}`, 'error', { duration: 5000 })
    } finally {
      if (activeAiRequest.current === requestId) {
        activeAiRequest.current = null
        setAiBusy(false)
      }
    }
  }

  /** 取消进行中的拆解：中止请求并保持子任务列表不变。 */
  const cancelBreakdown = (): void => {
    if (!abortActiveAiRequest()) return
    setAiBusy(false)
    showToast(`${AI_CANCELED_SUBTASKS_HINT}，未写入任何子任务`, 'info')
  }

  const updateDraftRow = (key: string, patch: Partial<AiSubtaskDraftRow>): void => {
    setAiDraftRows((rows) =>
      rows ? rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) : rows
    )
  }

  const removeDraftRow = (key: string): void => {
    setAiDraftRows((rows) => (rows ? rows.filter((row) => row.key !== key) : rows))
  }

  const cancelDraft = (): void => {
    if (draftBusy) return
    setAiDraftRows(null)
  }

  const confirmDrafts = async (): Promise<void> => {
    if (!aiDraftRows || aiBusy || draftBusy) return
    // 确认前再按当前列表过滤一次：草稿展示期间用户可能手动加了同名子任务。
    const selected = filterNewSubtasks(collectSelectedSubtasks(aiDraftRows), [
      task.title,
      ...subtasks.map((item) => item.title)
    ])
    if (selected.length === 0) {
      showToast('请至少保留一个未添加过的子任务', 'info', { duration: 4000 })
      return
    }
    setDraftBusy(true)
    try {
      if (await createSubtasks(selected, { fromAi: true, warning: null })) {
        setAiDraftRows(null)
      }
    } finally {
      setDraftBusy(false)
    }
  }

  const draftSelectedCount = aiDraftRows
    ? filterNewSubtasks(collectSelectedSubtasks(aiDraftRows), [
        task.title,
        ...subtasks.map((item) => item.title)
      ]).length
    : 0

  const done = subtasks.filter((subtask) => subtask.status === 'completed').length

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>子任务</span>
        <div className="detail-section-actions">
          <span>
            {done}/{subtasks.length}
          </span>
          {aiEnabled && aiBusy ? (
            <button
              type="button"
              className="detail-ai-cancel"
              title="取消本次 AI 拆解（切换任务也会自动取消）"
              aria-label="取消 AI 拆解"
              onClick={cancelBreakdown}
            >
              取消
            </button>
          ) : null}
          {aiEnabled ? (
            <button
              type="button"
              className={`icon-btn ${aiBusy ? 'active' : ''}`}
              title={aiDraftRows ? '请先添加或取消当前拆解结果' : 'AI 拆解子任务'}
              aria-label="AI 拆解子任务"
              disabled={aiBusy || draftBusy || aiDraftRows !== null}
              onClick={() => void breakdown()}
            >
              <Icon name="sparkles" size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {aiDraftRows ? (
        <div className="subtask-draft" role="group" aria-label="AI 拆解结果">
          <div className="subtask-draft-head">
            <span className="subtask-draft-title">
              <Icon name="sparkles" size={13} /> AI 拆解结果 · 可修改后添加
            </span>
            <button
              type="button"
              className="icon-btn"
              title="取消 AI 拆解结果"
              aria-label="取消 AI 拆解结果"
              onClick={cancelDraft}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
          {aiDraftRows.map((row, index) => (
            <div className="subtask-draft-row" key={row.key}>
              <input
                type="checkbox"
                className="subtask-draft-check"
                checked={row.selected}
                aria-label={`选择子任务 ${index + 1}`}
                onChange={(event) =>
                  updateDraftRow(row.key, { selected: event.target.checked })
                }
              />
              <input
                className="subtask-draft-input"
                value={row.title}
                placeholder="子任务标题"
                aria-label={`子任务标题 ${index + 1}`}
                onChange={(event) => updateDraftRow(row.key, { title: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void confirmDrafts()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelDraft()
                  }
                }}
              />
              <select
                className="subtask-draft-priority"
                value={row.priority}
                aria-label={`子任务优先级 ${index + 1}`}
                onChange={(event) =>
                  updateDraftRow(row.key, {
                    priority: Number(event.target.value) as Priority
                  })
                }
              >
                {PRIORITY_LABELS.map((label, priority) => (
                  <option value={priority} key={label}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`移除子任务 ${index + 1}`}
                onClick={() => removeDraftRow(row.key)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          <div className="subtask-draft-footer">
            <span className="subtask-draft-note">
              勾选要添加的条目，可直接改标题；取消不写库。
            </span>
            <button type="button" className="btn" onClick={cancelDraft} disabled={draftBusy}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={draftBusy || draftSelectedCount === 0}
              onClick={() => void confirmDrafts()}
            >
              {draftBusy ? '添加中…' : `添加选中（${draftSelectedCount}）`}
            </button>
          </div>
        </div>
      ) : null}
      <div className="subtask-list">
        {subtasks.map((subtask) => (
          <div className="subtask-row" key={subtask.id}>
            <button
              type="button"
              className={`task-check small ${subtask.status === 'completed' ? 'checked' : ''}`}
              aria-label={subtask.status === 'completed' ? '标记为未完成' : '标记为已完成'}
              onClick={() => void toggle(subtask)}
            >
              {subtask.status === 'completed' ? <Icon name="check" size={10} /> : null}
            </button>
            <span
              className={`subtask-title ${subtask.status === 'completed' ? 'done' : ''}`}
            >
              {subtask.title}
            </span>
            <button
              type="button"
              className="icon-btn danger"
              aria-label="删除子任务"
              onClick={() => void remove(subtask.id)}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="subtask-add">
        <Icon name="plus" size={14} />
        <input
          className="subtask-input"
          value={value}
          placeholder="添加子任务，回车保存"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
      </div>
    </section>
  )
}

function Reminders({ task }: { task: TaskWithMeta }): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [date, setDate] = useState(task.dueDate ?? todayKey())
  const [time, setTime] = useState(task.dueTime ?? '09:00')

  const load = async (): Promise<void> => {
    try {
      const rows = await window.api.reminders.list(task.id)
      setReminders(rows)
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  useEffect(() => {
    void load()
  }, [task.id])

  const add = async (): Promise<void> => {
    try {
      await window.api.reminders.create(task.id, localDateTimeToIso(date, time))
      await load()
      showToast('已添加提醒', 'success')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.api.reminders.remove(id)
      await load()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>提醒</span>
        <span>{reminders.length > 0 ? `${reminders.length} 个` : ''}</span>
      </div>
      <div className="reminder-list">
        {reminders.map((reminder) => {
          const local = isoToLocalDateTime(reminder.triggerAt)
          return (
            <div className="reminder-row" key={reminder.id}>
              <Icon name="bell" size={13} />
              <span>
                {formatDateLabel(local.date)} {local.time}
              </span>
              {reminder.sentAt ? <span className="reminder-sent">已发送</span> : null}
              <button
                type="button"
                className="icon-btn danger"
                aria-label="删除提醒"
                onClick={() => void remove(reminder.id)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="reminder-add">
        <input
          className="input"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-label="提醒日期"
        />
        <input
          className="input time-input"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          aria-label="提醒时间"
        />
        <button type="button" className="btn" onClick={() => void add()}>
          <Icon name="plus" size={14} />
          添加
        </button>
      </div>
    </section>
  )
}

function Attachments({ task }: { task: TaskWithMeta }): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [items, setItems] = useState<Attachment[]>([])

  const load = async (): Promise<void> => {
    try {
      setItems(await window.api.attachments.list(task.id))
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  useEffect(() => {
    void load()
  }, [task.id])

  const add = async (): Promise<void> => {
    try {
      const created = await window.api.attachments.add(task.id)
      if (created) {
        await load()
        showToast('已添加附件', 'success')
      }
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const open = async (id: string): Promise<void> => {
    try {
      await window.api.attachments.open(id)
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.api.attachments.remove(id)
      await load()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>附件</span>
        <span>{items.length > 0 ? `${items.length} 个` : ''}</span>
      </div>
      <div className="attachment-list">
        {items.map((attachment) => (
          <div
            className="attachment-row"
            key={attachment.id}
            onClick={() => void open(attachment.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void open(attachment.id)
            }}
          >
            <Icon name="paperclip" size={14} />
            <span className="attachment-name" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="attachment-size">{formatBytes(attachment.size)}</span>
            <button
              type="button"
              className="icon-btn danger"
              aria-label="删除附件"
              onClick={(event) => {
                event.stopPropagation()
                void remove(attachment.id)
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn attachment-add" onClick={() => void add()}>
        <Icon name="plus" size={14} />
        添加附件
      </button>
    </section>
  )
}

export function DetailDrawer(): React.ReactNode {
  const task = useAppStore((state) => state.detailTask)
  const lists = useAppStore((state) => state.lists)
  const updateTask = useAppStore((state) => state.updateTask)
  const removeTask = useAppStore((state) => state.removeTask)
  const openDetail = useAppStore((state) => state.openDetail)
  const showToast = useAppStore((state) => state.showToast)

  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const notesTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!task) return
    setTitleDraft(task.title)
    setNotesDraft(task.notes)
    setTagsDraft(task.tags.map((tag) => tag.name).join(', '))
  }, [task?.id])

  useEffect(() => {
    return () => {
      if (notesTimer.current) window.clearTimeout(notesTimer.current)
    }
  }, [])

  if (!task) {
    return (
      <motion.aside
        className="detail-drawer"
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="detail-loading">加载任务…</div>
      </motion.aside>
    )
  }

  const commitTitle = (): void => {
    const title = titleDraft.trim()
    if (title && title !== task.title) void updateTask(task.id, { title })
    else setTitleDraft(task.title)
  }

  const changeNotes = (value: string): void => {
    setNotesDraft(value)
    if (notesTimer.current) window.clearTimeout(notesTimer.current)
    notesTimer.current = window.setTimeout(() => {
      if (value !== task.notes) void updateTask(task.id, { notes: value })
    }, 500)
  }

  const commitTags = (): void => {
    const names = tagsDraft
      .split(/[,，\s]+/)
      .map((name) => name.trim())
      .filter(Boolean)
    const current = task.tags.map((tag) => tag.name)
    if (names.join('|') !== current.join('|')) void updateTask(task.id, { tagNames: names })
  }

  const saveAsTemplate = async (): Promise<void> => {
    const name = templateName.trim()
    if (!name) return
    try {
      await window.api.templates.fromTask(task.id, name)
      setTemplateOpen(false)
      setTemplateName('')
      showToast('已保存为模板', 'success')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <motion.aside
      className="detail-drawer"
      initial={{ x: 28, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 28, opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      aria-label="任务详情"
    >
      <div className="detail-header">
        <div className="detail-header-left">
          <button
            type="button"
            className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
            aria-label={task.status === 'completed' ? '标记为未完成' : '标记为已完成'}
            onClick={() => void useAppStore.getState().toggleTask(task)}
          >
            {task.status === 'completed' ? <Icon name="check" size={12} /> : null}
          </button>
          <span className="detail-eyebrow">任务详情</span>
        </div>
        <div className="detail-header-actions">
          <button
            type="button"
            className={`icon-btn ${task.pinned ? 'active' : ''}`}
            title={task.pinned ? '取消置顶' : '置顶'}
            aria-label={task.pinned ? '取消置顶' : '置顶'}
            onClick={() => void updateTask(task.id, { pinned: !task.pinned })}
          >
            <Icon name="star" size={16} filled={task.pinned} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="关闭"
            aria-label="关闭详情"
            onClick={() => openDetail(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="detail-body">
        <input
          className="detail-title"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          aria-label="任务标题"
        />

        <textarea
          className="detail-notes"
          value={notesDraft}
          placeholder="添加备注…"
          rows={4}
          onChange={(event) => changeNotes(event.target.value)}
          aria-label="任务备注"
        />

        <div className="detail-grid">
          <label className="detail-field">
            <span className="field-label">
              <Icon name="folder" size={13} /> 清单
            </span>
            <select
              className="input"
              value={task.listId}
              onChange={(event) => void updateTask(task.id, { listId: event.target.value })}
            >
              {lists.map((list) => (
                <option value={list.id} key={list.id}>
                  {list.emoji ? `${list.emoji} ` : ''}
                  {list.name}
                </option>
              ))}
            </select>
          </label>

          <div className="detail-field">
            <span className="field-label">
              <Icon name="flag" size={13} /> 优先级
            </span>
            <div className="priority-group" role="group" aria-label="优先级">
              {PRIORITY_LABELS.map((label, value) => (
                <button
                  key={label}
                  type="button"
                  className={`priority-btn ${task.priority === value ? 'selected' : ''}`}
                  style={
                    task.priority === value && value > 0
                      ? { color: PRIORITY_COLORS[value], borderColor: PRIORITY_COLORS[value] }
                      : undefined
                  }
                  onClick={() => void updateTask(task.id, { priority: value as Priority })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="detail-field">
            <span className="field-label">
              <Icon name="calendar" size={13} /> 截止日期
            </span>
            <div className="date-row">
              <input
                className="input"
                type="date"
                value={task.dueDate ?? ''}
                onChange={(event) =>
                  void updateTask(task.id, {
                    dueDate: event.target.value || null,
                    allDay: !task.dueTime
                  })
                }
              />
              <input
                className="input time-input"
                type="time"
                value={task.dueTime ?? ''}
                disabled={task.allDay}
                onChange={(event) =>
                  void updateTask(task.id, {
                    dueTime: event.target.value || null,
                    allDay: !event.target.value
                  })
                }
              />
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={task.allDay}
                onChange={(event) =>
                  void updateTask(task.id, {
                    allDay: event.target.checked,
                    dueTime: event.target.checked ? null : task.dueTime
                  })
                }
              />
              全天
            </label>
          </label>

          <label className="detail-field">
            <span className="field-label">
              <Icon name="calendar" size={13} /> 开始日期
            </span>
            <input
              className="input"
              type="date"
              value={task.startDate ?? ''}
              onChange={(event) =>
                void updateTask(task.id, {
                  startDate: event.target.value || null
                })
              }
            />
          </label>

          <label className="detail-field">
            <span className="field-label">
              <Icon name="tag" size={13} /> 标签
            </span>
            <input
              className="input"
              value={tagsDraft}
              placeholder="用逗号分隔，例如：工作, 重要"
              onChange={(event) => setTagsDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>

          <label className="detail-field detail-field-wide">
            <span className="field-label">
              <Icon name="rotate" size={13} /> 重复
            </span>
            <select
              className="input"
              value={recurrenceKind(task.recurrence)}
              onChange={(event) =>
                void updateTask(task.id, {
                  recurrence: recurrenceRule(event.target.value, task)
                })
              }
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekdays">每个工作日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
            </select>
            {task.recurrence ? (
              <span className="field-hint">{describeRecurrence(task.recurrence)}</span>
            ) : null}
          </label>
        </div>

        <Subtasks task={task} />
        <Reminders task={task} />
        <Attachments task={task} />

        <div className="detail-info-row">
          <span>创建</span>
          <span>{formatDateTime(task.createdAt)}</span>
        </div>
        <div className="detail-info-row">
          <span>更新</span>
          <span>{formatDateTime(task.updatedAt)}</span>
        </div>

        <div className="detail-footer">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTemplateName(task.title)
              setTemplateOpen(true)
            }}
          >
            <Icon name="list" size={15} />
            保存为模板
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              void removeTask(task.id)
            }}
          >
            <Icon name="trash" size={15} />
            删除任务
          </button>
        </div>
      </div>

      {templateOpen ? (
        <Modal
          title="保存为模板"
          onClose={() => setTemplateOpen(false)}
          width={400}
        >
          <label className="field">
            <span className="field-label">模板名称</span>
            <input
              className="input"
              autoFocus
              value={templateName}
              maxLength={40}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveAsTemplate()
              }}
            />
          </label>
          <p className="settings-note">
            会保存当前任务的标题、备注、优先级、标签和清单。
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setTemplateOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!templateName.trim()}
              onClick={() => void saveAsTemplate()}
            >
              保存
            </button>
          </div>
        </Modal>
      ) : null}
    </motion.aside>
  )
}
