import { useState } from 'react'
import type {
  GroupBy,
  ListWithCount,
  Priority,
  TaskWithMeta
} from '@shared/types'
import { buildDateGroups } from '@shared/task-groups'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { TaskCard } from './TaskCard'

interface BoardViewProps {
  tasks: TaskWithMeta[]
  lists: ListWithCount[]
  groupBy: GroupBy
}

interface BoardColumn {
  key: string
  label: string
  color: string
  items: TaskWithMeta[]
  apply: (taskId: string) => void
}

export function BoardView({ tasks, lists, groupBy }: BoardViewProps): React.ReactNode {
  const updateTask = useAppStore((state) => state.updateTask)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const columns: BoardColumn[] =
    groupBy === 'priority'
      ? [3, 2, 1, 0].map((priority) => ({
          key: `priority-${priority}`,
          label: `${PRIORITY_LABELS[priority]}优先级`,
          color: PRIORITY_COLORS[priority],
          items: tasks.filter((task) => task.priority === priority),
          apply: (taskId) =>
            void updateTask(taskId, { priority: priority as Priority })
        }))
      : groupBy === 'date'
        ? buildDateGroups().map((group) => ({
            key: `date-${group.key}`,
            label: group.label,
            color: group.color,
            items: tasks.filter((task) => group.matches(task)),
            apply: (taskId) =>
              void updateTask(taskId, { dueDate: group.dueDate, allDay: true })
          }))
        : lists.map((list) => ({
            key: list.id,
            label: list.name,
            color: list.color,
            items: tasks.filter((task) => task.listId === list.id),
            apply: (taskId) => void updateTask(taskId, { listId: list.id })
          }))

  return (
    <div className="board">
      {columns.map((column) => (
        <section
          className={`board-column ${dragOver === column.key ? 'drop' : ''}`}
          key={column.key}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(column.key)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(null)
            const taskId = event.dataTransfer.getData('text/plain')
            if (taskId) column.apply(taskId)
          }}
        >
          <header className="board-column-header">
            <span className="list-dot" style={{ background: column.color }} />
            <span className="board-column-name">{column.label}</span>
            <span className="board-column-count">{column.items.length}</span>
          </header>
          <div className="board-column-body">
            {column.items.length === 0 ? (
              <div className="board-empty">拖到这里</div>
            ) : (
              column.items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  showList={groupBy === 'priority' || groupBy === 'date'}
                  draggable
                  onDragStart={() => setDragOver(null)}
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
