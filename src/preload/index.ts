import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TickFlowApi } from '@shared/ipc'

const api: TickFlowApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    onQuickAdd: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.appQuickAddEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.appQuickAddEvent, listener)
      }
    }
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winToggleMaximize),
    close: () => ipcRenderer.send(IPC.winClose),
    isMaximized: () => ipcRenderer.invoke(IPC.winIsMaximized),
    onMaximized: (callback) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean): void => {
        callback(maximized)
      }
      ipcRenderer.on(IPC.winMaximizedEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.winMaximizedEvent, listener)
      }
    }
  },
  lists: {
    list: () => ipcRenderer.invoke(IPC.listsList),
    create: (input) => ipcRenderer.invoke(IPC.listsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.listsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.listsRemove, id),
    reorder: (ids) => ipcRenderer.invoke(IPC.listsReorder, ids)
  },
  tasks: {
    query: (query) => ipcRenderer.invoke(IPC.tasksQuery, query),
    get: (id) => ipcRenderer.invoke(IPC.tasksGet, id),
    create: (input) => ipcRenderer.invoke(IPC.tasksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.tasksUpdate, id, patch),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.tasksSetStatus, id, status),
    remove: (id) => ipcRenderer.invoke(IPC.tasksRemove, id),
    restore: (id) => ipcRenderer.invoke(IPC.tasksRestore, id),
    purge: (id) => ipcRenderer.invoke(IPC.tasksPurge, id),
    reorder: (listId, orderedIds) => ipcRenderer.invoke(IPC.tasksReorder, listId, orderedIds),
    counts: () => ipcRenderer.invoke(IPC.tasksCounts)
  },
  tags: {
    list: () => ipcRenderer.invoke(IPC.tagsList),
    update: (id, name) => ipcRenderer.invoke(IPC.tagsUpdate, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.tagsDelete, id)
  },
  reminders: {
    list: (taskId) => ipcRenderer.invoke(IPC.remindersList, taskId),
    center: () => ipcRenderer.invoke(IPC.remindersCenter),
    create: (taskId, triggerAt) => ipcRenderer.invoke(IPC.remindersCreate, taskId, triggerAt),
    remove: (id) => ipcRenderer.invoke(IPC.remindersRemove, id),
    onMissed: (callback) => {
      const listener = (_event: IpcRendererEvent, items: Parameters<typeof callback>[0]): void => {
        callback(items)
      }
      ipcRenderer.on(IPC.remindersMissedEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.remindersMissedEvent, listener)
      }
    },
    onHabitFired: (callback) => {
      const listener = (_event: IpcRendererEvent, items: Parameters<typeof callback>[0]): void => {
        callback(items)
      }
      ipcRenderer.on(IPC.remindersHabitFiredEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.remindersHabitFiredEvent, listener)
      }
    }
  },
  attachments: {
    list: (taskId) => ipcRenderer.invoke(IPC.attachmentsList, taskId),
    add: (taskId, sourcePath) =>
      ipcRenderer.invoke(IPC.attachmentsAdd, taskId, sourcePath),
    open: (id) => ipcRenderer.invoke(IPC.attachmentsOpen, id),
    remove: (id) => ipcRenderer.invoke(IPC.attachmentsRemove, id)
  },
  habits: {
    list: () => ipcRenderer.invoke(IPC.habitsList),
    create: (input) => ipcRenderer.invoke(IPC.habitsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.habitsUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.habitsRemove, id),
    toggle: (habitId, date) => ipcRenderer.invoke(IPC.habitsToggle, habitId, date)
  },
  habitReminders: {
    get: (habitId) => ipcRenderer.invoke(IPC.habitRemindersGet, habitId),
    set: (habitId, time) => ipcRenderer.invoke(IPC.habitRemindersSet, habitId, time)
  },
  pomodoro: {
    create: (input) => ipcRenderer.invoke(IPC.pomodoroCreate, input),
    list: (fromIso, toIso) => ipcRenderer.invoke(IPC.pomodoroList, fromIso, toIso)
  },
  stats: {
    overview: () => ipcRenderer.invoke(IPC.statsOverview)
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    create: (input) => ipcRenderer.invoke(IPC.templatesCreate, input),
    remove: (id) => ipcRenderer.invoke(IPC.templatesDelete, id),
    apply: (id, input) => ipcRenderer.invoke(IPC.templatesApply, id, input),
    fromTask: (taskId, name) => ipcRenderer.invoke(IPC.templatesFromTask, taskId, name)
  },
  filters: {
    list: () => ipcRenderer.invoke(IPC.filtersList),
    create: (input) => ipcRenderer.invoke(IPC.filtersCreate, input),
    remove: (id) => ipcRenderer.invoke(IPC.filtersDelete, id)
  },
  sync: {
    test: () => ipcRenderer.invoke(IPC.syncTest),
    now: () => ipcRenderer.invoke(IPC.syncNow),
    usage: () => ipcRenderer.invoke(IPC.syncUsage),
    onResult: (callback) => {
      const listener = (
        _event: IpcRendererEvent,
        result: Parameters<typeof callback>[0]
      ): void => {
        callback(result)
      }
      ipcRenderer.on(IPC.syncResultEvent, listener)
      return () => {
        ipcRenderer.removeListener(IPC.syncResultEvent, listener)
      }
    }
  },
  data: {
    export: (format) => ipcRenderer.invoke(IPC.dataExport, format),
    importJson: () => ipcRenderer.invoke(IPC.dataImport),
    openDir: () => ipcRenderer.invoke(IPC.dataOpenDir),
    openBackupDir: () => ipcRenderer.invoke(IPC.dataOpenBackupDir),
    backup: () => ipcRenderer.invoke(IPC.dataBackup),
    verifyBackup: () => ipcRenderer.invoke(IPC.dataVerifyBackup),
    verifyAllBackups: () => ipcRenderer.invoke(IPC.dataVerifyAllBackups),
    restoreBackup: () => ipcRenderer.invoke(IPC.dataRestoreBackup)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  ai: {
    parseQuickAdd: (input, requestId, defaultDate) =>
      ipcRenderer.invoke(IPC.aiQuickAdd, input, requestId, defaultDate),
    cancel: (requestId) => ipcRenderer.invoke(IPC.aiCancel, requestId),
    breakdownSubtasks: (taskId, requestId) =>
      ipcRenderer.invoke(IPC.aiSubtasks, taskId, requestId),
    dailySummary: (requestId) => ipcRenderer.invoke(IPC.aiSummary, requestId),
    weeklyReview: (input, requestId) => ipcRenderer.invoke(IPC.aiWeekly, input, requestId),
    models: (requestId?: string) => ipcRenderer.invoke(IPC.aiModels, requestId),
    test: () => ipcRenderer.invoke(IPC.aiTest),
    transcribe: (audio: ArrayBuffer, requestId?: string) =>
      ipcRenderer.invoke(IPC.aiTranscribe, audio, requestId),
    asrStatus: () => ipcRenderer.invoke(IPC.aiAsrStatus)
  }
}

contextBridge.exposeInMainWorld('api', api)
