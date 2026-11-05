import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  CreateListInput,
  CreateTaskInput,
  Settings,
  TaskQuery,
  TaskStatus,
  UpdateListInput,
  UpdateTaskInput
} from '@shared/types'
import { getDataDir, getDb } from './db'
import * as listRepo from './db/lists'
import * as reminderRepo from './db/reminders'
import * as settingsRepo from './db/settings'
import * as tagRepo from './db/tags'
import * as taskRepo from './db/tasks'

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
  ipcMain.handle(IPC.tasksPurge, (_event, id: string) => taskRepo.purgeTask(getDb(), id))
  ipcMain.handle(IPC.tasksReorder, (_event, listId: string, orderedIds: string[]) =>
    taskRepo.reorderTasks(getDb(), listId, orderedIds)
  )
  ipcMain.handle(IPC.tasksCounts, () => taskRepo.getCounts(getDb()))

  ipcMain.handle(IPC.tagsList, () => tagRepo.listTags(getDb()))

  ipcMain.handle(IPC.remindersList, (_event, taskId: string) =>
    reminderRepo.listReminders(getDb(), taskId)
  )
  ipcMain.handle(IPC.remindersCreate, (_event, taskId: string, triggerAt: string) =>
    reminderRepo.createReminder(getDb(), taskId, triggerAt)
  )
  ipcMain.handle(IPC.remindersRemove, (_event, id: string) =>
    reminderRepo.deleteReminder(getDb(), id)
  )

  ipcMain.handle(IPC.settingsGet, () => settingsRepo.getSettings(getDb()))
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>) =>
    settingsRepo.setSettings(getDb(), patch)
  )
}
