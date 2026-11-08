import { useEffect, useRef, useState } from 'react'
import type { AiWeeklyReview as AiWeeklyReviewData } from '@shared/ai'
import type { StatsOverview } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

/** 统计页的 AI 周复盘卡片：点击才生成，AI 不可用时显示本地统计版。 */
export function AiWeeklyReview({ overview }: { overview: StatsOverview }): React.ReactNode {
  const aiEnabled = useAppStore((state) => state.settings.aiEnabled)
  const [loading, setLoading] = useState(false)
  const [review, setReview] = useState<AiWeeklyReviewData | null>(null)
  const [source, setSource] = useState<'ai' | 'rule' | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const activeRequest = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      const active = activeRequest.current
      if (!active) return
      activeRequest.current = null
      void window.api.ai.cancel(active).catch(() => undefined)
    }
  }, [])

  if (!aiEnabled) return null

  const generate = async (): Promise<void> => {
    if (loading) return
    const requestId = `weekly-${(requestSeq.current += 1)}`
    activeRequest.current = requestId
    setLoading(true)
    try {
      const days = overview.completedByDay.map((item) => ({
        date: item.date,
        completed: item.count,
        focusMinutes: overview.focusByDay.find((focus) => focus.date === item.date)?.minutes ?? 0
      }))
      const response = await window.api.ai.weeklyReview(
        {
          startDate: days[0]?.date ?? '',
          endDate: days[days.length - 1]?.date ?? '',
          days,
          overdue: overview.overdue,
          createdTotal: overview.tasksCreated7d,
          completedTotal: overview.tasksCompleted7d
        },
        requestId
      )
      if (activeRequest.current !== requestId) return
      setReview(response.review)
      setSource(response.source)
      setWarning(response.warning)
    } catch (reason) {
      if (activeRequest.current === requestId) setWarning(String(reason))
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  return (
    <section className="ai-summary-card ai-weekly-card">
      <div className="ai-summary-head">
        <span className="ai-summary-title">AI 周复盘</span>
        <div className="ai-summary-actions">
          <button type="button" className="btn" disabled={loading} onClick={() => void generate()}>
            {loading ? '生成中…' : review ? '重新生成' : '生成复盘'}
          </button>
        </div>
      </div>
      {warning ? <p className="ai-summary-warning">{warning}{source === 'rule' ? '（本地统计版）' : ''}</p> : null}
      {review ? (
        <div className="ai-summary-body">
          <p className="ai-summary-text">{review.summary}</p>
          {review.wins.length > 0 ? (
            <div>
              <h4>做得好</h4>
              <ul className="ai-summary-list">
                {review.wins.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {review.risks.length > 0 ? (
            <div>
              <h4>风险</h4>
              <ul className="ai-summary-list">
                {review.risks.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {review.nextWeek.length > 0 ? (
            <div>
              <h4>下周建议</h4>
              <ul className="ai-summary-list">
                {review.nextWeek.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {source ? <small className="ai-summary-source">{source === 'ai' ? 'AI 生成' : '本地统计'}</small> : null}
        </div>
      ) : (
        <p className="ai-summary-empty">把本周完成、逾期和专注时长交给 AI，生成复盘和下周建议。</p>
      )}
    </section>
  )
}
