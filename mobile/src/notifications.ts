import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { db } from './db'
import { localTimeOf, notificationIdFor } from './habit-reminder-time'

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

export interface HabitNotificationInput {
  habitId: string
  name: string
  /** 本地 HH:MM */
  time: string
}

export interface HabitNotificationResult {
  permission: NotificationPermission
  scheduled: number
}

const CHANNEL_ID = 'habit-reminders'

function mapPermission(state: string): NotificationPermission {
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  return 'prompt'
}

export async function checkNotificationPermission(): Promise<NotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const status = await LocalNotifications.checkPermissions()
    return mapPermission(status.display)
  } catch {
    return 'unsupported'
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const status = await LocalNotifications.requestPermissions()
    return mapPermission(status.display)
  } catch {
    return 'unsupported'
  }
}

export type ExactAlarmSetting = 'granted' | 'denied' | 'unsupported'

/**
 * 精确闹钟（系统「闹钟和提醒」）是否已开启。
 * 未开启时只能排不精确闹钟，系统可能因省电策略把提醒推迟很久。
 */
export async function checkExactAlarmSetting(): Promise<ExactAlarmSetting> {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const status = await LocalNotifications.checkExactNotificationSetting()
    return status.exact_alarm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 跳转系统「闹钟和提醒」页，返回最新状态。 */
export async function requestExactAlarmSetting(): Promise<ExactAlarmSetting> {
  if (!Capacitor.isNativePlatform()) return 'unsupported'
  try {
    const status = await LocalNotifications.changeExactNotificationSetting()
    return status.exact_alarm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/**
 * 以本地提醒表为准重排：取消已删除/关闭/归档的通知，重新注册全部有效提醒。
 * 只在原生平台执行；Web/预览返回 unsupported，不阻塞保存。
 */
export async function syncHabitNotifications(
  items: HabitNotificationInput[]
): Promise<HabitNotificationResult> {
  const permission = await checkNotificationPermission()
  if (permission === 'unsupported') return { permission, scheduled: 0 }
  if (permission !== 'granted') return { permission, scheduled: 0 }

  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: '习惯提醒',
      description: '每日习惯打卡提醒',
      importance: 4,
      visibility: 1
    })
  } catch {
    // 渠道可能已存在
  }

  const active = items.filter((item) => parseTime(item.time))
  const activeIds = new Set(active.map((item) => notificationIdFor(item.habitId)))
  try {
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications
      .filter((notification) => !activeIds.has(notification.id))
      .map((notification) => ({ id: notification.id }))
    if (stale.length) await LocalNotifications.cancel({ notifications: stale })
  } catch {
    // 对账失败不阻塞后续注册
  }

  if (active.length === 0) return { permission, scheduled: 0 }

  try {
    await LocalNotifications.cancel({
      notifications: active.map((item) => ({ id: notificationIdFor(item.habitId) }))
    })
  } catch {
    // 同 id 重新注册即可覆盖
  }

  const exactAllowed = (await checkExactAlarmSetting()) === 'granted'
  const notifications = active
    .map((item) => {
      const time = parseTime(item.time)
      if (!time) return null
      return {
        id: notificationIdFor(item.habitId),
        title: '习惯提醒',
        body: `该打卡「${item.name}」了`,
        channelId: CHANNEL_ID,
        // 已开「闹钟和提醒」才排精确闹钟；否则退回不精确，界面提示可能延迟。
        isExactNotification: exactAllowed,
        isExactMandatory: false,
        schedule: {
          on: { hour: time.hour, minute: time.minute },
          repeats: true,
          allowWhileIdle: true
        },
        extra: { habitId: item.habitId }
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  try {
    await LocalNotifications.schedule({ notifications })
  } catch {
    // 系统禁用通知等情况不该打断保存；界面会提示去设置开启。
    return { permission, scheduled: 0 }
  }
  return { permission, scheduled: notifications.length }
}

/** 从本地库读取有效提醒并重排（启动、同步后调用）。 */
export async function reconcileHabitNotifications(): Promise<HabitNotificationResult> {
  const [habits, reminders] = await Promise.all([
    db.habits.toArray(),
    db.habitReminders.toArray()
  ])
  const habitById = new Map(habits.map((habit) => [habit.id, habit]))
  const items: HabitNotificationInput[] = []
  for (const reminder of reminders) {
    if (reminder.deletedAt || !reminder.enabled) continue
    const habit = habitById.get(reminder.habitId)
    if (!habit || habit.deletedAt || habit.archived) continue
    items.push({
      habitId: reminder.habitId,
      name: habit.name,
      time: localTimeOf(reminder.triggerAt)
    })
  }
  return syncHabitNotifications(items)
}

/** 通知点击回调；返回取消订阅函数。 */
export function onHabitNotificationTap(callback: (habitId: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined
  let handle: { remove: () => Promise<void> } | null = null
  void LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const extra = event.notification.extra as { habitId?: string } | undefined
    if (extra?.habitId) callback(extra.habitId)
  })
    .then((listener) => {
      handle = listener
    })
    .catch(() => undefined)
  return () => {
    void handle?.remove()
  }
}
