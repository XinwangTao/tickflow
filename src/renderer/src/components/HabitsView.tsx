import { useEffect, useMemo, useState } from 'react'
import type { HabitWithStats } from '@shared/types'
import { addDaysToKey, startOfWeekKey, todayKey } from '@shared/dates'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useAppStore } from '../store/useAppStore'

const HABIT_COLORS = ['#30a46c', '#0091ff', '#f5c542', '#e5484d', '#8e4ec6', '#e93d82']

function textOn(hex: string): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return '#ffffff'
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#17181a' : '#ffffff'
}

function heatDays(): string[] {
  const end = todayKey()
  const start = addDaysToKey(startOfWeekKey(end, 1), -77)
  return Array.from({ length: 84 }, (_, index) => addDaysToKey(start, index))
}

function HabitHeatmap({
  habit,
  onToggle
}: {
  habit: HabitWithStats
  onToggle: (date: string) => void
}): React.ReactNode {
  const today = todayKey()
  const days = useMemo(heatDays, [])
  const logSet = useMemo(() => new Set(habit.logs.map((log) => log.logDate)), [habit.logs])

  return (
    <div>
      <div
        className="habit-heatmap"
        role="grid"
        aria-label={`${habit.name} 最近 12 周打卡`}
      >
        {days.map((date) => {
          const done = logSet.has(date)
          const future = date > today
          return (
            <button
              type="button"
              key={date}
              className={`heat-cell ${done ? 'on' : ''} ${date === today ? 'today' : ''} ${
                future ? 'future' : ''
              }`}
              style={done ? { background: habit.color } : undefined}
              disabled={future}
              title={`${date} · ${done ? '已打卡' : '未打卡'}`}
              aria-label={`${date} ${done ? '已打卡' : '未打卡'}`}
              onClick={() => onToggle(date)}
            />
          )
        })}
      </div>
      <div className="heat-legend">
        <span className="heat-swatch" />
        <span>未打卡</span>
        <span className="heat-swatch" style={{ background: habit.color }} />
        <span>已打卡</span>
        <span className="heat-caption">最近 12 周 · 点击补打卡</span>
      </div>
    </div>
  )
}

function HabitCard({
  habit,
  onToggle,
  onEdit,
  onDelete
}: {
  habit: HabitWithStats
  onToggle: (date: string) => void
  onEdit: () => void
  onDelete: () => void
}): React.ReactNode {
  const today = todayKey()
  const doneToday = habit.logs.some((log) => log.logDate === today)

  return (
    <article className="habit-card">
      <header className="habit-head">
        <span
          className="habit-icon"
          style={{ background: `${habit.color}22`, color: habit.color }}
        >
          {habit.icon || '✓'}
        </span>
        <div className="habit-title">
          <h2>{habit.name}</h2>
          <span>
            连续 {habit.currentStreak} 天 · 本周 {habit.weekCount}/{habit.targetPerWeek}
          </span>
        </div>
        <button
          type="button"
          className={`habit-check ${doneToday ? 'done' : ''}`}
          style={
            doneToday
              ? {
                  background: habit.color,
                  borderColor: habit.color,
                  color: textOn(habit.color)
                }
              : { borderColor: habit.color, color: habit.color }
          }
          aria-label={doneToday ? '取消今日打卡' : '今日打卡'}
          title={doneToday ? '取消今日打卡' : '今日打卡'}
          onClick={() => onToggle(today)}
        >
          <Icon name={doneToday ? 'check' : 'plus'} size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="编辑习惯"
          title="编辑习惯"
          onClick={onEdit}
        >
          <Icon name="pencil" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn danger"
          aria-label="删除习惯"
          title="删除习惯"
          onClick={onDelete}
        >
          <Icon name="trash" size={14} />
        </button>
      </header>

      <HabitHeatmap habit={habit} onToggle={onToggle} />

      <div className="habit-stats">
        <span>最长连续 {habit.longestStreak} 天</span>
        <span>近一年 {habit.logs.length} 次</span>
      </div>
    </article>
  )
}

function HabitModal({
  habit = null,
  onClose,
  onSaved
}: {
  habit?: HabitWithStats | null
  onClose: () => void
  onSaved: () => void
}): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [name, setName] = useState(habit?.name ?? '')
  const [icon, setIcon] = useState(habit?.icon ?? '')
  const [color, setColor] = useState(habit?.color ?? HABIT_COLORS[0])
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(
    habit?.frequency ?? 'daily'
  )
  const [target, setTarget] = useState(habit?.targetPerWeek ?? 7)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      if (habit) {
        await window.api.habits.update(habit.id, {
          name,
          icon: icon.trim() || null,
          color,
          frequency,
          targetPerWeek: target
        })
      } else {
        await window.api.habits.create({
          name,
          icon: icon.trim() || null,
          color,
          frequency,
          targetPerWeek: target
        })
      }
      onSaved()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const archive = async (): Promise<void> => {
    if (!habit) return
    try {
      await window.api.habits.update(habit.id, { archived: true })
      onSaved()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <Modal title={habit ? '编辑习惯' : '新建习惯'} onClose={onClose} width={440}>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="例如：喝水、阅读、跑步"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">图标（可选）</span>
        <input
          className="input"
          value={icon}
          maxLength={2}
          placeholder="例如 💧"
          onChange={(event) => setIcon(event.target.value)}
        />
      </label>
      <div className="field">
        <span className="field-label">颜色</span>
        <div className="color-swatches">
          {HABIT_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={`color-swatch ${color === item ? 'selected' : ''}`}
              style={{ background: item }}
              aria-label={`颜色 ${item}`}
              onClick={() => setColor(item)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">频率</span>
        <div className="segmented">
          <button
            type="button"
            className={frequency === 'daily' ? 'selected' : ''}
            onClick={() => setFrequency('daily')}
          >
            每天
          </button>
          <button
            type="button"
            className={frequency === 'weekly' ? 'selected' : ''}
            onClick={() => setFrequency('weekly')}
          >
            每周
          </button>
        </div>
      </div>
      <label className="field">
        <span className="field-label">每周目标</span>
        <input
          className="input"
          type="number"
          min={1}
          max={7}
          value={target}
          onChange={(event) =>
            setTarget(Math.min(7, Math.max(1, Number(event.target.value) || 1)))
          }
        />
      </label>
      <div className="modal-actions">
        {habit ? (
          <button type="button" className="btn" onClick={() => void archive()}>
            归档
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          {habit ? '保存' : '创建'}
        </button>
      </div>
    </Modal>
  )
}

export function HabitsView(): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [habits, setHabits] = useState<HabitWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HabitWithStats | null>(null)
  const [editTarget, setEditTarget] = useState<HabitWithStats | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setHabits(await window.api.habits.list())
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggle = async (habit: HabitWithStats, date: string): Promise<void> => {
    try {
      await window.api.habits.toggle(habit.id, date)
      await load()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.api.habits.remove(id)
      setDeleteTarget(null)
      await load()
      showToast('已删除习惯', 'info')
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <div className="habits">
      <div className="habits-toolbar">
        <div>
          <strong>{habits.length}</strong>
          <span> 个习惯</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} />
          新建习惯
        </button>
      </div>

      {loading ? (
        <div className="skeleton-list">
          {[0, 1, 2].map((index) => (
            <div className="skeleton-row" key={index}>
              <span className="skeleton-check" />
              <span className="skeleton-lines">
                <span className="skeleton-line w1" />
                <span className="skeleton-line w2" />
              </span>
            </div>
          ))}
        </div>
      ) : habits.length === 0 ? (
        <div className="empty-state">
          <Icon name="habit" size={44} className="empty-icon" />
          <h2>还没有习惯</h2>
          <p>从一个小习惯开始，每天打卡，连续天数会记录在这里。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} />
            新建习惯
          </button>
        </div>
      ) : (
        <div className="habit-grid">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggle={(date) => void toggle(habit, date)}
              onEdit={() => setEditTarget(habit)}
              onDelete={() => setDeleteTarget(habit)}
            />
          ))}
        </div>
      )}

      {modalOpen ? (
        <HabitModal
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false)
            void load()
          }}
        />
      ) : null}

      {editTarget ? (
        <HabitModal
          habit={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            void load()
          }}
        />
      ) : null}

      {deleteTarget ? (
        <Modal
          title="删除习惯"
          onClose={() => setDeleteTarget(null)}
          width={400}
        >
          <p className="modal-text">
            习惯「{deleteTarget.name}」及其打卡记录会被删除，此操作不可恢复。
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void remove(deleteTarget.id)}
            >
              删除
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
