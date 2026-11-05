import { useEffect, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { describeRecurrence, formatDueLabel, isOverdue } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface TaskRowProps {
  task: TaskWithMeta
  showList?: boolean
  canDrag?: boolean
  onDragStart?: (id: string) => void
  onDropOn?: (id: string) => void
}

export function TaskRow({
  task,
  showList = true,
  canDrag = false,
  onDragStart,
  onDropOn
}: TaskRowProps): React.ReactNode {
  const toggleTask = useAppStore((state) => state.toggleTask)
  const updateTask = useAppStore((state) => state.updateTask)
  const removeTask = useAppStore((state) => state.removeTask)
  const restoreTask = useAppStore((state) => state.restoreTask)
  const purgeTask = useAppStore((state) => state.purgeTask)
  const openDetail = useAppStore((state) => state.openDetail)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)

  useEffect(() => {
    setDraft(task.title)
  }, [task.title])

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
      className={`task-row ${completed ? 'completed' : ''} ${isTrash ? 'trash' : ''}`}
      draggable={canDrag && !completed && !isTrash}
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
      onClick={() => openDetail(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !editing) openDetail(task.id)
      }}
    >
      {canDrag && !completed && !isTrash ? (
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
