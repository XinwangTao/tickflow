import { useCallback, useEffect, useRef, useState } from 'react'
import type { PomodoroSession, TaskWithMeta } from '@shared/types'
import { Icon } from './Icon'
import { useAppStore } from '../store/useAppStore'

function todayRange(): { from: string; to: string } {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function PomodoroView(): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)

  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [longBreakMinutes, setLongBreakMinutes] = useState(15)
  const [breakDuration, setBreakDuration] = useState(5)
  const [remaining, setRemaining] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [taskId, setTaskId] = useState('')
  const [tasks, setTasks] = useState<TaskWithMeta[]>([])
  const [sessions, setSessions] = useState<PomodoroSession[]>([])
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({})

  const focusSessions = sessions.filter((session) => session.mode === 'focus')

  const stateRef = useRef({
    mode,
    focusMinutes,
    breakMinutes,
    longBreakMinutes,
    breakDuration,
    taskId,
    startedAt,
    focusCount: focusSessions.length
  })
  stateRef.current = {
    mode,
    focusMinutes,
    breakMinutes,
    longBreakMinutes,
    breakDuration,
    taskId,
    startedAt,
    focusCount: focusSessions.length
  }
  const completingRef = useRef(false)

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const { from, to } = todayRange()
      setSessions(await window.api.pomodoro.list(from, to))
    } catch (error) {
      showToast(String(error), 'error')
    }
  }, [showToast])

  useEffect(() => {
    void window.api.tasks
      .query({ view: 'all' })
      .then(setTasks)
      .catch((error) => showToast(String(error), 'error'))
    void loadSessions()
  }, [loadSessions, showToast])

  useEffect(() => {
    const ids = Array.from(
      new Set(sessions.map((session) => session.taskId).filter((id): id is string => Boolean(id)))
    )
    if (ids.length === 0) return
    let cancelled = false
    Promise.all(
      ids.map(async (id) => {
        const task = await window.api.tasks.get(id)
        return [id, task?.title] as const
      })
    )
      .then((entries) => {
        if (cancelled) return
        setTaskTitles(
          Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1])))
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sessions])

  const finish = useCallback(async (): Promise<void> => {
    if (completingRef.current) return
    completingRef.current = true
    const current = stateRef.current
    const totalMinutes =
      current.mode === 'focus' ? current.focusMinutes : current.breakDuration
    const started =
      current.startedAt ?? new Date(Date.now() - totalMinutes * 60_000).toISOString()

    try {
      if (current.mode === 'focus') {
        await window.api.pomodoro.create({
          taskId: current.taskId || null,
          mode: 'focus',
          durationMinutes: current.focusMinutes,
          startedAt: started,
          endedAt: new Date().toISOString(),
          completed: true
        })
      }
      setRunning(false)
      setEndsAt(null)
      setStartedAt(null)
      const next = current.mode === 'focus' ? 'break' : 'focus'
      let message = ''
      if (next === 'break') {
        const nextFocusCount = current.focusCount + 1
        const isLong = nextFocusCount % 4 === 0
        const nextBreak = isLong ? current.longBreakMinutes : current.breakMinutes
        setBreakDuration(nextBreak)
        setRemaining(nextBreak * 60)
        message = isLong ? '专注完成，进入长休息' : '专注完成，休息一下'
      } else {
        setRemaining(current.focusMinutes * 60)
        message = '休息结束，继续专注'
      }
      setMode(next)
      await loadSessions()
      showToast(message, 'success')
      try {
        if ('Notification' in window) {
          new Notification('刻度清单', { body: message })
        }
      } catch {
        // 通知不可用时静默降级为 Toast
      }
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      completingRef.current = false
    }
  }, [loadSessions, showToast])

  useEffect(() => {
    if (!running || !endsAt) return
    const tick = (): void => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) void finish()
    }
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [running, endsAt, finish])

  const totalSeconds = (mode === 'focus' ? focusMinutes : breakDuration) * 60
  const progress = totalSeconds > 0 ? 1 - remaining / totalSeconds : 0
  const radius = 92
  const circumference = 2 * Math.PI * radius
  const selectedTask = tasks.find((task) => task.id === taskId)
  const todayMinutes = focusSessions.reduce((sum, session) => sum + session.durationMinutes, 0)
  const goal = 4
  const goalDone = Math.min(goal, focusSessions.length)

  const start = (): void => {
    if (remaining <= 0) return
    if (!startedAt) setStartedAt(new Date().toISOString())
    setEndsAt(Date.now() + remaining * 1000)
    setRunning(true)
  }

  const pause = (): void => {
    if (endsAt) setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    setRunning(false)
    setEndsAt(null)
  }

  const reset = (): void => {
    setRunning(false)
    setEndsAt(null)
    setStartedAt(null)
    setRemaining(totalSeconds)
  }

  const switchMode = (next: 'focus' | 'break'): void => {
    if (next === mode) return
    setMode(next)
    setRunning(false)
    setEndsAt(null)
    setStartedAt(null)
    if (next === 'break') {
      setBreakDuration(breakMinutes)
      setRemaining(breakMinutes * 60)
    } else {
      setRemaining(focusMinutes * 60)
    }
  }

  return (
    <div className="pomodoro">
      <div className="pomodoro-layout">
        <section className="pomodoro-card">
          <div className="segmented pomodoro-modes">
            <button
              type="button"
              className={mode === 'focus' ? 'selected' : ''}
              onClick={() => switchMode('focus')}
            >
              专注
            </button>
            <button
              type="button"
              className={mode === 'break' ? 'selected' : ''}
              onClick={() => switchMode('break')}
            >
              休息
            </button>
          </div>

          <div className="pomodoro-ring-wrap">
            <svg className="pomodoro-ring" viewBox="0 0 220 220" aria-hidden="true">
              <circle className="ring-track" cx="110" cy="110" r={radius} />
              <circle
                className="ring-progress"
                cx="110"
                cy="110"
                r={radius}
                stroke={mode === 'focus' ? 'var(--chart-1)' : 'var(--chart-2)'}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                transform="rotate(-90 110 110)"
              />
            </svg>
            <div className="pomodoro-center">
              <span className="pomodoro-mode-label">
                {mode === 'focus' ? '专注' : '休息'}
              </span>
              <strong className="pomodoro-time">{clock(remaining)}</strong>
              <span className="pomodoro-task-label">
                {selectedTask?.title ?? '未关联任务'}
              </span>
            </div>
          </div>

          <div className="pomodoro-controls">
            {running ? (
              <button type="button" className="btn btn-primary" onClick={pause}>
                <Icon name="pause" size={16} filled />
                暂停
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={start}>
                <Icon name="play" size={16} filled />
                开始
              </button>
            )}
            <button type="button" className="btn" onClick={reset}>
              <Icon name="rotate" size={15} />
              重置
            </button>
            {mode === 'break' ? (
              <button type="button" className="btn" onClick={() => switchMode('focus')}>
                跳过休息
              </button>
            ) : null}
          </div>

          <div className="pomodoro-settings">
            <label>
              专注
              <input
                type="number"
                min={5}
                max={90}
                value={focusMinutes}
                disabled={running}
                onChange={(event) => {
                  const value = Math.min(90, Math.max(5, Number(event.target.value) || 25))
                  setFocusMinutes(value)
                  if (!running && mode === 'focus') setRemaining(value * 60)
                }}
              />
              分钟
            </label>
            <label>
              休息
              <input
                type="number"
                min={1}
                max={30}
                value={breakMinutes}
                disabled={running}
                onChange={(event) => {
                  const value = Math.min(30, Math.max(1, Number(event.target.value) || 5))
                  setBreakMinutes(value)
                  if (!running && mode === 'break') setRemaining(value * 60)
                }}
              />
              分钟
            </label>
            <label>
              长休息
              <input
                type="number"
                min={5}
                max={60}
                value={longBreakMinutes}
                disabled={running}
                onChange={(event) =>
                  setLongBreakMinutes(
                    Math.min(60, Math.max(5, Number(event.target.value) || 15))
                  )
                }
              />
              分钟
            </label>
          </div>
        </section>

        <aside className="pomodoro-side">
          <section className="pomodoro-goal">
            <div className="chart-head">
              <div>
                <h2>今日目标</h2>
                <span>
                  {focusSessions.length} / {goal} 个番茄 · {todayMinutes} 分钟
                </span>
              </div>
            </div>
            <div className="goal-dots">
              {Array.from({ length: goal }, (_, index) => (
                <span key={index} className={index < goalDone ? 'done' : ''} />
              ))}
            </div>
          </section>

          <label className="detail-field">
            <span className="field-label">关联任务</span>
            <select
              className="input"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">不关联任务</option>
              {tasks.map((task) => (
                <option value={task.id} key={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>

          <section className="session-section">
            <div className="chart-head">
              <div>
                <h2>今日专注</h2>
                <span>{focusSessions.length} 条记录</span>
              </div>
            </div>
            <div className="session-list">
              {focusSessions.length === 0 ? (
                <div className="chart-empty">开始第一个番茄吧</div>
              ) : (
                focusSessions.slice(0, 8).map((session) => {
                  const time = new Date(session.startedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                  const title = session.taskId
                    ? taskTitles[session.taskId] ?? '关联任务'
                    : '未关联任务'
                  return (
                    <div className="session-row" key={session.id}>
                      <span className="session-dot" />
                      <div>
                        <strong>{title}</strong>
                        <span>
                          {time} · {session.durationMinutes} 分钟
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
