import { useEffect, useState, type ReactNode } from 'react'
import type {
  HabitReminderWithHabit,
  ReminderCenterData,
  ReminderWithTask
} from '@shared/types'
import { formatDateLabel, toDateKey } from '@shared/dates'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface NotificationCenterProps {
  onClose: () => void
  onRead: () => void
}

interface CenterItem {
  id: string
  triggerAt: string
  sentAt: string | null
}

function groupByDay<T extends CenterItem>(
  items: T[],
  key: 'triggerAt' | 'sentAt'
): Array<{ day: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const iso = key === 'sentAt' ? item.sentAt : item.triggerAt
    const day = iso ? toDateKey(new Date(iso)) : ''
    const bucket = groups.get(day)
    if (bucket) bucket.push(item)
    else groups.set(day, [item])
  }
  return [...groups.entries()].map(([day, rows]) => ({ day, items: rows }))
}

function dayLabel(day: string): string {
  if (!day) return ''
  return formatDateLabel(day)
}

function NotificationRow({
  item,
  sent
}: {
  item: ReminderWithTask
  sent: boolean
}): ReactNode {
  return (
    <div className={`notification-row ${sent ? 'sent' : ''}`}>
      <span className="notification-icon">
        <Icon name="bell" size={15} />
      </span>
      <div className="notification-main">
        <span className="notification-title">{item.taskTitle}</span>
        <span className="notification-meta">
          {sent ? '已提醒' : '待提醒'} · {formatDateTime(sent ? item.sentAt ?? item.triggerAt : item.triggerAt)}
        </span>
      </div>
    </div>
  )
}

function Section({
  title,
  items,
  sent
}: {
  title: string
  items: ReminderWithTask[]
  sent: boolean
}): ReactNode {
  if (items.length === 0) return null
  return (
    <section className="notification-section">
      <h3>{title}</h3>
      {groupByDay(items, sent ? 'sentAt' : 'triggerAt').map((group) => (
        <div className="notification-group" key={group.day}>
          {group.day ? <div className="notification-day">{dayLabel(group.day)}</div> : null}
          {group.items.map((item) => (
            <NotificationRow key={item.id} item={item} sent={sent} />
          ))}
        </div>
      ))}
    </section>
  )
}

function HabitSection({
  title,
  items,
  sent,
  onOpen
}: {
  title: string
  items: HabitReminderWithHabit[]
  sent: boolean
  onOpen: () => void
}): ReactNode {
  if (items.length === 0) return null
  return (
    <section className="notification-section">
      <h3>{title}</h3>
      {groupByDay(items, sent ? 'sentAt' : 'triggerAt').map((group) => (
        <div className="notification-group" key={group.day}>
          {group.day ? <div className="notification-day">{dayLabel(group.day)}</div> : null}
          {group.items.map((item) => (
            <button
              type="button"
              className={`notification-row clickable ${sent ? 'sent' : ''}`}
              key={item.id}
              title={`打开习惯 ${item.habitName}`}
              onClick={onOpen}
            >
              <span
                className="notification-icon"
                style={{ background: `${item.habitColor}22`, color: item.habitColor }}
              >
                <Icon name="habit" size={15} />
              </span>
              <span className="notification-main">
                <span className="notification-title">{item.habitName}</span>
                <span className="notification-meta">
                  {sent ? '已提醒' : '待提醒'} ·{' '}
                  {formatDateTime(sent ? item.sentAt ?? item.triggerAt : item.triggerAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </section>
  )
}

export function NotificationCenter({ onClose, onRead }: NotificationCenterProps): ReactNode {
  const [data, setData] = useState<ReminderCenterData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectView = useAppStore((state) => state.selectView)

  useEffect(() => {
    let alive = true
    window.api.reminders
      .center()
      .then((next) => {
        if (!alive) return
        setData(next)
        onRead()
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason))
      })
    return () => {
      alive = false
    }
  }, [onRead])

  const openHabits = (): void => {
    void selectView('habits')
    onClose()
  }

  const empty =
    data &&
    data.upcoming.length === 0 &&
    data.recent.length === 0 &&
    data.habitUpcoming.length === 0 &&
    data.habitRecent.length === 0

  return (
    <Modal title="通知" onClose={onClose} width={460}>
      {error ? <p className="modal-text">{error}</p> : null}
      {!data && !error ? <p className="modal-text">加载中…</p> : null}
      {data ? (
        <div className="notification-center">
          <Section title="待提醒" items={data.upcoming} sent={false} />
          <HabitSection
            title="习惯待提醒"
            items={data.habitUpcoming}
            sent={false}
            onOpen={openHabits}
          />
          <Section title="最近提醒" items={data.recent} sent />
          <HabitSection
            title="最近习惯提醒"
            items={data.habitRecent}
            sent
            onOpen={openHabits}
          />
          {empty ? (
            <div className="notification-empty">
              <Icon name="bell" size={28} />
              <p>暂无提醒通知</p>
              <span>在任务或习惯里设置提醒后，会出现在这里。</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
