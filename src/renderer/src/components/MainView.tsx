import type { ViewKey } from '@shared/types'
import { todayKey } from '@shared/dates'
import { useAppStore } from '../store/useAppStore'
import { BatchBar } from './BatchBar'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { EmptyState } from './EmptyState'
import { HabitsView } from './HabitsView'
import { Icon } from './Icon'
import { MatrixView } from './MatrixView'
import { PomodoroView } from './PomodoroView'
import { QuickAdd } from './QuickAdd'
import { StatsView } from './StatsView'
import { TaskList } from './TaskList'
import { TimelineView } from './TimelineView'
import { ViewSwitcher } from './ViewSwitcher'

function titleFor(view: ViewKey, lists: Array<{ id: string; name: string }>): string {
  switch (view) {
    case 'today':
      return '今天'
    case 'next7':
      return '最近 7 天'
    case 'inbox':
      return '收集箱'
    case 'completed':
      return '已完成'
    case 'abandoned':
      return '已放弃'
    case 'trash':
      return '垃圾箱'
    case 'calendar':
      return '日历'
    case 'matrix':
      return '四象限'
    case 'habits':
      return '习惯'
    case 'pomodoro':
      return '番茄专注'
    case 'stats':
      return '统计'
    default: {
      const id = view.slice(5)
      return lists.find((list) => list.id === id)?.name ?? '清单'
    }
  }
}

function headerDate(): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }).format(new Date())
  } catch {
    return ''
  }
}

export function MainView(): React.ReactNode {
  const view = useAppStore((state) => state.view)
  const tasks = useAppStore((state) => state.tasks)
  const lists = useAppStore((state) => state.lists)
  const settings = useAppStore((state) => state.settings)
  const loading = useAppStore((state) => state.loading)
  const listMode = useAppStore((state) => state.listMode)
  const selectionMode = useAppStore((state) => state.selectionMode)
  const selectedIds = useAppStore((state) => state.selectedIds)
  const setSelectionMode = useAppStore((state) => state.setSelectionMode)
  const toggleSelection = useAppStore((state) => state.toggleSelection)
  const calendarMonth = useAppStore((state) => state.calendarMonth)
  const shiftCalendarMonth = useAppStore((state) => state.shiftCalendarMonth)
  const setCalendarMonth = useAppStore((state) => state.setCalendarMonth)
  const setSettings = useAppStore((state) => state.setSettings)

  const isCalendar = view === 'calendar'
  const isMatrix = view === 'matrix'
  const isHabits = view === 'habits'
  const isPomodoro = view === 'pomodoro'
  const isStats = view === 'stats'
  const isSpecial = isHabits || isPomodoro || isStats
  const isTaskView = !isCalendar && !isMatrix && !isSpecial
  const isList = view.startsWith('list:')
  const isFlat = view === 'completed' || view === 'abandoned' || view === 'trash'
  const isOpenView = isList || view === 'today' || view === 'next7' || view === 'inbox'
  const effectiveMode = isFlat ? 'list' : listMode
  const showList = !isList

  const defaultListId = isList
    ? view.slice(5)
    : settings.defaultListId ?? lists.find((list) => list.isInbox)?.id ?? lists[0]?.id ?? ''

  const title = titleFor(view, lists)

  return (
    <main className="main">
      <header className="main-header">
        <div className="main-title-wrap">
          <h1 className="main-title">{title}</h1>
          {isSpecial ? null : <span className="main-count">{tasks.length}</span>}
          {view === 'today' ? <span className="main-date">· {headerDate()}</span> : null}
        </div>
        <div className="main-actions">
          {isTaskView && !isFlat ? <ViewSwitcher /> : null}
          {isTaskView && !isFlat && listMode === 'list' ? (
            <button
              type="button"
              className={`icon-btn ${selectionMode ? 'active' : ''}`}
              title={selectionMode ? '退出多选' : '多选任务'}
              aria-label={selectionMode ? '退出多选' : '多选任务'}
              onClick={() => setSelectionMode(!selectionMode)}
            >
              <Icon name="check-circle" size={17} />
            </button>
          ) : null}
          {isList ? (
            <button
              type="button"
              className={`icon-btn ${settings.showCompleted ? 'active' : ''}`}
              title={settings.showCompleted ? '隐藏已完成任务' : '显示已完成任务'}
              aria-label={settings.showCompleted ? '隐藏已完成任务' : '显示已完成任务'}
              onClick={() => void setSettings({ showCompleted: !settings.showCompleted })}
            >
              <Icon name="check-circle" size={17} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            title="设置"
            aria-label="设置"
            onClick={() => useAppStore.getState().setSettingsOpen(true)}
          >
            <Icon name="settings" size={17} />
          </button>
        </div>
      </header>

      <div className="main-scroll">
        {isCalendar ? (
          <CalendarView
            tasks={tasks}
            month={calendarMonth}
            weekStart={settings.weekStart}
            onShiftMonth={shiftCalendarMonth}
            onSetMonth={setCalendarMonth}
          />
        ) : isMatrix ? (
          <MatrixView tasks={tasks} />
        ) : isHabits ? (
          <HabitsView />
        ) : isPomodoro ? (
          <PomodoroView />
        ) : isStats ? (
          <StatsView />
        ) : (
          <>
            {isOpenView ? (
              <QuickAdd
                defaultListId={defaultListId}
                defaultDueDate={view === 'today' || view === 'next7' ? todayKey() : null}
              />
            ) : null}

            {loading ? (
              <div className="skeleton-list" aria-label="加载中">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div className="skeleton-row" key={index}>
                    <span className="skeleton-check" />
                    <span className="skeleton-lines">
                      <span className="skeleton-line w1" />
                      <span className="skeleton-line w2" />
                    </span>
                  </div>
                ))}
              </div>
            ) : effectiveMode === 'board' ? (
              <BoardView tasks={tasks} lists={lists} />
            ) : effectiveMode === 'timeline' ? (
              <TimelineView tasks={tasks} />
            ) : tasks.length === 0 ? (
              <EmptyState view={view} />
            ) : (
              <TaskList
                tasks={tasks}
                view={view}
                showList={showList}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelection}
              />
            )}
          </>
        )}
      </div>

      <BatchBar />
    </main>
  )
}
