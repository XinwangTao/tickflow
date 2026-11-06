import { BrowserWindow, Notification } from 'electron'
import type { HabitReminderWithHabit, ReminderWithTask } from '@shared/types'
import { IPC } from '@shared/ipc'
import { getDb } from './db'
import {
  advanceHabitReminder,
  listDueHabitReminders,
  localTimeOf,
  nextDailyTrigger
} from './db/habit-reminders'
import { listDueReminders, markReminderSent } from './db/reminders'

let timer: NodeJS.Timeout | null = null

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function notify(win: BrowserWindow, reminder: ReminderWithTask): void {
  if (!Notification.isSupported() || win.isDestroyed()) return
  const notification = new Notification({
    title: '刻度清单提醒',
    body: reminder.taskTitle,
    silent: false
  })
  notification.on('click', () => focusWindow(win))
  notification.show()
}

function fireHabitReminder(
  win: BrowserWindow,
  reminder: HabitReminderWithHabit,
  now: string
): void {
  if (Notification.isSupported() && !win.isDestroyed()) {
    const notification = new Notification({
      title: '习惯提醒',
      body: reminder.habitName,
      silent: false
    })
    notification.on('click', () => focusWindow(win))
    notification.show()
  }
  const triggerAt = nextDailyTrigger(localTimeOf(reminder.triggerAt), new Date(now))
  advanceHabitReminder(getDb(), reminder.id, now, triggerAt)
}

export function startReminderScheduler(win: BrowserWindow): void {
  const db = getDb()
  const now = new Date().toISOString()
  const missed = listDueReminders(db, now)
  const missedHabits = listDueHabitReminders(db, now)

  if (missed.length) {
    for (const reminder of missed) markReminderSent(db, reminder.id, now)
    const payload = missed
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.remindersMissedEvent, payload)
      }
    }, 1200)
    if (Notification.isSupported()) {
      new Notification({
        title: '刻度清单',
        body: `有 ${missed.length} 条错过的提醒`
      }).show()
    }
  }

  if (missedHabits.length) {
    for (const reminder of missedHabits) fireHabitReminder(win, reminder, now)
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.remindersHabitFiredEvent, missedHabits)
      }
    }, 1200)
  }

  const check = (): void => {
    if (win.isDestroyed()) return
    const checkedAt = new Date().toISOString()
    const due = listDueReminders(getDb(), checkedAt)
    for (const reminder of due) {
      notify(win, reminder)
      markReminderSent(getDb(), reminder.id, checkedAt)
    }

    const dueHabits = listDueHabitReminders(getDb(), checkedAt)
    for (const reminder of dueHabits) fireHabitReminder(win, reminder, checkedAt)
    if (dueHabits.length) {
      win.webContents.send(IPC.remindersHabitFiredEvent, dueHabits)
    }
  }

  if (timer) clearInterval(timer)
  timer = setInterval(check, 30_000)
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
