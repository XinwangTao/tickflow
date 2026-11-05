import { BrowserWindow, Notification } from 'electron'
import type { ReminderWithTask } from '@shared/types'
import { IPC } from '@shared/ipc'
import { getDb } from './db'
import { listDueReminders, markReminderSent } from './db/reminders'

let timer: NodeJS.Timeout | null = null

function notify(win: BrowserWindow, reminder: ReminderWithTask): void {
  if (!Notification.isSupported() || win.isDestroyed()) return
  const notification = new Notification({
    title: '刻度清单提醒',
    body: reminder.taskTitle,
    silent: false
  })
  notification.on('click', () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  notification.show()
}

export function startReminderScheduler(win: BrowserWindow): void {
  const db = getDb()
  const now = new Date().toISOString()
  const missed = listDueReminders(db, now)

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

  const check = (): void => {
    if (win.isDestroyed()) return
    const due = listDueReminders(getDb(), new Date().toISOString())
    for (const reminder of due) {
      notify(win, reminder)
      markReminderSent(getDb(), reminder.id)
    }
  }

  if (timer) clearInterval(timer)
  timer = setInterval(check, 30_000)
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
