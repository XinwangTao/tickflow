import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDaysToKey, startOfWeekKey, todayKey } from '@shared/dates'
import type { PomodoroSession } from '@shared/types'
import {
  addPomodoroSession,
  createHabit,
  deleteHabit,
  getMobileStats,
  listHabitReminders,
  listHabits,
  listPomodoroSessions,
  setHabitReminder,
  toggleHabitToday,
  type MobileHabit,
  type MobileStats
} from './db'
import {
  checkExactAlarmSetting,
  checkNotificationPermission,
  reconcileHabitNotifications,
  requestExactAlarmSetting,
  requestNotificationPermission,
  type ExactAlarmSetting,
  type NotificationPermission
} from './notifications'
import { localTimeOf } from './habit-reminder-time'
import { Icon } from './Icon'

type Page = 'habits' | 'pomodoro' | 'stats'
type Toast = (message: string, kind?: 'info' | 'success' | 'error') => void

const HABIT_COLORS = ['#30a46c', '#4c9aff', '#f5a524', '#e5484d', '#a855f7']
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const FOCUS_MINUTES = 25
const SHORT_BREAK = 5
const LONG_BREAK = 15

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function HabitPanel({ onToast }: { onToast: Toast }): ReactNode {
  const [habits, setHabits] = useState<MobileHabit[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(HABIT_COLORS[0])
  const [reminderTimes, setReminderTimes] = useState<Record<string, string>>({})
  const [editingReminder, setEditingReminder] = useState<string | null>(null)
  const [reminderDraft, setReminderDraft] = useState('09:00')
  const [permission, setPermission] = useState<NotificationPermission>('unsupported')
  const [exactAlarm, setExactAlarm] = useState<ExactAlarmSetting>('unsupported')

  const reload = async (): Promise<void> => {
    const [nextHabits, reminders] = await Promise.all([listHabits(), listHabitReminders()])
    setHabits(nextHabits)
    setReminderTimes(
      Object.fromEntries(reminders.map((reminder) => [reminder.habitId, localTimeOf(reminder.triggerAt)]))
    )
    setPermission(await checkNotificationPermission())
    setExactAlarm(await checkExactAlarmSetting())
  }

  useEffect(() => {
    void reload()
  }, [])

  const add = async (): Promise<void> => {
    if (!name.trim()) {
      onToast('先输入习惯名称', 'error')
      return
    }
    await createHabit(name, color)
    setName('')
    await reload()
    onToast('已创建习惯', 'success')
  }

  const toggle = async (habit: MobileHabit): Promise<void> => {
    const checked = await toggleHabitToday(habit.id)
    await reload()
    onToast(checked ? `已打卡「${habit.name}」` : `已取消「${habit.name}」今天的打卡`, 'info')
  }

  const remove = async (habit: MobileHabit): Promise<void> => {
    if (!window.confirm(`删除习惯「${habit.name}」？打卡记录会保留但不再显示。`)) return
    await deleteHabit(habit.id)
    await reconcileHabitNotifications()
    await reload()
    onToast('习惯已删除', 'info')
  }

  const openReminder = (habit: MobileHabit): void => {
    setEditingReminder(habit.id)
    setReminderDraft(reminderTimes[habit.id] ?? '09:00')
  }

  const saveReminder = async (habit: MobileHabit): Promise<void> => {
    await setHabitReminder(habit.id, reminderDraft)
    let state = await checkNotificationPermission()
    if (state === 'prompt') state = await requestNotificationPermission()
    await reconcileHabitNotifications()
    await reload()
    setEditingReminder(null)
    if (state === 'granted') {
      onToast(`已设置每天 ${reminderDraft} 提醒`, 'success')
    } else if (state === 'unsupported') {
      onToast('提醒已保存；通知仅移动端生效', 'info')
    } else {
      onToast('提醒已保存；请在系统设置中允许通知', 'error')
    }
  }

  const clearReminder = async (habit: MobileHabit): Promise<void> => {
    await setHabitReminder(habit.id, null)
    await reconcileHabitNotifications()
    await reload()
    setEditingReminder(null)
    onToast(`已关闭「${habit.name}」提醒`, 'info')
  }

  const enableExactAlarm = async (): Promise<void> => {
    const state = await requestExactAlarmSetting()
    setExactAlarm(state)
    await reconcileHabitNotifications()
    onToast(
      state === 'granted' ? '已开启精确提醒' : '尚未开启，提醒可能明显延迟',
      state === 'granted' ? 'success' : 'info'
    )
  }

  const week = useMemo(() => {
    const start = startOfWeekKey(todayKey(), 1)
    return Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index))
  }, [])
  const today = todayKey()

  return (
    <div className="more-panel">
      <div className="habit-editor">
        <input
          className="input"
          placeholder="新习惯名称，例如：阅读 30 分钟"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <div className="habit-editor-row">
          <div className="habit-colors" role="radiogroup" aria-label="习惯颜色">
            {HABIT_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={`habit-color ${color === item ? 'selected' : ''}`}
                style={{ background: item }}
                aria-label={`选择颜色 ${item}`}
                aria-pressed={color === item}
                onClick={() => setColor(item)}
              />
            ))}
          </div>
          <button type="button" className="btn-accent" onClick={() => void add()}>
            <Icon name="plus" size={16} />
            添加
          </button>
        </div>
      </div>

      {habits.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">✓</div>
          <h2>还没有习惯</h2>
          <p>添加一个每天想坚持的小事。</p>
        </div>
      ) : (
        habits.map((habit) => {
          const logDates = new Set(habit.logs.map((log) => log.logDate))
          return (
            <div className="habit-card" key={habit.id}>
              <div className="habit-head">
                <div className="habit-info">
                  <span className="habit-dot" style={{ background: habit.color }} />
                  <div>
                    <div className="habit-name">{habit.name}</div>
                    <div className="habit-meta">
                      连续 {habit.currentStreak} 天 · 本周 {habit.weekCount}/7 · 最长{' '}
                      {habit.longestStreak} 天
                      {reminderTimes[habit.id] ? ` · 提醒 ${reminderTimes[habit.id]}` : ''}
                    </div>
                  </div>
                </div>
                <div className="habit-actions">
                  <button
                    type="button"
                    className={`habit-check ${habit.checkedToday ? 'on' : ''}`}
                    aria-label={habit.checkedToday ? '取消今天打卡' : '今天打卡'}
                    onClick={() => void toggle(habit)}
                  >
                    <Icon name="check" size={18} />
                  </button>
                  <button
                    type="button"
                    className={`icon-btn ${reminderTimes[habit.id] ? 'active' : ''}`}
                    aria-label={`设置提醒 ${habit.name}`}
                    onClick={() => openReminder(habit)}
                  >
                    <Icon name="bell" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn habit-delete"
                    aria-label={`删除习惯 ${habit.name}`}
                    onClick={() => void remove(habit)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
              <div className="habit-week">
                {week.map((date, index) => {
                  const on = logDates.has(date)
                  return (
                    <div
                      key={date}
                      className={`habit-day ${on ? 'on' : ''} ${date === today ? 'today' : ''}`}
                      title={`${date}${on ? ' 已打卡' : ''}`}
                    >
                      <span>{WEEK_LABELS[index]}</span>
                      {on ? <Icon name="check" size={12} /> : <i />}
                    </div>
                  )
                })}
              </div>
              {editingReminder === habit.id ? (
                <div className="habit-reminder">
                  <label className="habit-reminder-time">
                    <span>每天提醒</span>
                    <input
                      type="time"
                      value={reminderDraft}
                      onChange={(event) => setReminderDraft(event.target.value)}
                    />
                  </label>
                  <div className="habit-reminder-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => void saveReminder(habit)}
                    >
                      保存
                    </button>
                    {reminderTimes[habit.id] ? (
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => void clearReminder(habit)}
                      >
                        关闭提醒
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setEditingReminder(null)}
                    >
                      取消
                    </button>
                  </div>
                  {permission !== 'granted' ? (
                    <p className="hint">
                      {permission === 'unsupported'
                        ? '当前环境不支持系统通知；提醒会在移动端生效。'
                        : '通知权限未开启，保存后请在系统设置中允许通知。'}
                    </p>
                  ) : exactAlarm === 'denied' ? (
                    <p className="hint">
                      系统「闹钟和提醒」未开启，提醒可能明显延迟。
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => void enableExactAlarm()}
                      >
                        去开启
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })
      )}
      <p className="more-note">习惯数据已纳入 R2 同步；提醒使用系统本地通知（移动端）。</p>
    </div>
  )
}

function PomodoroPanel({ onToast }: { onToast: Toast }): ReactNode {
  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [longBreak, setLongBreak] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_MINUTES * 60)
  const [running, setRunning] = useState(false)
  const [finishedToday, setFinishedToday] = useState(0)
  const [sessions, setSessions] = useState<PomodoroSession[]>([])
  const [noiseOn, setNoiseOn] = useState(false)
  const [noiseVolume, setNoiseVolume] = useState(0.18)
  const [noiseBusy, setNoiseBusy] = useState(false)
  const startedAt = useRef<string | null>(null)
  const noiseRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null)

  const stopNoise = (): void => {
    const current = noiseRef.current
    if (!current) return
    noiseRef.current = null
    setNoiseOn(false)
    void current.ctx.close().catch(() => undefined)
  }

  const toggleNoise = (): void => {
    if (noiseBusy) return
    if (noiseRef.current) {
      stopNoise()
      return
    }
    setNoiseBusy(true)
    try {
      const ctx = new AudioContext()
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      let last = 0
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02
        data[index] = last * 3.5
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1200
      const gain = ctx.createGain()
      gain.gain.value = noiseVolume
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start()
      noiseRef.current = { ctx, gain }
      setNoiseOn(true)
    } catch (error) {
      onToast(`无法启动白噪音：${String(error)}`, 'error')
    } finally {
      setNoiseBusy(false)
    }
  }

  useEffect(() => {
    if (noiseRef.current) noiseRef.current.gain.gain.value = noiseVolume
  }, [noiseVolume])

  useEffect(() => {
    return () => {
      const current = noiseRef.current
      noiseRef.current = null
      if (current) void current.ctx.close().catch(() => undefined)
    }
  }, [])

  const reloadSessions = async (): Promise<void> => {
    const rows = await listPomodoroSessions(7)
    setSessions(rows)
    const today = todayKey()
    setFinishedToday(
      rows.filter(
        (row) => row.completed && row.mode === 'focus' && row.startedAt.slice(0, 10) === today
      ).length
    )
  }

  useEffect(() => {
    void reloadSessions()
  }, [])

  const totalSeconds = mode === 'focus' ? FOCUS_MINUTES * 60 : (longBreak ? LONG_BREAK : SHORT_BREAK) * 60

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => (value > 0 ? value - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (secondsLeft > 0 || !running) return
    setRunning(false)
    if (mode === 'focus') {
      const endedAt = new Date().toISOString()
      void addPomodoroSession({
        durationMinutes: FOCUS_MINUTES,
        startedAt: startedAt.current ?? new Date(Date.now() - FOCUS_MINUTES * 60_000).toISOString(),
        endedAt,
        completed: true
      }).then(() => {
        void reloadSessions()
      })
      const nextLong = (finishedToday + 1) % 4 === 0
      setLongBreak(nextLong)
      setMode('break')
      setSecondsLeft((nextLong ? LONG_BREAK : SHORT_BREAK) * 60)
      onToast(nextLong ? '完成 4 个番茄，进入长休息' : '专注完成，休息一下', 'success')
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('刻度清单', { body: '专注结束，休息一下。' })
      }
    } else {
      setMode('focus')
      setLongBreak(false)
      setSecondsLeft(FOCUS_MINUTES * 60)
      onToast('休息结束，继续专注', 'success')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, running])

  const start = (): void => {
    if (running) {
      setRunning(false)
      return
    }
    if (secondsLeft === totalSeconds) startedAt.current = new Date().toISOString()
    setRunning(true)
  }

  const reset = (): void => {
    setRunning(false)
    setMode('focus')
    setLongBreak(false)
    setSecondsLeft(FOCUS_MINUTES * 60)
    startedAt.current = null
  }

  const skip = (): void => {
    setRunning(false)
    if (mode === 'focus') {
      setMode('break')
      setSecondsLeft(SHORT_BREAK * 60)
    } else {
      setMode('focus')
      setLongBreak(false)
      setSecondsLeft(FOCUS_MINUTES * 60)
    }
  }

  const progress = totalSeconds === 0 ? 0 : 1 - secondsLeft / totalSeconds
  const focusMinutes = sessions
    .filter((row) => row.completed && row.mode === 'focus')
    .reduce((sum, row) => sum + row.durationMinutes, 0)

  return (
    <div className="more-panel pomodoro">
      <div className="pomodoro-mode">
        {mode === 'focus' ? '专注' : longBreak ? '长休息' : '短休息'} · 今日 {finishedToday} 个番茄
      </div>
      <div
        className="pomodoro-ring"
        style={{ background: `conic-gradient(var(--accent) ${progress * 360}deg, var(--panel-2) 0deg)` }}
      >
        <div className="pomodoro-face">
          <strong>{formatClock(secondsLeft)}</strong>
          <span>{running ? '进行中' : '已暂停'}</span>
        </div>
      </div>
      <div className="pomodoro-actions">
        <button type="button" className="btn-accent" onClick={start}>
          {running ? '暂停' : secondsLeft === totalSeconds ? '开始专注' : '继续'}
        </button>
        <button type="button" className="btn-ghost" onClick={skip} disabled={secondsLeft === totalSeconds}>
          跳过
        </button>
        <button type="button" className="btn-ghost" onClick={reset}>
          重置
        </button>
        <button
          type="button"
          className={noiseOn ? 'btn-accent' : 'btn-ghost'}
          onClick={toggleNoise}
        >
          {noiseOn ? '关闭白噪音' : '白噪音'}
        </button>
      </div>
      {noiseOn ? (
        <div className="mobile-noise">
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={noiseVolume}
            aria-label="白噪音音量"
            onChange={(event) => setNoiseVolume(Number(event.target.value))}
          />
          <span>{Math.round(noiseVolume * 100)}%</span>
        </div>
      ) : null}
      <div className="pomodoro-summary">
        最近 7 天完成 {sessions.filter((row) => row.completed && row.mode === 'focus').length} 个番茄 ·
        专注 {focusMinutes} 分钟
      </div>
      <p className="more-note">番茄记录会随 R2 同步（按 id 合并，不重复计数）。</p>
    </div>
  )
}

function StatsPanel(): ReactNode {
  const [stats, setStats] = useState<MobileStats | null>(null)

  useEffect(() => {
    void getMobileStats().then(setStats)
  }, [])

  if (!stats) return <div className="loading">统计中…</div>
  const maxCompleted = Math.max(1, ...stats.days.map((day) => day.completed))
  const maxFocus = Math.max(1, ...stats.days.map((day) => day.focusMinutes))
  const week = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="more-panel stats">
      <div className="stat-grid">
        <div className="stat-tile">
          <span>近 7 天完成</span>
          <strong>{stats.tasksCompleted7d}</strong>
        </div>
        <div className="stat-tile">
          <span>近 30 天完成</span>
          <strong>{stats.tasksCompleted30d}</strong>
        </div>
        <div className="stat-tile">
          <span>近 7 天专注</span>
          <strong>{stats.focusMinutes7d}<small> 分钟</small></strong>
        </div>
        <div className="stat-tile">
          <span>近 7 天打卡</span>
          <strong>{stats.checkins7d}</strong>
        </div>
      </div>

      <section className="stat-card">
        <div className="stat-card-head">
          <h3>每日完成任务</h3>
          <span className="legend-item"><i style={{ background: 'var(--low)' }} />完成</span>
        </div>
        <div className="stat-bars" role="img" aria-label="最近 7 天每日完成任务数">
          {stats.days.map((day) => (
            <div className="stat-bar-col" key={day.date} title={`${day.date} 完成 ${day.completed} 个`}>
              <span className="stat-value">{day.completed}</span>
              <div className="stat-bar-track">
                <div
                  className="stat-bar"
                  style={{ height: day.completed > 0 ? `${Math.max(4, (day.completed / maxCompleted) * 100)}%` : '0%', background: 'var(--low)' }}
                />
              </div>
              <span className="stat-day">{week[new Date(`${day.date}T00:00:00`).getDay()]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stat-card">
        <div className="stat-card-head">
          <h3>每日专注分钟</h3>
          <span className="legend-item"><i style={{ background: 'var(--chart-2)' }} />专注</span>
        </div>
        <div className="stat-bars" role="img" aria-label="最近 7 天每日专注分钟数">
          {stats.days.map((day) => (
            <div className="stat-bar-col" key={day.date} title={`${day.date} 专注 ${day.focusMinutes} 分钟`}>
              <span className="stat-value">{day.focusMinutes}</span>
              <div className="stat-bar-track">
                <div
                  className="stat-bar"
                  style={{
                    height: day.focusMinutes > 0 ? `${Math.max(4, (day.focusMinutes / maxFocus) * 100)}%` : '0%',
                    background: 'var(--chart-2)'
                  }}
                />
              </div>
              <span className="stat-day">{week[new Date(`${day.date}T00:00:00`).getDay()]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stat-card">
        <h3>数据表</h3>
        <table className="stat-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>完成</th>
              <th>专注</th>
              <th>打卡</th>
            </tr>
          </thead>
          <tbody>
            {stats.days.map((day) => (
              <tr key={day.date}>
                <td>{day.date.slice(5)}</td>
                <td>{day.completed}</td>
                <td>{day.focusMinutes} 分</td>
                <td>{day.checkins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="more-note">统计基于本机任务、番茄与习惯数据。</p>
    </div>
  )
}

export function MoreTab({ onToast }: { onToast: Toast }): ReactNode {
  const [page, setPage] = useState<Page>('habits')

  return (
    <div className="more">
      <div className="segmented more-segmented">
        {(
          [
            { key: 'habits', label: '习惯' },
            { key: 'pomodoro', label: '番茄' },
            { key: 'stats', label: '统计' }
          ] as Array<{ key: Page; label: string }>
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            className={page === item.key ? 'selected' : ''}
            onClick={() => setPage(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {page === 'habits' ? (
        <HabitPanel onToast={onToast} />
      ) : page === 'pomodoro' ? (
        <PomodoroPanel onToast={onToast} />
      ) : (
        <StatsPanel />
      )}
    </div>
  )
}
