import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { aiConfigFromSettings, buildSummaryInput } from '@shared/ai'
import { todayKey } from '@shared/dates'
import type {
  ApplyTemplateInput,
  CreateFilterInput,
  CreateHabitInput,
  CreateListInput,
  CreateTaskInput,
  CreateTemplateInput,
  PomodoroInput,
  Settings,
  TaskQuery,
  TaskStatus,
  UpdateHabitInput,
  UpdateListInput,
  UpdateTaskInput
} from '@shared/types'
import { getDataDir, getDb } from './db'
import {
  addAttachment,
  openAttachment,
  removeAttachment,
  removeTaskAttachments
} from './attachments'
import {
  breakdownSubtasksWithAi,
  listAiModels,
  parseQuickAddWithAi,
  summarizeTodayWithAi,
  testAiConnection
} from './ai'
import { createManualBackup, exportData, importJson, openDataDir } from './data'
import { listAttachments } from './db/attachments'
import * as filterRepo from './db/filters'
import * as habitRepo from './db/habits'
import * as listRepo from './db/lists'
import * as pomodoroRepo from './db/pomodoro'
import * as reminderRepo from './db/reminders'
import * as settingsRepo from './db/settings'
import * as statsRepo from './db/stats'
import { syncNow, testSync } from './sync'
import * as tagRepo from './db/tags'
import * as taskRepo from './db/tasks'
import * as templateRepo from './db/templates'

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: getDataDir()
  }))

  ipcMain.on(IPC.winMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on(IPC.winToggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.winClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(IPC.winIsMaximized, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.listsList, () => listRepo.listLists(getDb()))
  ipcMain.handle(IPC.listsCreate, (_event, input: CreateListInput) =>
    listRepo.createList(getDb(), input)
  )
  ipcMain.handle(IPC.listsUpdate, (_event, id: string, patch: UpdateListInput) =>
    listRepo.updateList(getDb(), id, patch)
  )
  ipcMain.handle(IPC.listsRemove, (_event, id: string) => listRepo.deleteList(getDb(), id))
  ipcMain.handle(IPC.listsReorder, (_event, ids: string[]) => listRepo.reorderLists(getDb(), ids))

  ipcMain.handle(IPC.tasksQuery, (_event, query: TaskQuery) => taskRepo.queryTasks(getDb(), query))
  ipcMain.handle(IPC.tasksGet, (_event, id: string) => taskRepo.getTaskWithMeta(getDb(), id))
  ipcMain.handle(IPC.tasksCreate, (_event, input: CreateTaskInput) =>
    taskRepo.createTask(getDb(), input)
  )
  ipcMain.handle(IPC.tasksUpdate, (_event, id: string, patch: UpdateTaskInput) =>
    taskRepo.updateTask(getDb(), id, patch)
  )
  ipcMain.handle(IPC.tasksSetStatus, (_event, id: string, status: TaskStatus) =>
    taskRepo.setTaskStatus(getDb(), id, status)
  )
  ipcMain.handle(IPC.tasksRemove, (_event, id: string) => taskRepo.removeTask(getDb(), id))
  ipcMain.handle(IPC.tasksRestore, (_event, id: string) => taskRepo.restoreTask(getDb(), id))
  ipcMain.handle(IPC.tasksPurge, (_event, id: string) => {
    removeTaskAttachments(id)
    return taskRepo.purgeTask(getDb(), id)
  })
  ipcMain.handle(IPC.tasksReorder, (_event, listId: string, orderedIds: string[]) =>
    taskRepo.reorderTasks(getDb(), listId, orderedIds)
  )
  ipcMain.handle(IPC.tasksCounts, () => taskRepo.getCounts(getDb()))

  ipcMain.handle(IPC.tagsList, () => tagRepo.listTags(getDb()))

  ipcMain.handle(IPC.tagsUpdate, (_event, id: string, name: string) =>
    tagRepo.renameTag(getDb(), id, name)
  )
  ipcMain.handle(IPC.tagsDelete, (_event, id: string) => tagRepo.deleteTag(getDb(), id))

  ipcMain.handle(IPC.remindersList, (_event, taskId: string) =>
    reminderRepo.listReminders(getDb(), taskId)
  )
  ipcMain.handle(IPC.remindersCenter, () => reminderRepo.listReminderCenter(getDb()))
  ipcMain.handle(IPC.remindersCreate, (_event, taskId: string, triggerAt: string) =>
    reminderRepo.createReminder(getDb(), taskId, triggerAt)
  )
  ipcMain.handle(IPC.remindersRemove, (_event, id: string) =>
    reminderRepo.deleteReminder(getDb(), id)
  )

  ipcMain.handle(IPC.attachmentsList, (_event, taskId: string) =>
    listAttachments(getDb(), taskId)
  )
  ipcMain.handle(
    IPC.attachmentsAdd,
    (event, taskId: string, sourcePath?: string) =>
      addAttachment(BrowserWindow.fromWebContents(event.sender), taskId, sourcePath)
  )
  ipcMain.handle(IPC.attachmentsOpen, (_event, id: string) => openAttachment(id))
  ipcMain.handle(IPC.attachmentsRemove, (_event, id: string) => removeAttachment(id))

  ipcMain.handle(IPC.habitsList, () => habitRepo.listHabits(getDb()))
  ipcMain.handle(IPC.habitsCreate, (_event, input: CreateHabitInput) =>
    habitRepo.createHabit(getDb(), input)
  )
  ipcMain.handle(IPC.habitsUpdate, (_event, id: string, patch: UpdateHabitInput) =>
    habitRepo.updateHabit(getDb(), id, patch)
  )
  ipcMain.handle(IPC.habitsRemove, (_event, id: string) => habitRepo.deleteHabit(getDb(), id))
  ipcMain.handle(IPC.habitsToggle, (_event, habitId: string, date: string) =>
    habitRepo.toggleHabitLog(getDb(), habitId, date)
  )

  ipcMain.handle(IPC.pomodoroCreate, (_event, input: PomodoroInput) =>
    pomodoroRepo.createPomodoroSession(getDb(), input)
  )
  ipcMain.handle(IPC.pomodoroList, (_event, fromIso: string, toIso: string) =>
    pomodoroRepo.listPomodoroSessions(getDb(), fromIso, toIso)
  )

  ipcMain.handle(IPC.statsOverview, () => statsRepo.getStatsOverview(getDb()))

  ipcMain.handle(IPC.templatesList, () => templateRepo.listTemplates(getDb()))
  ipcMain.handle(IPC.templatesCreate, (_event, input: CreateTemplateInput) =>
    templateRepo.createTemplate(getDb(), input)
  )
  ipcMain.handle(IPC.templatesDelete, (_event, id: string) =>
    templateRepo.deleteTemplate(getDb(), id)
  )
  ipcMain.handle(IPC.templatesApply, (_event, id: string, input: ApplyTemplateInput) =>
    templateRepo.applyTemplate(getDb(), id, input)
  )
  ipcMain.handle(IPC.templatesFromTask, (_event, taskId: string, name: string) =>
    templateRepo.createTemplateFromTask(getDb(), taskId, name)
  )

  ipcMain.handle(IPC.filtersList, () => filterRepo.listFilters(getDb()))
  ipcMain.handle(IPC.filtersCreate, (_event, input: CreateFilterInput) =>
    filterRepo.createFilter(getDb(), input)
  )
  ipcMain.handle(IPC.filtersDelete, (_event, id: string) => filterRepo.deleteFilter(getDb(), id))

  ipcMain.handle(IPC.syncTest, () => testSync(getDb()))
  ipcMain.handle(IPC.syncNow, () => syncNow(getDb()))

  ipcMain.handle(IPC.dataExport, (event, format: 'json' | 'csv' | 'ics') =>
    exportData(getDb(), format, BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(IPC.dataImport, (event) =>
    importJson(getDb(), BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(IPC.dataOpenDir, () => openDataDir())
  ipcMain.handle(IPC.dataBackup, () => createManualBackup())

  ipcMain.handle(IPC.settingsGet, () => settingsRepo.getSettings(getDb()))
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>) =>
    settingsRepo.setSettings(getDb(), patch)
  )

  ipcMain.handle(IPC.aiQuickAdd, (_event, input: string) => {
    const db = getDb()
    return parseQuickAddWithAi(
      input,
      listRepo.listLists(db).map((list) => list.name),
      { config: aiConfigFromSettings(settingsRepo.getSettings(db)) }
    )
  })
  ipcMain.handle(IPC.aiSubtasks, (_event, taskId: string) => {
    const db = getDb()
    const task = taskRepo.getTaskWithMeta(db, taskId)
    if (!task) throw new Error('任务不存在')
    return breakdownSubtasksWithAi(
      { title: task.title, notes: task.notes, listName: task.listName },
      { config: aiConfigFromSettings(settingsRepo.getSettings(db)) }
    )
  })
  ipcMain.handle(IPC.aiSummary, () => {
    const db = getDb()
    const tasks = [
      ...taskRepo.queryTasks(db, { view: 'today' }),
      ...taskRepo.queryTasks(db, { view: 'completed' })
    ]
    return summarizeTodayWithAi(buildSummaryInput(tasks, todayKey()), {
      config: aiConfigFromSettings(settingsRepo.getSettings(db))
    })
  })
  ipcMain.handle(IPC.aiModels, () =>
    listAiModels(aiConfigFromSettings(settingsRepo.getSettings(getDb())))
  )
  ipcMain.handle(IPC.aiTest, () =>
    testAiConnection(aiConfigFromSettings(settingsRepo.getSettings(getDb())))
  )
}
