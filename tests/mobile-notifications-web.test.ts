import { beforeAll, describe, expect, it } from 'vitest'

let checkNotificationPermission: typeof import('../mobile/src/notifications').checkNotificationPermission
let syncHabitNotifications: typeof import('../mobile/src/notifications').syncHabitNotifications

beforeAll(async () => {
  // @ts-expect-error fake-indexeddb 的 exports 未暴露 auto 的声明文件
  await import('fake-indexeddb/auto')
  const notifications = await import('../mobile/src/notifications')
  checkNotificationPermission = notifications.checkNotificationPermission
  syncHabitNotifications = notifications.syncHabitNotifications
})

describe('mobile notifications on web', () => {
  it('非原生平台返回 unsupported 且不调度', async () => {
    await expect(checkNotificationPermission()).resolves.toBe('unsupported')
    await expect(
      syncHabitNotifications([{ habitId: 'habit-1', name: '喝水', time: '09:00' }])
    ).resolves.toEqual({ permission: 'unsupported', scheduled: 0 })
  })
})
