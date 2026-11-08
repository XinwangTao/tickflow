import { useEffect, useState } from 'react'
import type { StatsOverview } from '@shared/types'
import { PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { AiWeeklyReview } from './AiWeeklyReview'

function niceMax(value: number): number {
  if (value <= 4) return 4
  const power = 10 ** Math.floor(Math.log10(value))
  const normalized = value / power
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * power
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

function weekdayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay()
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day]
}

function BarChart({
  data,
  color,
  unit,
  ariaLabel
}: {
  data: Array<{ label: string; value: number }>
  color: string
  unit: string
  ariaLabel: string
}): React.ReactNode {
  const max = niceMax(Math.max(...data.map((item) => item.value), 0))
  return (
    <div className="bar-chart" role="img" aria-label={ariaLabel}>
      <div className="chart-y" aria-hidden="true">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <div className="chart-gridline top" />
        <div className="chart-gridline mid" />
        <div className="bar-columns">
          {data.map((item) => (
            <div
              className="bar-col"
              key={item.label}
              tabIndex={0}
              title={`${item.label}：${item.value}${unit}`}
              aria-label={`${item.label}：${item.value}${unit}`}
            >
              <div className="bar-track">
                <div
                  className="bar"
                  style={{
                    height: item.value > 0 ? `${Math.max(2, (item.value / max) * 100)}%` : '0%',
                    background: color
                  }}
                />
              </div>
              <span className="bar-label">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function HBarChart({
  data,
  color,
  unit
}: {
  data: Array<{ label: string; value: number }>
  color: string
  unit: string
}): React.ReactNode {
  const max = Math.max(...data.map((item) => item.value), 1)
  return (
    <div className="hbar-chart">
      {data.map((item) => (
        <div
          className="hbar-row"
          key={item.label}
          tabIndex={0}
          title={`${item.label}：${item.value}${unit}`}
          aria-label={`${item.label}：${item.value}${unit}`}
        >
          <span className="hbar-label">{item.label}</span>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{
                width: item.value > 0 ? `${Math.max(2, (item.value / max) * 100)}%` : '0%',
                background: color
              }}
            />
          </div>
          <span className="hbar-value">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function DataTable({
  headers,
  rows
}: {
  headers: string[]
  rows: Array<Array<string | number>>
}): React.ReactNode {
  return (
    <table>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ChartCard({
  title,
  subtitle,
  children,
  table
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  table: React.ReactNode
}): React.ReactNode {
  return (
    <section className="chart-card">
      <header className="chart-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </header>
      {children}
      <details className="chart-table">
        <summary>数据表</summary>
        {table}
      </details>
    </section>
  )
}

export function StatsView(): React.ReactNode {
  const showToast = useAppStore((state) => state.showToast)
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.stats
      .overview()
      .then(setOverview)
      .catch((reason) => {
        const message = String(reason)
        setError(message)
        showToast(message, 'error')
      })
  }, [showToast])

  if (!overview) {
    return <div className="stats-loading">{error ?? '加载统计…'}</div>
  }

  const completedData = overview.completedByDay.map((item) => ({
    label: weekdayLabel(item.date),
    value: item.count
  }))
  const focusData = overview.focusByDay.map((item) => ({
    label: weekdayLabel(item.date),
    value: item.minutes
  }))
  const habitData = overview.habitByDay.map((item) => ({
    label: weekdayLabel(item.date),
    value: item.count
  }))
  const listData = overview.byList
    .filter((item) => item.count > 0)
    .map((item) => ({ label: item.name, value: item.count }))
  const priorityData = overview.byPriority.map((item) => ({
    label: PRIORITY_LABELS[item.priority as 0 | 1 | 2 | 3],
    value: item.count
  }))

  return (
    <div className="stats">
      <div className="kpi-row">
        <div className="kpi">
          <span>近 7 天完成</span>
          <strong>{overview.tasksCompleted7d}</strong>
          <small>近 30 天 {overview.tasksCompleted30d}</small>
        </div>
        <div className="kpi">
          <span>近 7 天专注</span>
          <strong>{formatMinutes(overview.focusMinutes7d)}</strong>
          <small>{overview.focusSessions7d} 个番茄</small>
        </div>
        <div className="kpi">
          <span>近 7 天打卡</span>
          <strong>{overview.habitCheckins7d}</strong>
          <small>
            {overview.topHabits[0] ? `最多：${overview.topHabits[0].name}` : '暂无习惯'}
          </small>
        </div>
        <div className="kpi">
          <span>逾期任务</span>
          <strong className={overview.overdue > 0 ? 'kpi-danger' : ''}>
            {overview.overdue}
          </strong>
          <small>近 7 天新增 {overview.tasksCreated7d}</small>
        </div>
      </div>

      <AiWeeklyReview overview={overview} />

      <div className="stats-grid">
        <ChartCard
          title="最近 7 天完成"
          subtitle={`共 ${overview.tasksCompleted7d} 个`}
          table={
            <DataTable
              headers={['日期', '完成']}
              rows={overview.completedByDay.map((item) => [item.date, item.count])}
            />
          }
        >
          <BarChart
            data={completedData}
            color="var(--chart-1)"
            unit=" 个"
            ariaLabel="最近 7 天完成任务数"
          />
        </ChartCard>

        <ChartCard
          title="专注时长"
          subtitle={`共 ${formatMinutes(overview.focusMinutes7d)}`}
          table={
            <DataTable
              headers={['日期', '分钟']}
              rows={overview.focusByDay.map((item) => [item.date, item.minutes])}
            />
          }
        >
          <BarChart
            data={focusData}
            color="var(--chart-2)"
            unit=" 分钟"
            ariaLabel="最近 7 天专注分钟数"
          />
        </ChartCard>

        <ChartCard
          title="未完成任务 · 按清单"
          table={
            <DataTable
              headers={['清单', '数量']}
              rows={overview.byList.map((item) => [item.name, item.count])}
            />
          }
        >
          {listData.length > 0 ? (
            <HBarChart data={listData} color="var(--chart-1)" unit=" 个" />
          ) : (
            <div className="chart-empty">暂无未完成任务</div>
          )}
        </ChartCard>

        <ChartCard
          title="未完成任务 · 按优先级"
          table={
            <DataTable
              headers={['优先级', '数量']}
              rows={overview.byPriority.map((item) => [
                PRIORITY_LABELS[item.priority as 0 | 1 | 2 | 3],
                item.count
              ])}
            />
          }
        >
          <HBarChart data={priorityData} color="var(--chart-1)" unit=" 个" />
        </ChartCard>

        <ChartCard
          title="习惯打卡"
          subtitle={`近 7 天 ${overview.habitCheckins7d} 次`}
          table={
            <DataTable
              headers={['日期', '次数']}
              rows={overview.habitByDay.map((item) => [item.date, item.count])}
            />
          }
        >
          <BarChart
            data={habitData}
            color="var(--chart-2)"
            unit=" 次"
            ariaLabel="最近 7 天习惯打卡次数"
          />
        </ChartCard>

        <ChartCard
          title="常打卡习惯"
          table={
            <DataTable
              headers={['习惯', '次数']}
              rows={overview.topHabits.map((item) => [item.name, item.count])}
            />
          }
        >
          {overview.topHabits.length > 0 ? (
            <ul className="top-habits">
              {overview.topHabits.map((habit) => (
                <li key={habit.id}>
                  <span className="list-dot" style={{ background: habit.color }} />
                  <span>{habit.name}</span>
                  <strong>{habit.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="chart-empty">还没有打卡记录</div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
