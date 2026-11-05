import type {
  AppInfo,
  Counts,
  CreateListInput,
  CreateTaskInput,
  ListWithCount,
  Reminder,
  ReminderWithTask,
  Settings,
  Tag,
  TaskQuery,
  TaskStatus,
  TaskWithMeta,
  TodoList,
  UpdateListInput,
  UpdateTaskInput
} from './types'

export const IPC = {
  appInfo: 'app:info',
  winMinimize: 'window:minimize',
  winToggleMaximize: 'window:toggle-maximize',
  winClose: 'window:close',
  winIsMaximized: 'window:is-maximized',
  winMaximizedEvent: 'window:maximized',
  listsList: 'lists:list',
  listsCreate: 'lists:create',
  listsUpdate: 'lists:update',
  listsRemove: 'lists:remove',
  listsReorder: 'lists:reorder',
  tasksQuery: 'tasks:query',
  tasksGet: 'tasks:get',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksSetStatus: 'tasks:set-status',
  tasksRemove: 'tasks:remove',
  tasksRestore: 'tasks:restore',
  tasksPurge: 'tasks:purge',
  tasksReorder: 'tasks:reorder',
  tasksCounts: 'tasks:counts',
  tagsList: 'tags:list',
  remindersList: 'reminders:list',
  remindersCreate: 'reminders:create',
  remindersRemove: 'reminders:remove',
  remindersMissedEvent: 'reminders:missed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

export interface TickFlowApi {
  app: {
    info(): Promise<AppInfo>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximized(callback: (maximized: boolean) => void): () => void
  }
  lists: {
    list(): Promise<ListWithCount[]>
    create(input: CreateListInput): Promise<TodoList>
    update(id: string, patch: UpdateListInput): Promise<TodoList>
    remove(id: string): Promise<void>
    reorder(ids: string[]): Promise<void>
  }
  tasks: {
    query(query: TaskQuery): Promise<TaskWithMeta[]>
    get(id: string): Promise<TaskWithMeta | undefined>
    create(input: CreateTaskInput): Promise<TaskWithMeta>
    update(id: string, patch: UpdateTaskInput): Promise<TaskWithMeta>
    setStatus(id: string, status: TaskStatus): Promise<TaskWithMeta>
    remove(id: string): Promise<void>
    restore(id: string): Promise<void>
    purge(id: string): Promise<void>
    reorder(listId: string, orderedIds: string[]): Promise<void>
    counts(): Promise<Counts>
  }
  tags: {
    list(): Promise<Array<Tag & { taskCount: number }>>
  }
  reminders: {
    list(taskId: string): Promise<Reminder[]>
    create(taskId: string, triggerAt: string): Promise<Reminder>
    remove(id: string): Promise<void>
    onMissed(callback: (items: ReminderWithTask[]) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
}
