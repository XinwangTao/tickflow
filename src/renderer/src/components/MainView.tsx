import { lazy, Suspense, useState } from 'react'
import type { ViewKey } from '@shared/types'
import { todayKey } from '@shared/dates'
import { useAppStore } from '../store/useAppStore'
import { AiDailySummary } from './AiDailySummary'
import { BatchBar } from './BatchBar'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'
import { TaskList } from './TaskList'
import { ViewOptionsMenu } from './ViewOptionsMenu'
import { ViewSwitcher } from './ViewSwitcher'

// 非首屏视图按需加载，避免日历/看板/统计等重组件拖慢启动。
const BoardView = lazy(() =>
  import('./BoardView').then((module) => ({ default: module.BoardView }))
)
const CalendarView = lazy(() =>
  import('./CalendarView').then((module) => ({ default: module.CalendarView }))
)
const HabitsView = lazy(() =>
  import('./HabitsView').then((module) => ({ default: module.HabitsView }))
)
const MatrixView = lazy(() =>
  import('./MatrixView').then((module) => ({ default: module.MatrixView }))
)
const PomodoroView = lazy(() =>
  import('./PomodoroView').then((module) => ({ default: module.PomodoroView }))
)
const StatsView = lazy(() =>
  import('./StatsView').then((module) => ({ default: module.StatsView }))
)
const TemplatesView = lazy(() =>
  import('./TemplatesView').then((module) => ({ default: module.TemplatesView }))
)
const TimelineView = lazy(() =>
  import('./TimelineView').then((module) => ({ default: module.TimelineView }))
)

function titleFor(
  view: ViewKey,
  lists: Array<{ id: string; name: string }>,
  filters: Array<{ id: string; name: string }>
): string {
  if (view.startsWith('filter:')) {
    const id = view.slice(7)
    return filters.find((filter) => filter.id === id)?.name ?? '过滤器'
  }
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
    case 'templates':
      return '模板'
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

function ViewFallback(): React.ReactNode {
  return (
    <div className="skeleton-list" aria-label="正在加载视图">
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
  )
}

export function MainView(): React.ReactNode {
  const view = useAppStore((state) => state.view)
  const tasks = useAppStore((state) => state.tasks)
  const lists = useAppStore((state) => state.lists)
  const filters = useAppStore((state) => state.filters)
  const settings = useAppStore((state) => state.settings)
  const loading = useAppStore((state) => state.loading)
  const listMode = useAppStore((state) => state.listMode)
  const sortBy = useAppStore((state) => state.sortBy)
  const groupBy = useAppStore((state) => state.groupBy)
  const selectionMode = useAppStore((state) => state.selectionMode)
  const selectedIds = useAppStore((state) => state.selectedIds)
  const setSelectionMode = useAppStore((state) => state.setSelectionMode)
  const toggleSelection = useAppStore((state) => state.toggleSelection)
  const calendarMonth = useAppStore((state) => state.calendarMonth)
  const shiftCalendarMonth = useAppStore((state) => state.shiftCalendarMonth)
  const setCalendarMonth = useAppStore((state) => state.setCalendarMonth)
  const setSettings = useAppStore((state) => state.setSettings)
  const emptyTrash = useAppStore((state) => state.emptyTrash)
  const clearCompleted = useAppStore((state) => state.clearCompleted)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)

  const isCalendar = view === 'calendar'
  const isMatrix = view === 'matrix'
  const isHabits = view === 'habits'
  const isPomodoro = view === 'pomodoro'
  const isStats = view === 'stats'
  const isTemplates = view === 'templates'
  const isFilter = view.startsWith('filter:')
  const isSpecial = isHabits || isPomodoro || isStats || isTemplates
  const isTaskView = !isCalendar && !isMatrix && !isSpecial
  const isList = view.startsWith('list:')
  const isFlat = view === 'completed' || view === 'abandoned' || view === 'trash'
  const isOpenView =
    isList || view === 'today' || view === 'next7' || view === 'inbox'
  const effectiveMode = isFlat ? 'list' : listMode
  const showList = !isList

  const defaultListId = isList
    ? view.slice(5)
    : settings.defaultListId ?? lists.find((list) => list.isInbox)?.id ?? lists[0]?.id ?? ''

  const title = titleFor(view, lists, filters)

  return (
    <main className="main">
      <header className="main-header">
        <div className="main-title-wrap">
          <h1 className="main-title">{title}</h1>
          {isSpecial ? null : <span className="main-count">{tasks.length}</span>}
          {view === 'today' ? <span className="main-date">· {headerDate()}</span> : null}
        </div>
        <div className="main-actions">
          {isTaskView && !isFlat && !isFilter ? <ViewSwitcher /> : null}
          {isTaskView && !isFlat && listMode !== 'timeline' ? <ViewOptionsMenu /> : null}
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
          {view === 'trash' ? (
            <button
              type="button"
              className="icon-btn danger"
              title="清空垃圾箱"
              aria-label="清空垃圾箱"
              disabled={tasks.length === 0}
              onClick={() => setConfirmEmptyTrash(true)}
            >
              <Icon name="trash" size={17} />
            </button>
          ) : null}
          {isList && settings.showCompleted ? (
            <button
              type="button"
              className="icon-btn"
              title="清除已完成"
              aria-label="清除已完成"
              onClick={() => void clearCompleted()}
            >
              <Icon name="trash" size={17} />
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
        <Suspense fallback={<ViewFallback />}>
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
        ) : isTemplates ? (
          <TemplatesView />
        ) : (
          <>
            {isOpenView ? (
              <QuickAdd
                defaultListId={defaultListId}
                defaultDueDate={view === 'today' || view === 'next7' ? todayKey() : null}
              />
            ) : null}

            {view === 'today' ? <AiDailySummary /> : null}

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
              <BoardView tasks={tasks} lists={lists} groupBy={groupBy} />
            ) : effectiveMode === 'timeline' ? (
              <TimelineView tasks={tasks} />
            ) : tasks.length === 0 ? (
              <EmptyState view={view} />
            ) : (
              <TaskList
                tasks={tasks}
                view={view}
                showList={showList}
                sortBy={sortBy}
                groupBy={groupBy}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelection}
              />
            )}
          </>
        )}
        </Suspense>
      </div>

      <BatchBar />

      {confirmEmptyTrash ? (
        <ConfirmDialog
          title="清空垃圾箱"
          danger
          confirmLabel="永久删除"
          message={`垃圾箱中的 ${tasks.length} 个任务将被永久删除，无法恢复。`}
          onClose={() => setConfirmEmptyTrash(false)}
          onConfirm={async () => {
            setConfirmEmptyTrash(false)
            await emptyTrash()
          }}
        />
      ) : null}
    </main>
  )
}
