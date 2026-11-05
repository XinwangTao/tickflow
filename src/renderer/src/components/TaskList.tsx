import { useState } from 'react'
import type { TaskWithMeta, ViewKey } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { TaskRow } from './TaskRow'

interface TaskListProps {
  tasks: TaskWithMeta[]
  view: ViewKey
  showList: boolean
  selectionMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}

function SectionHeader({
  label,
  count
}: {
  label: string
  count: number
}): React.ReactNode {
  return (
    <div className="task-section-header">
      <span>{label}</span>
      <span>{count}</span>
    </div>
  )
}

export function TaskList({
  tasks,
  view,
  showList,
  selectionMode = false,
  selectedIds = [],
  onToggleSelect
}: TaskListProps): React.ReactNode {
  const reorderTasks = useAppStore((state) => state.reorderTasks)
  const [collapsedCompleted, setCollapsedCompleted] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)

  const isList = view.startsWith('list:')
  const isFlatView = view === 'completed' || view === 'abandoned' || view === 'trash'

  if (isFlatView) {
    return (
      <div className={`task-list ${dragId ? 'dragging' : ''}`}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showList={showList}
            selectionMode={selectionMode}
            selected={selectedIds.includes(task.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    )
  }

  const pinned = tasks.filter((task) => task.pinned && task.status === 'open')
  const open = tasks.filter((task) => !task.pinned && task.status === 'open')
  const completed = tasks.filter((task) => task.status === 'completed')

  const handleDropOn = (targetId: string): void => {
    if (!dragId || dragId === targetId || !isList) return
    const ids = tasks.filter((task) => task.status === 'open').map((task) => task.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    void reorderTasks(view.slice(5), next)
    setDragId(null)
  }

  const rowProps = {
    showList,
    canDrag: isList && !selectionMode,
    selectionMode,
    onToggleSelect,
    onDragStart: (id: string) => setDragId(id),
    onDropOn: handleDropOn
  }

  return (
    <div className={`task-list ${dragId ? 'dragging' : ''}`}>
      {pinned.length > 0 ? (
        <section className="task-section">
          <SectionHeader label="已置顶" count={pinned.length} />
          {pinned.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              {...rowProps}
              selected={selectedIds.includes(task.id)}
            />
          ))}
        </section>
      ) : null}

      {open.length > 0 ? (
        <section className="task-section">
          {pinned.length > 0 || completed.length > 0 ? (
            <SectionHeader label="任务" count={open.length} />
          ) : null}
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              {...rowProps}
              selected={selectedIds.includes(task.id)}
            />
          ))}
        </section>
      ) : null}

      {completed.length > 0 ? (
        <section className="task-section completed-section">
          <button
            type="button"
            className="task-section-toggle"
            onClick={() => setCollapsedCompleted((value) => !value)}
            aria-expanded={!collapsedCompleted}
          >
            <Icon name={collapsedCompleted ? 'chevron-right' : 'chevron-down'} size={14} />
            <span>已完成</span>
            <span className="section-count">{completed.length}</span>
          </button>
          {!collapsedCompleted
            ? completed.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  {...rowProps}
                  canDrag={false}
                  selected={selectedIds.includes(task.id)}
                />
              ))
            : null}
        </section>
      ) : null}

      {open.length === 0 && pinned.length === 0 && completed.length > 0 ? (
        <div className="task-list-note">任务都完成了。按 Ctrl+N 添加新的任务。</div>
      ) : null}
    </div>
  )
}
