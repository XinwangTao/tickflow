import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Attachment, Priority, Reminder, TaskWithMeta } from '@shared/types'
import { filterNewSubtasks } from '@shared/ai'
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

function Subtasks({ task }: { task: TaskWithMeta }): React.ReactNode {
  const refresh = useAppStore((state) => state.refresh)
  const showToast = useAppStore((state) => state.showToast)
  const aiEnabled = useAppStore((state) => state.settings.aiEnabled)
  const [subtasks, setSubtasks] = useState<TaskWithMeta[]>([])
  const [value, setValue] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const rows = await window.api.tasks.query({ view: 'subtasks', parentId: task.id })
      setSubtasks(rows)
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  useEffect(() => {
    void load()
  }, [task.id])

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

  const breakdown = async (): Promise<void> => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const response = await window.api.ai.breakdownSubtasks(task.id)
      if (!response.ok) {
        showToast(
          `AI 拆解不可用，已使用规则拆解${response.warning ? `：${response.warning}` : ''}`,
          'info',
          { duration: 5000 }
        )
      } else if (response.warning) {
        showToast(response.warning, 'info', { duration: 5000 })
      }
      // 主进程已按数据库现有子任务过滤；这里再按当前面板状态兜底，
      // 避免连续点击或列表刚好刷新时写入重复子任务。
      const drafts = filterNewSubtasks(
        response.subtasks,
        [task.title, ...subtasks.map((item) => item.title)]
      )
      if (drafts.length === 0) {
        showToast(
          response.ok
            ? '没有新的子任务可添加，可能已存在或内容不足'
            : '没有可拆解的内容，请补充任务备注或手动添加子任务',
          'info'
        )
        return
      }
      for (const draft of drafts) {
        await window.api.tasks.create({
          listId: task.listId,
          parentId: task.id,
          title: draft.title,
          priority: draft.priority,
          dueDate: draft.dueDate,
          dueTime: draft.dueTime,
          allDay: draft.allDay
        })
      }
      await load()
      await refresh()
    } catch (error) {
      showToast(`AI 拆解失败：${String(error)}`, 'error', { duration: 5000 })
    } finally {
      setAiBusy(false)
    }
  }

  const done = subtasks.filter((subtask) => subtask.status === 'completed').length

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>子任务</span>
        <div className="detail-section-actions">
          <span>
            {done}/{subtasks.length}
          </span>
          {aiEnabled ? (
            <button
              type="button"
              className={`icon-btn ${aiBusy ? 'active' : ''}`}
              title="AI 拆解子任务"
              aria-label="AI 拆解子任务"
              disabled={aiBusy}
              onClick={() => void breakdown()}
            >
              <Icon name="sparkles" size={13} />
            </button>
          ) : null}
        </div>
      </div>
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
