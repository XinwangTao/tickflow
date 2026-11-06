import { useState } from 'react'
import type { AiTodaySummary } from '@shared/ai'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

/** 今日视图内的 AI 计划总结卡片：按需生成，失败时展示本地统计文案。 */
export function AiDailySummary(): React.ReactNode {
  const aiEnabled = useAppStore((state) => state.settings.aiEnabled)
  const showToast = useAppStore((state) => state.showToast)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<AiTodaySummary | null>(null)
  const [source, setSource] = useState<'ai' | 'rule' | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  if (!aiEnabled) return null

  const generate = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    try {
      const response = await window.api.ai.dailySummary()
      setSummary(response.summary)
      setSource(response.source)
      setWarning(response.warning)
      if (!response.ok) {
        // 失败提示里已说明原因（超时秒数 / 服务地址 / 模型），这里再给一个“重试”入口，
        // 网络抖动恢复后无需先刷新页面。
        showToast(
          `AI 总结不可用，已使用本地统计生成${response.warning ? `：${response.warning}` : ''}`,
          'info',
          {
            duration: 7000,
            actionLabel: '重试',
            action: () => generate()
          }
        )
      }
    } catch (error) {
      showToast(`生成今日总结失败：${String(error)}`, 'error', { duration: 5000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="ai-summary-card">
      <div className="ai-summary-head">
        <span className="ai-summary-title">
          <Icon name="sparkles" size={14} /> AI 今日总结
        </span>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void generate()}
        >
          {loading ? '生成中…' : summary ? '刷新' : '生成'}
        </button>
      </div>

      {loading ? (
        <p className="ai-summary-empty">正在分析今天的任务…</p>
      ) : summary ? (
        <>
          <p className="ai-summary-text">{summary.summary}</p>
          {summary.highlights.length > 0 ? (
            <ul className="ai-summary-list">
              {summary.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {summary.suggestions.length > 0 ? (
            <ul className="ai-summary-list">
              {summary.suggestions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {source === 'rule' ? (
            <p className="ai-summary-note">
              AI 不可用，已使用本地统计生成{warning ? `（${warning}）` : ''}。
            </p>
          ) : null}
        </>
      ) : (
        <p className="ai-summary-empty">
          点击「生成」让 AI 结合今天的任务给出重点与建议；超时会自动回落到本地统计。
        </p>
      )}
    </section>
  )
}
