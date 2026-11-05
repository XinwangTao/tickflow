import type { TaskWithMeta } from '@shared/types'
import { fromDateKey } from '@shared/dates'
import { formatDateLabel } from '../lib/format'
import { TaskCard } from './TaskCard'

interface TimelineViewProps {
  tasks: TaskWithMeta[]
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

export function TimelineView({ tasks }: TimelineViewProps): React.ReactNode {
  const groups = new Map<string, TaskWithMeta[]>()
  for (const task of tasks) {
    const key = task.dueDate ?? 'none'
    const bucket = groups.get(key) ?? []
    bucket.push(task)
    groups.set(key, bucket)
  }

  const keys = [...groups.keys()].filter((key) => key !== 'none').sort()
  if (groups.has('none')) keys.push('none')

  if (keys.length === 0) {
    return <div className="timeline-empty">暂时没有可展示的任务</div>
  }

  return (
    <div className="timeline">
      {keys.map((key) => {
        const items = groups.get(key) ?? []
        const date = key === 'none' ? null : fromDateKey(key)
        return (
          <section className="timeline-group" key={key}>
            <div className="timeline-date">
              <span className="timeline-dot" />
              <div>
                <strong>{key === 'none' ? '无日期' : formatDateLabel(key)}</strong>
                <span>
                  {date
                    ? `${date.getMonth() + 1}月${date.getDate()}日 · 周${WEEKDAY[date.getDay()]}`
                    : '未安排时间'}
                </span>
              </div>
            </div>
            <div className="timeline-items">
              {items.map((task) => (
                <TaskCard key={task.id} task={task} showList />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
