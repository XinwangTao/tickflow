import type { TaskWithMeta } from '@shared/types'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { formatDueLabel, isOverdue } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface TaskCardProps {
  task: TaskWithMeta
  showList?: boolean
  draggable?: boolean
  onDragStart?: (id: string) => void
}

export function TaskCard({
  task,
  showList = false,
  draggable = false,
  onDragStart
}: TaskCardProps): React.ReactNode {
  const toggleTask = useAppStore((state) => state.toggleTask)
  const openDetail = useAppStore((state) => state.openDetail)
  const overdue = isOverdue(task.dueDate, task.dueTime, task.allDay)
  const completed = task.status === 'completed'

  return (
    <div
      className={`task-card ${completed ? 'done' : ''}`}
      draggable={draggable && !completed}
      onDragStart={(event) => {
        if (!draggable) return
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart?.(task.id)
      }}
      onClick={() => openDetail(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') openDetail(task.id)
      }}
    >
      <button
        type="button"
        className={`task-check ${completed ? 'checked' : ''}`}
        aria-label={completed ? '标记为未完成' : '标记为已完成'}
        onClick={(event) => {
          event.stopPropagation()
          void toggleTask(task)
        }}
      >
        {completed ? <Icon name="check" size={11} /> : null}
      </button>

      <div className="task-card-body">
        <div className="task-card-title">{task.title}</div>
        <div className="task-card-meta">
          {task.dueDate ? (
            <span className={`task-meta-item ${overdue ? 'overdue' : ''}`}>
              <Icon name="calendar" size={11} />
              {formatDueLabel(task.dueDate, task.dueTime, task.allDay)}
            </span>
          ) : null}
          {task.priority > 0 ? (
            <span
              className="task-meta-item"
              style={{ color: PRIORITY_COLORS[task.priority] }}
              title={`${PRIORITY_LABELS[task.priority]}优先级`}
            >
              <Icon name="flag" size={11} />
              {PRIORITY_LABELS[task.priority]}
            </span>
          ) : null}
          {task.tags.slice(0, 2).map((tag) => (
            <span className="task-tag" key={tag.id}>
              #{tag.name}
            </span>
          ))}
          {showList ? (
            <span className="task-card-list">
              <span className="list-dot small" style={{ background: task.listColor }} />
              {task.listName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
