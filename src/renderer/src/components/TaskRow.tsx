import { useEffect, useRef, useState } from 'react'
import type { Priority, TaskWithMeta } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { describeRecurrence, formatDueLabel, isOverdue } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface TaskRowProps {
  task: TaskWithMeta
  showList?: boolean
  canDrag?: boolean
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  onDragStart?: (id: string) => void
  onDropOn?: (id: string) => void
}

export function TaskRow({
  task,
  showList = true,
  canDrag = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onDragStart,
  onDropOn
}: TaskRowProps): React.ReactNode {
  const toggleTask = useAppStore((state) => state.toggleTask)
  const updateTask = useAppStore((state) => state.updateTask)
  const removeTask = useAppStore((state) => state.removeTask)
  const restoreTask = useAppStore((state) => state.restoreTask)
  const purgeTask = useAppStore((state) => state.purgeTask)
  const openDetail = useAppStore((state) => state.openDetail)
  const lists = useAppStore((state) => state.lists)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(task.title)
  }, [task.title])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const completed = task.status === 'completed'
  const overdue = isOverdue(task.dueDate, task.dueTime, task.allDay)
  const isTrash = Boolean(task.deletedAt)

  const commit = (): void => {
    const title = draft.trim()
    if (title && title !== task.title) void updateTask(task.id, { title })
    else setDraft(task.title)
    setEditing(false)
  }

  return (
    <div
      className={`task-row ${completed ? 'completed' : ''} ${isTrash ? 'trash' : ''} ${
        selected ? 'selected' : ''
      } ${menuOpen ? 'menu-open' : ''}`}
      draggable={canDrag && !completed && !isTrash && !selectionMode}
      onDragStart={(event) => {
        if (!canDrag) return
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart?.(task.id)
      }}
      onDragOver={(event) => {
        if (canDrag) event.preventDefault()
      }}
      onDrop={(event) => {
        if (!canDrag) return
        event.preventDefault()
        onDropOn?.(task.id)
      }}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect?.(task.id)
          return
        }
        openDetail(task.id)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || editing) return
        if (selectionMode) onToggleSelect?.(task.id)
        else openDetail(task.id)
      }}
    >
      {selectionMode ? (
        <button
          type="button"
          className={`select-check ${selected ? 'on' : ''}`}
          aria-label={selected ? '取消选择' : '选择任务'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect?.(task.id)
          }}
        >
          {selected ? <Icon name="check" size={11} /> : null}
        </button>
      ) : canDrag && !completed && !isTrash ? (
        <span className="task-drag" aria-hidden="true">
          <Icon name="grip" size={14} />
        </span>
      ) : null}

      <button
        type="button"
        className={`task-check ${completed ? 'checked' : ''}`}
        aria-label={completed ? '标记为未完成' : '标记为已完成'}
        title={completed ? '标记为未完成' : '标记为已完成'}
        onClick={(event) => {
          event.stopPropagation()
          void toggleTask(task)
        }}
      >
        {completed ? <Icon name="check" size={12} /> : null}
      </button>

      <div className="task-main">
        <div className="task-title-line">
          {editing ? (
            <input
              className="inline-title-input"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') {
                  setDraft(task.title)
                  setEditing(false)
                }
              }}
            />
          ) : (
            <span
              className="task-title"
              onDoubleClick={(event) => {
                event.stopPropagation()
                setEditing(true)
              }}
            >
              {task.title}
            </span>
          )}
          {task.pinned ? (
            <Icon name="star" size={12} filled className="pin-badge" />
          ) : null}
        </div>

        <div className="task-meta">
          {task.dueDate ? (
            <span className={`task-meta-item ${overdue ? 'overdue' : ''}`}>
              <Icon name="calendar" size={12} />
              {formatDueLabel(task.dueDate, task.dueTime, task.allDay)}
            </span>
          ) : null}
          {task.recurrence ? (
            <span className="task-meta-item">
              <Icon name="rotate" size={12} />
              {describeRecurrence(task.recurrence)}
            </span>
          ) : null}
          {task.priority > 0 ? (
            <span
              className="task-meta-item"
              style={{ color: PRIORITY_COLORS[task.priority] }}
              title={`${PRIORITY_LABELS[task.priority]}优先级`}
            >
              <Icon name="flag" size={12} />
              {PRIORITY_LABELS[task.priority]}
            </span>
          ) : null}
          {task.subtaskCount > 0 ? (
            <span className="task-meta-item">
              <Icon name="list" size={12} />
              {task.subtaskDone}/{task.subtaskCount}
            </span>
          ) : null}
          {task.tags.slice(0, 3).map((tag) => (
            <span className="task-tag" key={tag.id}>
              #{tag.name}
            </span>
          ))}
          {task.tags.length > 3 ? (
            <span className="task-tag">+{task.tags.length - 3}</span>
          ) : null}
        </div>
      </div>

      {showList && !isTrash ? (
        <span className="task-list-chip" title={task.listName}>
          <span className="list-dot small" style={{ background: task.listColor }} />
          {task.listName}
        </span>
      ) : null}

      <div className="task-actions" onClick={(event) => event.stopPropagation()}>
        {isTrash ? (
          <>
            <button
              type="button"
              className="icon-btn"
              title="恢复"
              aria-label="恢复任务"
              onClick={() => void restoreTask(task.id)}
            >
              <Icon name="rotate" size={15} />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              title="永久删除"
              aria-label="永久删除"
              onClick={() => void purgeTask(task.id)}
            >
              <Icon name="trash" size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`icon-btn ${task.pinned ? 'active' : ''}`}
              title={task.pinned ? '取消置顶' : '置顶'}
              aria-label={task.pinned ? '取消置顶' : '置顶'}
              onClick={() => void updateTask(task.id, { pinned: !task.pinned })}
            >
              <Icon name="star" size={15} filled={task.pinned} />
            </button>
            {task.status === 'abandoned' ? (
              <button
                type="button"
                className="icon-btn"
                title="恢复任务"
                aria-label="恢复任务"
                onClick={() => void restoreTask(task.id)}
              >
                <Icon name="rotate" size={15} />
              </button>
            ) : null}
            <div className="task-more" ref={menuRef}>
              <button
                type="button"
                className="icon-btn"
                title="更多"
                aria-label="更多操作"
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuOpen((value) => !value)
                }}
              >
                <Icon name="more" size={15} />
              </button>
              {menuOpen ? (
                <div
                  className="task-menu"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <span className="task-menu-title">优先级</span>
                  <div className="task-menu-priorities">
                    {PRIORITY_LABELS.map((label, value) => (
                      <button
                        type="button"
                        key={label}
                        className={task.priority === value ? 'selected' : ''}
                        style={
                          task.priority === value && value > 0
                            ? {
                                color: PRIORITY_COLORS[value],
                                borderColor: PRIORITY_COLORS[value]
                              }
                            : undefined
                        }
                        onClick={() => {
                          void updateTask(task.id, { priority: value as Priority })
                          setMenuOpen(false)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="task-menu-title">移动到清单</span>
                  <select
                    className="input task-menu-select"
                    value={task.listId}
                    onChange={(event) => {
                      void updateTask(task.id, { listId: event.target.value })
                      setMenuOpen(false)
                    }}
                  >
                    {lists.map((list) => (
                      <option value={list.id} key={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="task-menu-delete"
                    onClick={() => {
                      void removeTask(task.id)
                      setMenuOpen(false)
                    }}
                  >
                    <Icon name="trash" size={14} />
                    删除任务
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-btn danger"
              title="删除"
              aria-label="删除任务"
              onClick={() => void removeTask(task.id)}
            >
              <Icon name="trash" size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
