import type {
  AppInfo,
  ApplyTemplateInput,
  Counts,
  CreateFilterInput,
  CreateHabitInput,
  CreateListInput,
  CreateTaskInput,
  CreateTemplateInput,
  CustomFilter,
  Habit,
  HabitWithStats,
  ImportCounts,
  ListWithCount,
  PomodoroInput,
  PomodoroSession,
  Reminder,
  ReminderWithTask,
  Settings,
  StatsOverview,
  SyncResult,
  Tag,
  TaskQuery,
  TaskStatus,
  TaskWithMeta,
  Template,
  TodoList,
  UpdateHabitInput,
  UpdateListInput,
  UpdateTaskInput
} from './types'

export const IPC = {
  appInfo: 'app:info',
  appQuickAddEvent: 'app:quick-add',
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
  habitsList: 'habits:list',
  habitsCreate: 'habits:create',
  habitsUpdate: 'habits:update',
  habitsRemove: 'habits:remove',
  habitsToggle: 'habits:toggle',
  pomodoroCreate: 'pomodoro:create',
  pomodoroList: 'pomodoro:list',
  statsOverview: 'stats:overview',
  templatesList: 'templates:list',
  templatesCreate: 'templates:create',
  templatesDelete: 'templates:delete',
  templatesApply: 'templates:apply',
  templatesFromTask: 'templates:from-task',
  filtersList: 'filters:list',
  filtersCreate: 'filters:create',
  filtersDelete: 'filters:delete',
  syncTest: 'sync:test',
  syncNow: 'sync:now',
  syncResultEvent: 'sync:result',
  dataExport: 'data:export',
  dataImport: 'data:import',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

export interface TickFlowApi {
  app: {
    info(): Promise<AppInfo>
    onQuickAdd(callback: () => void): () => void
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
  habits: {
    list(): Promise<HabitWithStats[]>
    create(input: CreateHabitInput): Promise<Habit>
    update(id: string, patch: UpdateHabitInput): Promise<Habit>
    remove(id: string): Promise<void>
    toggle(habitId: string, date: string): Promise<void>
  }
  pomodoro: {
    create(input: PomodoroInput): Promise<PomodoroSession>
    list(fromIso: string, toIso: string): Promise<PomodoroSession[]>
  }
  stats: {
    overview(): Promise<StatsOverview>
  }
  templates: {
    list(): Promise<Template[]>
    create(input: CreateTemplateInput): Promise<Template>
    remove(id: string): Promise<void>
    apply(id: string, input?: ApplyTemplateInput): Promise<TaskWithMeta>
    fromTask(taskId: string, name: string): Promise<Template>
  }
  filters: {
    list(): Promise<CustomFilter[]>
    create(input: CreateFilterInput): Promise<CustomFilter>
    remove(id: string): Promise<void>
  }
  sync: {
    test(): Promise<SyncResult>
    now(): Promise<SyncResult>
    onResult(callback: (result: SyncResult) => void): () => void
  }
  data: {
    export(format: 'json' | 'csv' | 'ics'): Promise<{ canceled: boolean; path?: string }>
    importJson(): Promise<{ canceled: boolean; counts?: ImportCounts }>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
}
