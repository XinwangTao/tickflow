import type { TaskWithMeta } from '@shared/types'
import { todayKey } from '@shared/dates'
import { TaskCard } from './TaskCard'

interface MatrixViewProps {
  tasks: TaskWithMeta[]
}

const QUADRANTS = [
  {
    key: 'q1',
    title: '重要且紧急',
    hint: '优先处理',
    important: true,
    urgent: true
  },
  {
    key: 'q2',
    title: '重要不紧急',
    hint: '安排时间',
    important: true,
    urgent: false
  },
  {
    key: 'q3',
    title: '紧急不重要',
    hint: '快速处理或委托',
    important: false,
    urgent: true
  },
  {
    key: 'q4',
    title: '不紧急不重要',
    hint: '有空再做',
    important: false,
    urgent: false
  }
] as const

export function MatrixView({ tasks }: MatrixViewProps): React.ReactNode {
  const today = todayKey()

  return (
    <div className="matrix">
      {QUADRANTS.map((quadrant) => {
        const items = tasks.filter((task) => {
          const important = task.priority >= 2
          const urgent = task.dueDate != null && task.dueDate <= today
          return important === quadrant.important && urgent === quadrant.urgent
        })
        return (
          <section className={`matrix-quadrant ${quadrant.key}`} key={quadrant.key}>
            <header className="matrix-header">
              <div>
                <h2>{quadrant.title}</h2>
                <span>{quadrant.hint}</span>
              </div>
              <strong>{items.length}</strong>
            </header>
            <div className="matrix-body">
              {items.length === 0 ? (
                <div className="matrix-empty">暂无任务</div>
              ) : (
                items.map((task) => <TaskCard key={task.id} task={task} showList />)
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
