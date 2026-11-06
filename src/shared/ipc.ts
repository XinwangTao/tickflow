import type {
  AiModelsResult,
  AiQuickAddResponse,
  AiSubtasksResponse,
  AiSummaryResponse,
  AiTestResult
} from './ai'
import type { AsrEnvironment, VoiceTranscribeResult } from './voice'
import type {
  AppInfo,
  ApplyTemplateInput,
  Attachment,
  Counts,
  CreateFilterInput,
  CreateHabitInput,
  CreateListInput,
  CreateTaskInput,
  CreateTemplateInput,
  CustomFilter,
  Habit,
  HabitReminder,
  HabitReminderWithHabit,
  HabitWithStats,
  ImportCounts,
  ListWithCount,
  PomodoroInput,
  PomodoroSession,
  Reminder,
  ReminderCenterData,
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
  tagsUpdate: 'tags:update',
  tagsDelete: 'tags:delete',
  remindersList: 'reminders:list',
  remindersCenter: 'reminders:center',
  remindersCreate: 'reminders:create',
  remindersRemove: 'reminders:remove',
  remindersMissedEvent: 'reminders:missed',
  remindersHabitFiredEvent: 'reminders:habits-fired',
  attachmentsList: 'attachments:list',
  attachmentsAdd: 'attachments:add',
  attachmentsOpen: 'attachments:open',
  attachmentsRemove: 'attachments:remove',
  habitsList: 'habits:list',
  habitsCreate: 'habits:create',
  habitsUpdate: 'habits:update',
  habitsRemove: 'habits:remove',
  habitsToggle: 'habits:toggle',
  habitRemindersGet: 'habit-reminders:get',
  habitRemindersSet: 'habit-reminders:set',
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
  syncUsage: 'sync:usage',
  syncResultEvent: 'sync:result',
  dataExport: 'data:export',
  dataImport: 'data:import',
  dataOpenDir: 'data:open-dir',
  dataOpenBackupDir: 'data:open-backup-dir',
  dataBackup: 'data:backup',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  aiQuickAdd: 'ai:quick-add',
  aiCancel: 'ai:cancel',
  aiSubtasks: 'ai:subtasks',
  aiSummary: 'ai:summary',
  aiModels: 'ai:models',
  aiTest: 'ai:test',
  aiTranscribe: 'ai:transcribe',
  aiAsrStatus: 'ai:asr-status'
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
    update(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
  }
  reminders: {
    list(taskId: string): Promise<Reminder[]>
    center(): Promise<ReminderCenterData>
    create(taskId: string, triggerAt: string): Promise<Reminder>
    remove(id: string): Promise<void>
    onMissed(callback: (items: ReminderWithTask[]) => void): () => void
    onHabitFired(callback: (items: HabitReminderWithHabit[]) => void): () => void
  }
  attachments: {
    list(taskId: string): Promise<Attachment[]>
    add(taskId: string, sourcePath?: string): Promise<Attachment | null>
    open(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
  habits: {
    list(): Promise<HabitWithStats[]>
    create(input: CreateHabitInput): Promise<Habit>
    update(id: string, patch: UpdateHabitInput): Promise<Habit>
    remove(id: string): Promise<void>
    toggle(habitId: string, date: string): Promise<void>
  }
  habitReminders: {
    get(habitId: string): Promise<HabitReminder | null>
    set(habitId: string, time: string | null): Promise<HabitReminder | null>
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
    usage(): Promise<{ objects: number; bytes: number }>
    onResult(callback: (result: SyncResult) => void): () => void
  }
  data: {
    export(format: 'json' | 'csv' | 'ics'): Promise<{ canceled: boolean; path?: string }>
    importJson(): Promise<{ canceled: boolean; counts?: ImportCounts }>
    openDir(): Promise<string>
    openBackupDir(): Promise<string>
    backup(): Promise<string>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  ai: {
    /** requestId 用于在响应迟到时判断是否已过期；也可用 `cancel(requestId)` 中止。 */
    parseQuickAdd(input: string, requestId?: string): Promise<AiQuickAddResponse>
    /** 中止某个进行中的 AI 请求，返回 false 表示它已经结束或不存在。 */
    cancel(requestId: string): Promise<boolean>
    breakdownSubtasks(taskId: string, requestId?: string): Promise<AiSubtasksResponse>
    /** requestId 同样可传给 `cancel`，用于在超时前主动中止总结或拆解。 */
    dailySummary(requestId?: string): Promise<AiSummaryResponse>
    models(requestId?: string): Promise<AiModelsResult>
    test(): Promise<AiTestResult>
    /** 离线语音转写：传入录音字节，返回识别文本（失败时给一句人话）。 */
    transcribe(audio: ArrayBuffer, requestId?: string): Promise<VoiceTranscribeResult>
    /** 检查本机是否具备 python / vosk 模型 / 转写脚本，供设置页诊断。 */
    asrStatus(): Promise<AsrEnvironment>
  }
}
