import { create } from 'zustand'
import type {
  Counts,
  CreateTaskInput,
  CustomFilter,
  FilterQuery,
  GroupBy,
  ListMode,
  ListWithCount,
  Priority,
  Settings,
  SortBy,
  Tag,
  TaskQuery,
  TaskWithMeta,
  UpdateListInput,
  UpdateTaskInput,
  ViewKey
} from '@shared/types'
import { toDateKey } from '@shared/dates'
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS
} from '@shared/ai'

interface ToastOptions {
  actionLabel?: string
  action?: () => void | Promise<void>
  duration?: number
}

interface ToastState extends ToastOptions {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

type SimpleView = 'today' | 'next7' | 'inbox' | 'completed' | 'abandoned' | 'trash' | 'all'

function queryFor(
  view: ViewKey,
  settings: Settings,
  filters: CustomFilter[]
): TaskQuery {
  if (view.startsWith('list:')) {
    return { view: 'list', listId: view.slice(5), includeCompleted: settings.showCompleted }
  }
  if (view.startsWith('filter:')) {
    const filter = filters.find((item) => item.id === view.slice(7))
    return filter ? { view: 'filter', filter: filter.query } : { view: 'all' }
  }
  if (view === 'calendar' || view === 'matrix' || view === 'templates') {
    return { view: 'all' }
  }
  return { view: view as SimpleView }
}

interface AppState {
  ready: boolean
  bootError: string | null
  lists: ListWithCount[]
  tags: Array<Tag & { taskCount: number }>
  filters: CustomFilter[]
  counts: Counts
  settings: Settings
  view: ViewKey
  tasks: TaskWithMeta[]
  loading: boolean
  listMode: ListMode
  sortBy: SortBy
  groupBy: GroupBy
  calendarMonth: string
  selectionMode: boolean
  selectedIds: string[]
  detailId: string | null
  detailTask: TaskWithMeta | null
  searchOpen: boolean
  searchSeed: string
  settingsOpen: boolean
  newListOpen: boolean
  quickAddFocus: number
  toast: ToastState | null

  bootstrap: () => Promise<void>
  selectView: (view: ViewKey) => Promise<void>
  refresh: () => Promise<void>
  setListMode: (mode: ListMode) => void
  setSortBy: (sort: SortBy) => void
  setGroupBy: (group: GroupBy) => void
  reorderLists: (ids: string[]) => Promise<void>
  shiftCalendarMonth: (delta: number) => void
  setCalendarMonth: (month: string) => void
  setSelectionMode: (enabled: boolean) => void
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  createList: (name: string, color: string, emoji?: string | null) => Promise<void>
  updateList: (id: string, patch: UpdateListInput) => Promise<void>
  deleteList: (id: string) => Promise<void>
  renameTag: (id: string, name: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  createFilter: (name: string, query: FilterQuery) => Promise<void>
  deleteFilter: (id: string) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<TaskWithMeta | null>
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<void>
  toggleTask: (task: TaskWithMeta) => Promise<void>
  removeTask: (id: string) => Promise<void>
  restoreTask: (id: string) => Promise<void>
  purgeTask: (id: string) => Promise<void>
  reorderTasks: (listId: string, orderedIds: string[]) => Promise<void>
  batchComplete: () => Promise<void>
  batchDelete: () => Promise<void>
  batchMove: (listId: string) => Promise<void>
  batchPriority: (priority: Priority) => Promise<void>
  batchDueDate: (dueDate: string | null) => Promise<void>
  openDetail: (id: string | null) => void
  setSearchOpen: (open: boolean, seed?: string) => void
  setSettingsOpen: (open: boolean) => void
  setNewListOpen: (open: boolean) => void
  focusQuickAdd: () => void
  setSettings: (patch: Partial<Settings>) => Promise<void>
  showToast: (message: string, kind?: ToastState['kind'], options?: ToastOptions) => void
  clearToast: () => void
}

const EMPTY_COUNTS: Counts = {
  inbox: 0,
  today: 0,
  next7: 0,
  completed: 0,
  abandoned: 0,
  trash: 0,
  lists: {}
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: null,
  showCompleted: false,
  autoLaunch: false,
  startMinimized: false,
  fontScale: 1,
  r2Endpoint: '',
  r2Bucket: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2Prefix: 'tickflow/snapshots/',
  r2AutoSync: false,
  r2LastSync: null,
  aiEnabled: true,
  aiBaseUrl: AI_DEFAULT_BASE_URL,
  aiModel: AI_DEFAULT_MODEL,
  aiToken: '',
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function currentMonth(): string {
  return toDateKey(new Date()).slice(0, 7)
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  lists: [],
  tags: [],
  filters: [],
  counts: EMPTY_COUNTS,
  settings: DEFAULT_SETTINGS,
  view: 'today',
  tasks: [],
  loading: false,
  listMode: 'list',
  sortBy: 'default',
  groupBy: 'none',
  calendarMonth: currentMonth(),
  selectionMode: false,
  selectedIds: [],
  detailId: null,
  detailTask: null,
  searchOpen: false,
  searchSeed: '',
  settingsOpen: false,
  newListOpen: false,
  quickAddFocus: 0,
  toast: null,

  bootstrap: async () => {
    try {
      const [lists, settings, counts, tags, filters] = await Promise.all([
        window.api.lists.list(),
        window.api.settings.get(),
        window.api.tasks.counts(),
        window.api.tags.list(),
        window.api.filters.list()
      ])
      set({ lists, settings, counts, tags, filters })

      const initial: ViewKey =
        settings.defaultListId && lists.some((list) => list.id === settings.defaultListId)
          ? `list:${settings.defaultListId}`
          : 'today'
      await get().selectView(initial)
      set({ ready: true })
    } catch (error) {
      set({ bootError: errorMessage(error), ready: true })
    }
  },

  selectView: async (view) => {
    if (
      view === 'habits' ||
      view === 'pomodoro' ||
      view === 'stats' ||
      view === 'templates'
    ) {
      set({
        view,
        loading: false,
        tasks: [],
        selectionMode: false,
        selectedIds: []
      })
      return
    }
    set({
      view,
      loading: true,
      selectionMode: false,
      selectedIds: []
    })
    try {
      const tasks = await window.api.tasks.query(
        queryFor(view, get().settings, get().filters)
      )
      set({ tasks, loading: false })
    } catch (error) {
      set({ loading: false })
      get().showToast(errorMessage(error), 'error')
    }
  },

  refresh: async () => {
    const { view, settings, filters } = get()
    try {
      const [tasks, lists, counts, tags, nextFilters] = await Promise.all([
        window.api.tasks.query(queryFor(view, settings, filters)),
        window.api.lists.list(),
        window.api.tasks.counts(),
        window.api.tags.list(),
        window.api.filters.list()
      ])
      set({ tasks, lists, counts, tags, filters: nextFilters })
      if (get().detailId) {
        const task = await window.api.tasks.get(get().detailId as string)
        set({ detailTask: task ?? null })
      }
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  setListMode: (mode) => set({ listMode: mode }),
  setSortBy: (sort) => set({ sortBy: sort }),
  setGroupBy: (group) => set({ groupBy: group }),

  reorderLists: async (ids) => {
    try {
      await window.api.lists.reorder(ids)
      await get().refresh()
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  shiftCalendarMonth: (delta) => {
    const [year, month] = get().calendarMonth.split('-').map(Number)
    const date = new Date(year, month - 1 + delta, 1)
    set({
      calendarMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    })
  },

  setCalendarMonth: (month) => set({ calendarMonth: month }),

  setSelectionMode: (enabled) =>
    set({ selectionMode: enabled, selectedIds: enabled ? get().selectedIds : [] }),

  toggleSelection: (id) => {
    const ids = get().selectedIds
    set({
      selectedIds: ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    })
  },

  selectAll: (ids) => set({ selectedIds: Array.from(new Set(ids)) }),

  clearSelection: () => set({ selectionMode: false, selectedIds: [] }),

  createList: async (name, color, emoji = null) => {
    try {
      const list = await window.api.lists.create({ name, color, emoji })
      await get().refresh()
      await get().selectView(`list:${list.id}`)
      get().showToast(`已创建清单「${list.name}」`, 'success')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  updateList: async (id, patch) => {
    try {
      await window.api.lists.update(id, patch)
      await get().refresh()
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  deleteList: async (id) => {
    try {
      await window.api.lists.remove(id)
      if (get().view === `list:${id}`) {
        await get().selectView('today')
      }
      await get().refresh()
      get().showToast('清单已移入垃圾箱', 'info')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  renameTag: async (id, name) => {
    try {
      await window.api.tags.update(id, name)
      await get().refresh()
      get().showToast(`标签已重命名为「${name.trim()}」`, 'success')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  deleteTag: async (id) => {
    try {
      await window.api.tags.remove(id)
      await get().refresh()
      get().showToast('标签已删除', 'info')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  createFilter: async (name, query) => {
    try {
      const filter = await window.api.filters.create({ name, query })
      await get().refresh()
      await get().selectView(`filter:${filter.id}`)
      get().showToast(`已创建过滤器「${filter.name}」`, 'success')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  deleteFilter: async (id) => {
    try {
      await window.api.filters.remove(id)
      if (get().view === `filter:${id}`) {
        await get().selectView('today')
      }
      await get().refresh()
      get().showToast('过滤器已删除', 'info')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  createTask: async (input) => {
    try {
      const task = await window.api.tasks.create(input)
      await get().refresh()
      return task
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
      return null
    }
  },

  updateTask: async (id, patch) => {
    try {
      const updated = await window.api.tasks.update(id, patch)
      if (get().detailId === id) set({ detailTask: updated })
      await get().refresh()
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  toggleTask: async (task) => {
    try {
      const status = task.status === 'completed' ? 'open' : 'completed'
      const updated = await window.api.tasks.setStatus(task.id, status)
      if (get().detailId === task.id) set({ detailTask: updated })
      await get().refresh()
      if (status === 'completed') {
        get().showToast(`已完成「${task.title}」`, 'success', {
          actionLabel: '撤销',
          duration: 5000,
          action: async () => {
            await window.api.tasks.setStatus(task.id, 'open')
            await get().refresh()
          }
        })
      }
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  removeTask: async (id) => {
    const title =
      get().tasks.find((task) => task.id === id)?.title ??
      get().detailTask?.title ??
      '任务'
    try {
      await window.api.tasks.remove(id)
      if (get().detailId === id) set({ detailId: null, detailTask: null })
      await get().refresh()
      get().showToast(`已删除「${title}」`, 'info', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          await window.api.tasks.restore(id)
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  restoreTask: async (id) => {
    try {
      await window.api.tasks.restore(id)
      await get().refresh()
      get().showToast('任务已恢复', 'success')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  purgeTask: async (id) => {
    try {
      await window.api.tasks.purge(id)
      if (get().detailId === id) set({ detailId: null, detailTask: null })
      await get().refresh()
      get().showToast('任务已永久删除', 'info')
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  reorderTasks: async (listId, orderedIds) => {
    try {
      await window.api.tasks.reorder(listId, orderedIds)
      await get().refresh()
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  batchComplete: async () => {
    const selected = new Set(get().selectedIds)
    const targets = get().tasks.filter(
      (task) => selected.has(task.id) && task.status === 'open'
    )
    if (targets.length === 0) return
    try {
      for (const task of targets) {
        await window.api.tasks.setStatus(task.id, 'completed')
      }
      set({ selectionMode: false, selectedIds: [] })
      await get().refresh()
      get().showToast(`已完成 ${targets.length} 个任务`, 'success', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          for (const task of targets) {
            await window.api.tasks.setStatus(task.id, 'open')
          }
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  batchDelete: async () => {
    const selected = new Set(get().selectedIds)
    const targets = get().tasks.filter((task) => selected.has(task.id))
    if (targets.length === 0) return
    try {
      for (const task of targets) {
        await window.api.tasks.remove(task.id)
      }
      set({ selectionMode: false, selectedIds: [] })
      await get().refresh()
      get().showToast(`已删除 ${targets.length} 个任务`, 'info', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          for (const task of targets) {
            await window.api.tasks.restore(task.id)
          }
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  batchMove: async (listId) => {
    const selected = new Set(get().selectedIds)
    const targets = get().tasks.filter((task) => selected.has(task.id))
    if (targets.length === 0) return
    const originals = targets.map((task) => ({ id: task.id, listId: task.listId }))
    try {
      for (const task of targets) {
        await window.api.tasks.update(task.id, { listId })
      }
      set({ selectionMode: false, selectedIds: [] })
      await get().refresh()
      get().showToast(`已移动 ${targets.length} 个任务`, 'success', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          for (const original of originals) {
            await window.api.tasks.update(original.id, { listId: original.listId })
          }
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  batchPriority: async (priority) => {
    const selected = new Set(get().selectedIds)
    const targets = get().tasks.filter((task) => selected.has(task.id))
    if (targets.length === 0) return
    const originals = targets.map((task) => ({ id: task.id, priority: task.priority }))
    try {
      for (const task of targets) {
        await window.api.tasks.update(task.id, { priority })
      }
      set({ selectionMode: false, selectedIds: [] })
      await get().refresh()
      get().showToast(`已设置 ${targets.length} 个任务的优先级`, 'success', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          for (const original of originals) {
            await window.api.tasks.update(original.id, { priority: original.priority })
          }
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  batchDueDate: async (dueDate) => {
    const selected = new Set(get().selectedIds)
    const targets = get().tasks.filter((task) => selected.has(task.id))
    if (targets.length === 0) return
    const originals = targets.map((task) => ({
      id: task.id,
      dueDate: task.dueDate,
      allDay: task.allDay
    }))
    try {
      for (const task of targets) {
        await window.api.tasks.update(task.id, { dueDate, allDay: true })
      }
      set({ selectionMode: false, selectedIds: [] })
      await get().refresh()
      get().showToast(`已设置 ${targets.length} 个任务的日期`, 'success', {
        actionLabel: '撤销',
        duration: 6000,
        action: async () => {
          for (const original of originals) {
            await window.api.tasks.update(original.id, {
              dueDate: original.dueDate,
              allDay: original.allDay
            })
          }
          await get().refresh()
        }
      })
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  openDetail: (id) => {
    if (!id) {
      set({ detailId: null, detailTask: null })
      return
    }
    const cached = get().tasks.find((task) => task.id === id) ?? null
    set({ detailId: id, detailTask: cached })
    void window.api.tasks
      .get(id)
      .then((task) => {
        if (get().detailId === id) set({ detailTask: task ?? null })
      })
      .catch((error) => get().showToast(errorMessage(error), 'error'))
  },

  setSearchOpen: (open, seed = '') => {
    set({ searchOpen: open, searchSeed: open ? seed : '' })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewListOpen: (open) => set({ newListOpen: open }),

  focusQuickAdd: () => set({ quickAddFocus: get().quickAddFocus + 1 }),

  setSettings: async (patch) => {
    try {
      const settings = await window.api.settings.set(patch)
      set({ settings })
      if (
        Object.prototype.hasOwnProperty.call(patch, 'showCompleted') &&
        get().view.startsWith('list:')
      ) {
        await get().selectView(get().view)
      }
    } catch (error) {
      get().showToast(errorMessage(error), 'error')
    }
  },

  showToast: (message, kind = 'info', options) => {
    const id = Date.now() + Math.random()
    set({ toast: { id, message, kind, ...options } })
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, options?.duration ?? 2600)
  },

  clearToast: () => set({ toast: null })
}))
