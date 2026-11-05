export type Priority = 0 | 1 | 2 | 3

export type TaskStatus = 'open' | 'completed' | 'abandoned'

export interface TodoList {
  id: string
  name: string
  color: string
  emoji: string | null
  sortOrder: number
  isInbox: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Tag {
  id: string
  name: string
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  listId: string
  parentId: string | null
  title: string
  notes: string
  status: TaskStatus
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  allDay: boolean
  startDate: string | null
  recurrence: string | null
  pinned: boolean
  sortOrder: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  tags: Tag[]
}

export interface TaskWithMeta extends Task {
  listName: string
  listColor: string
  listEmoji: string | null
  subtaskCount: number
  subtaskDone: number
}

export interface ListWithCount extends TodoList {
  openCount: number
}

export interface Counts {
  inbox: number
  today: number
  next7: number
  completed: number
  abandoned: number
  trash: number
  lists: Record<string, number>
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  accent: string
  weekStart: 0 | 1
  defaultListId: string | null
  showCompleted: boolean
  fontScale: number
}

export type ViewKey =
  | 'today'
  | 'next7'
  | 'inbox'
  | 'completed'
  | 'abandoned'
  | 'trash'
  | 'calendar'
  | 'matrix'
  | `list:${string}`

export type ListMode = 'list' | 'board' | 'timeline'

export type TaskQuery =
  | { view: 'today' | 'next7' | 'inbox' | 'completed' | 'abandoned' | 'trash' | 'all' }
  | { view: 'list'; listId: string; includeCompleted?: boolean }
  | { view: 'search'; q: string }
  | { view: 'subtasks'; parentId: string }

export interface CreateListInput {
  name: string
  color?: string
  emoji?: string | null
}

export interface UpdateListInput {
  name?: string
  color?: string
  emoji?: string | null
  sortOrder?: number
}

export interface CreateTaskInput {
  listId: string
  parentId?: string | null
  title: string
  notes?: string
  priority?: Priority
  dueDate?: string | null
  dueTime?: string | null
  allDay?: boolean
  startDate?: string | null
  recurrence?: string | null
  tagNames?: string[]
  pinned?: boolean
}

export interface UpdateTaskInput {
  title?: string
  notes?: string
  listId?: string
  priority?: Priority
  dueDate?: string | null
  dueTime?: string | null
  allDay?: boolean
  startDate?: string | null
  recurrence?: string | null
  tagNames?: string[]
  pinned?: boolean
  sortOrder?: number
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
}

export interface Reminder {
  id: string
  taskId: string
  triggerAt: string
  sentAt: string | null
  createdAt: string
}

export interface ReminderWithTask extends Reminder {
  taskTitle: string
}
