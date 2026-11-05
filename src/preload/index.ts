import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TickFlowApi } from '@shared/ipc'

const api: TickFlowApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
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
    list: () => ipcRenderer.invoke(IPC.tagsList)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  }
}

contextBridge.exposeInMainWorld('api', api)
