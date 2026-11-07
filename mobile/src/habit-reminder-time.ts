const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 下一次 HH:MM 的本地时间；已过则顺延到明天。 */
export function nextDailyTrigger(time: string, from: Date = new Date()): string {
  const match = TIME_PATTERN.exec(time)
  if (!match) throw new Error('提醒时间格式应为 HH:MM')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const next = new Date(from)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

/** 从 ISO 时间取出本地 HH:MM。 */
export function localTimeOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 稳定映射到 Android 通知 id（正整数 31 位）。 */
export function notificationIdFor(habitId: string): number {
  let hash = 2166136261
  for (let index = 0; index < habitId.length; index += 1) {
    hash ^= habitId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 1) || 1
}
