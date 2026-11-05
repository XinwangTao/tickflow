import { useState } from 'react'
import type { ListWithCount, TaskWithMeta } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { TaskCard } from './TaskCard'

interface BoardViewProps {
  tasks: TaskWithMeta[]
  lists: ListWithCount[]
}

export function BoardView({ tasks, lists }: BoardViewProps): React.ReactNode {
  const updateTask = useAppStore((state) => state.updateTask)
  const [dragOver, setDragOver] = useState<string | null>(null)

  return (
    <div className="board">
      {lists.map((list) => {
        const items = tasks.filter((task) => task.listId === list.id)
        return (
          <section
            className={`board-column ${dragOver === list.id ? 'drop' : ''}`}
            key={list.id}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(list.id)
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(null)
              const taskId = event.dataTransfer.getData('text/plain')
              if (taskId) void updateTask(taskId, { listId: list.id })
            }}
          >
            <header className="board-column-header">
              <span className="list-dot" style={{ background: list.color }} />
              <span className="board-column-name">{list.name}</span>
              <span className="board-column-count">{items.length}</span>
            </header>
            <div className="board-column-body">
              {items.length === 0 ? (
                <div className="board-empty">拖到这里</div>
              ) : (
                items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    draggable
                    onDragStart={() => setDragOver(null)}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
