export type Priority = 0 | 1 | 2 | 3

/** 桌面与 Android 共用的固定收集箱 ID，避免同步后出现两个收集箱。 */
export const INBOX_ID = '00000000-0000-7000-8000-000000000001'

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
  autoLaunch: boolean
  startMinimized: boolean
  fontScale: number
  r2Endpoint: string
  r2Bucket: string
  r2AccessKeyId: string
  r2SecretAccessKey: string
  r2Prefix: string
  r2AutoSync: boolean
  r2LastSync: string | null
  /** 最近一次后台同步失败原因；成功时清空。 */
  r2LastError?: string
  aiEnabled: boolean
  aiBaseUrl: string
  aiModel: string
  aiToken: string
  /** 离线语音识别：vosk 运行时与模型目录，留空则用自动探测。 */
  asrPython?: string
  asrModel?: string
  aiTimeoutMs: number
}

export interface SyncResult {
  ok: boolean
  message: string
  downloaded?: number
  bytes?: number
  updatedAt?: string
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
  | 'habits'
  | 'pomodoro'
  | 'stats'
  | 'templates'
  | `filter:${string}`
  | `list:${string}`

export type ListMode = 'list' | 'board' | 'timeline'

export type TaskQuery =
  | { view: 'today' | 'next7' | 'inbox' | 'completed' | 'abandoned' | 'trash' | 'all' }
  | { view: 'list'; listId: string; includeCompleted?: boolean }
  | { view: 'search'; q: string }
  | { view: 'subtasks'; parentId: string }
  | { view: 'filter'; filter: FilterQuery }

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

export interface HabitReminder {
  id: string
  habitId: string
  triggerAt: string
  enabled: boolean
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface HabitReminderWithHabit extends HabitReminder {
  habitName: string
  habitColor: string
}

export interface ReminderCenterData {
  upcoming: ReminderWithTask[]
  recent: ReminderWithTask[]
  habitUpcoming: HabitReminderWithHabit[]
  habitRecent: HabitReminderWithHabit[]
}

export interface Attachment {
  id: string
  taskId: string
  name: string
  storedName: string
  size: number
  mime: string
  createdAt: string
}

export type HabitFrequency = 'daily' | 'weekly'

export interface Habit {
  id: string
  name: string
  icon: string | null
  color: string
  frequency: HabitFrequency
  targetPerWeek: number
  archived: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface HabitLog {
  id: string
  habitId: string
  logDate: string
  value: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface HabitWithStats extends Habit {
  logs: HabitLog[]
  currentStreak: number
  longestStreak: number
  weekCount: number
}

export interface CreateHabitInput {
  name: string
  icon?: string | null
  color?: string
  frequency?: HabitFrequency
  targetPerWeek?: number
}

export interface UpdateHabitInput {
  name?: string
  icon?: string | null
  color?: string
  frequency?: HabitFrequency
  targetPerWeek?: number
  archived?: boolean
}

export type PomodoroMode = 'focus' | 'break'

export interface PomodoroSession {
  id: string
  taskId: string | null
  mode: PomodoroMode
  durationMinutes: number
  startedAt: string
  endedAt: string
  completed: boolean
  createdAt: string
}

export interface PomodoroInput {
  taskId?: string | null
  mode: PomodoroMode
  durationMinutes: number
  startedAt: string
  endedAt: string
  completed?: boolean
}

export interface StatsOverview {
  tasksCompleted7d: number
  tasksCompleted30d: number
  tasksCreated7d: number
  overdue: number
  completedByDay: Array<{ date: string; count: number }>
  byPriority: Array<{ priority: number; count: number }>
  byList: Array<{ listId: string; name: string; color: string; count: number }>
  focusMinutes7d: number
  focusSessions7d: number
  focusByDay: Array<{ date: string; minutes: number }>
  habitCheckins7d: number
  habitByDay: Array<{ date: string; count: number }>
  topHabits: Array<{ id: string; name: string; color: string; count: number }>
}

export interface ImportCounts {
  lists: number
  tasks: number
  tags: number
  habits: number
  logs: number
  sessions: number
}

export interface TemplatePayload {
  title: string
  notes: string
  priority: Priority
  tagNames: string[]
  listId: string | null
  dueTime: string | null
  allDay: boolean
}

export interface Template {
  id: string
  name: string
  payload: TemplatePayload
  createdAt: string
  updatedAt: string
}

export interface CreateTemplateInput {
  name: string
  payload: TemplatePayload
}

export interface ApplyTemplateInput {
  listId?: string | null
  dueDate?: string | null
}

export type FilterStatus = 'open' | 'completed' | 'abandoned' | 'all'

export type FilterDue = 'any' | 'today' | 'overdue' | 'next7' | 'no_date'

export interface FilterQuery {
  listId: string | null
  status: FilterStatus
  priority: Priority | null
  tag: string | null
  due: FilterDue
}

export interface CustomFilter {
  id: string
  name: string
  query: FilterQuery
  createdAt: string
  updatedAt: string
}

export interface CreateFilterInput {
  name: string
  query: FilterQuery
}

export type SortBy = 'default' | 'due' | 'priority' | 'created' | 'title'

export type GroupBy = 'none' | 'list' | 'priority' | 'date'
