import { addDaysToKey, startOfWeekKey, todayKey } from './dates'

export interface DateTaskGroup {
  key: string
  label: string
  color: string
  dueDate: string | null
  matches: (task: { dueDate: string | null }) => boolean
}

export function buildDateGroups(today: string = todayKey()): DateTaskGroup[] {
  const tomorrow = addDaysToKey(today, 1)
  const weekEnd = addDaysToKey(startOfWeekKey(today, 1), 6)
  const weekTarget = weekEnd < tomorrow ? addDaysToKey(today, 7) : weekEnd

  return [
    {
      key: 'today',
      label: '今天',
      color: '#f5c542',
      dueDate: today,
      matches: (task) => task.dueDate != null && task.dueDate <= today
    },
    {
      key: 'tomorrow',
      label: '明天',
      color: '#4c9aff',
      dueDate: tomorrow,
      matches: (task) => task.dueDate === tomorrow
    },
    {
      key: 'week',
      label: '本周',
      color: '#30a46c',
      dueDate: weekTarget,
      matches: (task) =>
        task.dueDate != null && task.dueDate > tomorrow && task.dueDate <= weekTarget
    },
    {
      key: 'later',
      label: '以后',
      color: '#a855f7',
      dueDate: addDaysToKey(today, 14),
      matches: (task) => task.dueDate != null && task.dueDate > weekTarget
    },
    {
      key: 'none',
      label: '无日期',
      color: '#858b96',
      dueDate: null,
      matches: (task) => task.dueDate == null
    }
  ]
}
