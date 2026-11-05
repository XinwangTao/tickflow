import Dexie, { type Table } from 'dexie'
import type {
  Habit,
  HabitLog,
  PomodoroSession,
  Priority,
  TodoList
} from '@shared/types'
import { INBOX_ID } from '@shared/types'
import type { SyncSnapshot, SyncTask } from '@shared/sync'
import { uuidv7 } from '@shared/uuid'
import { addDaysToKey, startOfWeekKey, todayKey } from '@shared/dates'

export interface SettingRow {
  key: string
  value: string
}

export interface ListWithCount extends TodoList {
  openCount: number
}

class TickFlowDB extends Dexie {
  lists!: Table<TodoList, string>
  tasks!: Table<SyncTask, string>
  settings!: Table<SettingRow, string>
  habits!: Table<Habit, string>
  habitLogs!: Table<HabitLog, string>
  pomodoroSessions!: Table<PomodoroSession, string>

  constructor() {
    super('tickflow-mobile')
    this.version(1).stores({
      lists: 'id, sortOrder',
      tasks: 'id, listId, status, dueDate, updatedAt, parentId',
      settings: 'key'
    })
    this.version(2).stores({
      habits: 'id, archived, sortOrder',
      habitLogs: 'id, habitId, logDate, [habitId+logDate]',
      pomodoroSessions: 'id, startedAt'
    })
  }
}

export const db = new TickFlowDB()

export function nowIso(): string {
  return new Date().toISOString()
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.settings.get(key)
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await db.settings.toArray()
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export async function saveSettings(patch: Record<string, string>): Promise<void> {
  await db.settings.bulkPut(
    Object.entries(patch).map(([key, value]) => ({ key, value }))
  )
}

export async function getDeviceId(): Promise<string> {
  let id = await getSetting('deviceId')
  if (!id) {
    id = uuidv7()
    await setSetting('deviceId', id)
  }
  return id
}

export async function ensureSeed(): Promise<void> {
  const inbox = await db.lists.get(INBOX_ID)
  if (!inbox) {
    const now = nowIso()
    await db.lists.put({
      id: INBOX_ID,
      name: '收集箱',
      color: '#f5c542',
      emoji: '📥',
      sortOrder: 0,
      isInbox: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    })
  }
  await getDeviceId()
}

export async function listLists(): Promise<ListWithCount[]> {
  const lists = (await db.lists.toArray()).filter((list) => !list.deletedAt)
  const tasks = await db.tasks.toArray()
  return lists
    .map((list) => ({
      ...list,
      openCount: tasks.filter(
        (task) =>
          task.listId === list.id &&
          task.status === 'open' &&
          !task.deletedAt &&
          !task.parentId
      ).length
    }))
    .sort((a, b) => {
      if (a.isInbox !== b.isInbox) return a.isInbox ? -1 : 1
      return a.sortOrder - b.sortOrder
    })
}

export type MobileQuery =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'list'; listId: string }
  | { kind: 'search'; q: string }

function sortTasks(tasks: SyncTask[]): SyncTask[] {
  return tasks.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const aDate = a.dueDate ?? '9999-12-31'
    const bDate = b.dueDate ?? '9999-12-31'
    if (aDate !== bDate) return aDate.localeCompare(bDate)
    const aTime = a.dueTime ?? '99:99'
    const bTime = b.dueTime ?? '99:99'
    if (aTime !== bTime) return aTime.localeCompare(bTime)
    if (a.priority !== b.priority) return b.priority - a.priority
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export async function queryTasks(query: MobileQuery): Promise<SyncTask[]> {
  const today = todayKey()
  const all = (await db.tasks.toArray()).filter((task) => !task.deletedAt)

  if (query.kind === 'search') {
    const q = query.q.trim().toLowerCase()
    if (!q) return []
    const rows = all.filter(
      (task) =>
        task.title.toLowerCase().includes(q) ||
        task.notes.toLowerCase().includes(q) ||
        task.tagNames.some((tag) => tag.toLowerCase().includes(q))
    )
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)
  }

  if (query.kind === 'all') {
    return sortTasks(all.filter((task) => !task.parentId))
  }

  let rows: SyncTask[]
  if (query.kind === 'today') {
    rows = all.filter(
      (task) =>
        !task.parentId &&
        task.status === 'open' &&
        task.dueDate != null &&
        task.dueDate <= today
    )
  } else if (query.kind === 'inbox') {
    rows = all.filter(
      (task) => !task.parentId && task.status === 'open' && task.listId === INBOX_ID
    )
  } else {
    rows = all.filter(
      (task) =>
        !task.parentId && task.status === 'open' && task.listId === query.listId
    )
  }
  return sortTasks(rows)
}

export interface NewTaskInput {
  listId?: string
  title: string
  notes?: string
  priority?: Priority
  dueDate?: string | null
  dueTime?: string | null
  allDay?: boolean
  tagNames?: string[]
  parentId?: string | null
  recurrence?: string | null
}

export async function createTask(input: NewTaskInput): Promise<SyncTask> {
  const now = nowIso()
  const task: SyncTask = {
    id: uuidv7(),
    listId: input.listId ?? INBOX_ID,
    parentId: input.parentId ?? null,
    title: input.title.trim() || '新任务',
    notes: input.notes ?? '',
    status: 'open',
    priority: input.priority ?? 0,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    allDay: input.allDay ?? !input.dueTime,
    startDate: null,
    recurrence: input.recurrence ?? null,
    pinned: false,
    sortOrder: Date.now(),
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    tagNames: Array.from(
      new Set((input.tagNames ?? []).map((name) => name.trim()).filter(Boolean))
    )
  }
  await db.tasks.put(task)
  return task
}

export async function updateTask(
  id: string,
  patch: Partial<SyncTask>
): Promise<SyncTask | null> {
  const existing = await db.tasks.get(id)
  if (!existing) return null
  const next: SyncTask = { ...existing, ...patch, id, updatedAt: nowIso() }
  if (next.status === 'completed' && !next.completedAt) next.completedAt = next.updatedAt
  if (next.status !== 'completed') next.completedAt = null
  await db.tasks.put(next)
  return next
}

export async function toggleTask(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task) return
  const completed = task.status !== 'completed'
  await updateTask(id, {
    status: completed ? 'completed' : 'open',
    completedAt: completed ? nowIso() : null
  })
}

export async function removeTask(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  const children = await db.tasks.where('parentId').equals(id).toArray()
  const now = nowIso()
  const rows = [...(task ? [task] : []), ...children]
  if (rows.length) {
    await db.tasks.bulkPut(rows.map((row) => ({ ...row, deletedAt: now, updatedAt: now })))
  }
}

export async function restoreTask(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  const children = await db.tasks.where('parentId').equals(id).toArray()
  const now = nowIso()
  const rows = [...(task ? [task] : []), ...children]
  if (rows.length) {
    await db.tasks.bulkPut(
      rows.map((row) => ({ ...row, deletedAt: null, updatedAt: now }))
    )
  }
}

export async function createList(name: string): Promise<TodoList> {
  const now = nowIso()
  const list: TodoList = {
    id: uuidv7(),
    name: name.trim() || '新清单',
    color: '#0091ff',
    emoji: null,
    sortOrder: Date.now(),
    isInbox: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }
  await db.lists.put(list)
  return list
}

export async function buildSnapshot(): Promise<SyncSnapshot> {
  return {
    version: 1,
    deviceId: await getDeviceId(),
    updatedAt: nowIso(),
    lists: await db.lists.toArray(),
    tasks: await db.tasks.toArray()
  }
}

export async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  const lists = Array.isArray(snapshot.lists) ? snapshot.lists : []
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const listIds = new Set((await db.lists.toArray()).map((list) => list.id))
  for (const list of lists) listIds.add(list.id)
  const normalized = tasks.map((task) => ({
    ...task,
    listId: listIds.has(task.listId) ? task.listId : INBOX_ID
  }))

  await db.transaction('rw', db.lists, db.tasks, async () => {
    if (lists.length) await db.lists.bulkPut(lists)
    if (normalized.length) await db.tasks.bulkPut(normalized)
  })
  await ensureSeed()
}

export async function getCounts(): Promise<{ today: number; inbox: number }> {
  const today = todayKey()
  const tasks = (await db.tasks.toArray()).filter(
    (task) => !task.deletedAt && !task.parentId
  )
  return {
    today: tasks.filter(
      (task) => task.status === 'open' && task.dueDate != null && task.dueDate <= today
    ).length,
    inbox: tasks.filter(
      (task) => task.status === 'open' && task.listId === INBOX_ID
    ).length
  }
}

export interface MobileHabit extends Habit {
  logs: HabitLog[]
  currentStreak: number
  longestStreak: number
  weekCount: number
  checkedToday: boolean
}

function computeStreaks(dates: string[], today: string): {
  currentStreak: number
  longestStreak: number
} {
  const set = new Set(dates)
  let current = 0
  let cursor = set.has(today) ? today : addDaysToKey(today, -1)
  while (set.has(cursor)) {
    current += 1
    cursor = addDaysToKey(cursor, -1)
  }

  const sorted = [...set].sort()
  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const date of sorted) {
    if (previous && addDaysToKey(previous, 1) === date) run += 1
    else run = 1
    longest = Math.max(longest, run)
    previous = date
  }

  return { currentStreak: current, longestStreak: Math.max(longest, current) }
}

export async function listHabits(): Promise<MobileHabit[]> {
  const today = todayKey()
  const cutoff = addDaysToKey(today, -365)
  const weekStart = startOfWeekKey(today, 1)
  const habits = (await db.habits.toArray())
    .filter((habit) => !habit.archived && !habit.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
  const logs = (await db.habitLogs.toArray()).filter((log) => log.logDate >= cutoff)

  const byHabit = new Map<string, HabitLog[]>()
  for (const log of logs) {
    const bucket = byHabit.get(log.habitId)
    if (bucket) bucket.push(log)
    else byHabit.set(log.habitId, [log])
  }

  return habits.map((habit) => {
    const habitLogs = (byHabit.get(habit.id) ?? []).sort((a, b) =>
      a.logDate.localeCompare(b.logDate)
    )
    const dates = habitLogs.map((log) => log.logDate)
    return {
      ...habit,
      logs: habitLogs,
      ...computeStreaks(dates, today),
      weekCount: dates.filter((date) => date >= weekStart && date <= today).length,
      checkedToday: dates.includes(today)
    }
  })
}

export async function createHabit(name: string, color = '#30a46c'): Promise<Habit> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('习惯名称不能为空')
  const now = nowIso()
  const habit: Habit = {
    id: uuidv7(),
    name: trimmed,
    icon: null,
    color,
    frequency: 'daily',
    targetPerWeek: 7,
    archived: false,
    sortOrder: Date.now(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }
  await db.habits.put(habit)
  return habit
}

export async function deleteHabit(id: string): Promise<void> {
  const habit = await db.habits.get(id)
  if (!habit) return
  await db.habits.put({
    ...habit,
    archived: true,
    updatedAt: nowIso()
  })
  await db.habitLogs.where('habitId').equals(id).delete()
}

export async function toggleHabitToday(id: string): Promise<boolean> {
  const today = todayKey()
  const existing = await db.habitLogs
    .where('[habitId+logDate]')
    .equals([id, today])
    .first()
  if (existing) {
    await db.habitLogs.delete(existing.id)
    return false
  }
  const now = nowIso()
  await db.habitLogs.put({
    id: uuidv7(),
    habitId: id,
    logDate: today,
    value: 1,
    note: '',
    createdAt: now,
    updatedAt: now
  })
  return true
}

export async function listPomodoroSessions(days = 7): Promise<PomodoroSession[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)
  const sessions = await db.pomodoroSessions.toArray()
  return sessions
    .filter((session) => new Date(session.startedAt) >= cutoff)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function addPomodoroSession(input: {
  durationMinutes: number
  startedAt: string
  endedAt: string
  completed: boolean
}): Promise<PomodoroSession> {
  const session: PomodoroSession = {
    id: uuidv7(),
    taskId: null,
    mode: 'focus',
    durationMinutes: input.durationMinutes,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    completed: input.completed,
    createdAt: nowIso()
  }
  await db.pomodoroSessions.put(session)
  return session
}

export interface MobileStats {
  tasksCompleted7d: number
  tasksCompleted30d: number
  focusMinutes7d: number
  checkins7d: number
  days: Array<{
    date: string
    completed: number
    focusMinutes: number
    checkins: number
  }>
}

export async function getMobileStats(): Promise<MobileStats> {
  const today = todayKey()
  const days: MobileStats['days'] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    days.push({ date: addDaysToKey(today, -offset), completed: 0, focusMinutes: 0, checkins: 0 })
  }
  const byDate = new Map(days.map((day) => [day.date, day]))

  const tasks = await db.tasks.toArray()
  const completed = tasks.filter(
    (task) => !task.deletedAt && task.status === 'completed' && task.completedAt
  )
  const completed7dCutoff = new Date()
  completed7dCutoff.setDate(completed7dCutoff.getDate() - 6)
  completed7dCutoff.setHours(0, 0, 0, 0)
  const completed30dCutoff = new Date()
  completed30dCutoff.setDate(completed30dCutoff.getDate() - 29)
  completed30dCutoff.setHours(0, 0, 0, 0)

  for (const task of completed) {
    const day = byDate.get(task.completedAt!.slice(0, 10))
    if (day) day.completed += 1
  }

  const sessions = await listPomodoroSessions(7)
  for (const session of sessions) {
    if (!session.completed) continue
    const day = byDate.get(session.startedAt.slice(0, 10))
    if (day) day.focusMinutes += session.durationMinutes
  }

  const logs = (await db.habitLogs.toArray()).filter((log) => log.logDate >= days[0].date)
  for (const log of logs) {
    const day = byDate.get(log.logDate)
    if (day) day.checkins += 1
  }

  return {
    tasksCompleted7d: completed.filter(
      (task) => new Date(task.completedAt!) >= completed7dCutoff
    ).length,
    tasksCompleted30d: completed.filter(
      (task) => new Date(task.completedAt!) >= completed30dCutoff
    ).length,
    focusMinutes7d: days.reduce((sum, day) => sum + day.focusMinutes, 0),
    checkins7d: days.reduce((sum, day) => sum + day.checkins, 0),
    days
  }
}

export async function renameList(id: string, name: string): Promise<void> {
  const list = await db.lists.get(id)
  if (!list) return
  const trimmed = name.trim()
  if (!trimmed) throw new Error('清单名称不能为空')
  await db.lists.put({ ...list, name: trimmed, updatedAt: nowIso() })
}

export async function deleteList(id: string): Promise<void> {
  const list = await db.lists.get(id)
  if (!list) return
  if (list.isInbox) throw new Error('收集箱不能删除')
  const now = nowIso()
  const tasks = (await db.tasks.where('listId').equals(id).toArray()).filter(
    (task) => !task.deletedAt
  )
  await db.transaction('rw', db.lists, db.tasks, async () => {
    if (tasks.length) {
      await db.tasks.bulkPut(
        tasks.map((task) => ({ ...task, deletedAt: now, updatedAt: now }))
      )
    }
    await db.lists.put({ ...list, deletedAt: now, updatedAt: now })
  })
}
