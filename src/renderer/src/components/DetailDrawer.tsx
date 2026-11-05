import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Priority } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { describeRecurrence, formatDateTime } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

export function DetailDrawer(): React.ReactNode {
  const task = useAppStore((state) => state.detailTask)
  const lists = useAppStore((state) => state.lists)
  const updateTask = useAppStore((state) => state.updateTask)
  const removeTask = useAppStore((state) => state.removeTask)
  const openDetail = useAppStore((state) => state.openDetail)

  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
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
            onClick={() =>
              void useAppStore.getState().toggleTask(task)
            }
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
        </div>

        {task.recurrence ? (
          <div className="detail-info-row">
            <span>
              <Icon name="rotate" size={13} /> 重复
            </span>
            <span>{describeRecurrence(task.recurrence)}</span>
          </div>
        ) : null}

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
    </motion.aside>
  )
}
