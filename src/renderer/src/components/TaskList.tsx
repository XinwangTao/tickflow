import { useState } from 'react'
import type { GroupBy, SortBy, TaskWithMeta, ViewKey } from '@shared/types'
import { PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { TaskRow } from './TaskRow'

interface TaskListProps {
  tasks: TaskWithMeta[]
  view: ViewKey
  showList: boolean
  sortBy?: SortBy
  groupBy?: GroupBy
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

function sortTasks(rows: TaskWithMeta[], sortBy: SortBy): TaskWithMeta[] {
  const copy = [...rows]
  switch (sortBy) {
    case 'due':
      copy.sort(
        (a, b) =>
          (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
          (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
          b.priority - a.priority ||
          b.createdAt.localeCompare(a.createdAt)
      )
      break
    case 'priority':
      copy.sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
          b.createdAt.localeCompare(a.createdAt)
      )
      break
    case 'created':
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    case 'title':
      copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
      break
    default:
      break
  }
  return copy
}

function groupTasks(
  rows: TaskWithMeta[],
  groupBy: GroupBy,
  sortBy: SortBy
): Array<{ key: string; label: string; rows: TaskWithMeta[] }> {
  if (groupBy === 'none') return []
  if (groupBy === 'priority') {
    return [3, 2, 1, 0]
      .map((priority) => ({
        key: `p-${priority}`,
        label: `${PRIORITY_LABELS[priority]}优先级`,
        rows: sortTasks(
          rows.filter((task) => task.priority === priority),
          sortBy
        )
      }))
      .filter((group) => group.rows.length > 0)
  }
  const map = new Map<string, TaskWithMeta[]>()
  for (const task of rows) {
    const bucket = map.get(task.listName) ?? []
    bucket.push(task)
    map.set(task.listName, bucket)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
    .map(([label, groupRows]) => ({
      key: `l-${label}`,
      label,
      rows: sortTasks(groupRows, sortBy)
    }))
}

export function TaskList({
  tasks,
  view,
  showList,
  sortBy = 'default',
  groupBy = 'none',
  selectionMode = false,
  selectedIds = [],
  onToggleSelect
}: TaskListProps): React.ReactNode {
  const reorderTasks = useAppStore((state) => state.reorderTasks)
  const [collapsedCompleted, setCollapsedCompleted] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)

  const isList = view.startsWith('list:')
  const isFlatView = view === 'completed' || view === 'abandoned' || view === 'trash'
  const canReorder = isList && !selectionMode && sortBy === 'default' && groupBy === 'none'

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

  const open = tasks.filter((task) => task.status === 'open')
  const pinned = sortTasks(
    open.filter((task) => task.pinned),
    sortBy
  )
  const rest = sortTasks(
    open.filter((task) => !task.pinned),
    sortBy
  )
  const completed = tasks.filter((task) => task.status === 'completed')
  const groups = groupTasks(open, groupBy, sortBy)

  const handleDropOn = (targetId: string): void => {
    if (!dragId || dragId === targetId || !isList || !canReorder) return
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
    canDrag: canReorder,
    selectionMode,
    onToggleSelect,
    onDragStart: (id: string) => setDragId(id),
    onDropOn: handleDropOn
  }

  return (
    <div className={`task-list ${dragId ? 'dragging' : ''}`}>
      {groupBy !== 'none' ? (
        groups.map((group) => (
          <section className="task-section" key={group.key}>
            <SectionHeader label={group.label} count={group.rows.length} />
            {group.rows.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                {...rowProps}
                canDrag={false}
                selected={selectedIds.includes(task.id)}
              />
            ))}
          </section>
        ))
      ) : (
        <>
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

          {rest.length > 0 ? (
            <section className="task-section">
              {pinned.length > 0 || completed.length > 0 ? (
                <SectionHeader label="任务" count={rest.length} />
              ) : null}
              {rest.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  {...rowProps}
                  selected={selectedIds.includes(task.id)}
                />
              ))}
            </section>
          ) : null}
        </>
      )}

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

      {open.length === 0 && completed.length > 0 ? (
        <div className="task-list-note">任务都完成了。按 Ctrl+N 添加新的任务。</div>
      ) : null}
    </div>
  )
}
