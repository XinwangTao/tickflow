import { useEffect, useRef, useState } from 'react'
import { AI_CANCELED_SUMMARY_HINT, type AiTodaySummary } from '@shared/ai'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

/** 今日视图内的 AI 计划总结卡片：按需生成，失败时展示本地统计文案。 */
export function AiDailySummary(): React.ReactNode {
  const aiEnabled = useAppStore((state) => state.settings.aiEnabled)
  const aiTimeoutMs = useAppStore((state) => state.settings.aiTimeoutMs)
  const showToast = useAppStore((state) => state.showToast)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [summary, setSummary] = useState<AiTodaySummary | null>(null)
  const [source, setSource] = useState<'ai' | 'rule' | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  // 每次生成都带自增 requestId：取消或重新生成后，迟到的响应直接丢弃。
  const requestSeq = useRef(0)
  const activeRequest = useRef<string | null>(null)

  // 请求期间显示已等待秒数：与快速添加一致，用户能分清“正在生成”和“界面卡住”。
  useEffect(() => {
    if (!loading) {
      setElapsed(0)
      return
    }
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  // 卡片卸载（例如切到别的视图）时中止进行中的请求，不在后台白等超时。
  useEffect(() => {
    return () => {
      const active = activeRequest.current
      if (!active) return
      activeRequest.current = null
      try {
        void window.api.ai.cancel(active).catch(() => undefined)
      } catch {
        // 旧 preload 或测试桩没有 cancel 时忽略，不影响卸载。
      }
    }
  }, [])

  if (!aiEnabled) return null

  const aiTimeoutSeconds = Math.max(1, Math.round((aiTimeoutMs || 15000) / 1000))

  const generate = async (): Promise<void> => {
    if (loading) return
    const requestId = `summary-${(requestSeq.current += 1)}`
    activeRequest.current = requestId
    setLoading(true)
    try {
      const response = await window.api.ai.dailySummary(requestId)
      // 已取消或被新的生成请求取代：结果一律丢弃，不覆盖卡片内容。
      if (activeRequest.current !== requestId) return
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
      if (activeRequest.current !== requestId) return
      showToast(`生成今日总结失败：${String(error)}`, 'error', { duration: 5000 })
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  /** 取消进行中的生成：先让 main 中止 fetch，再丢弃响应，卡片保留上一次结果。 */
  const cancelGenerate = (): void => {
    const active = activeRequest.current
    if (!active) return
    activeRequest.current = null
    setLoading(false)
    setElapsed(0)
    try {
      void window.api.ai.cancel(active).catch(() => undefined)
    } catch {
      // 与卸载清理一致：没有 cancel 能力时不影响界面复位。
    }
    showToast(`${AI_CANCELED_SUMMARY_HINT}，可随时重新生成`, 'info')
  }

  return (
    <section className="ai-summary-card">
      <div className="ai-summary-head">
        <span className="ai-summary-title">
          <Icon name="sparkles" size={14} /> AI 今日总结
        </span>
        <div className="ai-summary-actions">
          {loading ? (
            <button
              type="button"
              className="btn ai-summary-cancel"
              title="取消本次生成（不必等满超时）"
              aria-label="取消 AI 总结生成"
              onClick={cancelGenerate}
            >
              取消
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={loading}
            title={`超过 ${aiTimeoutSeconds} 秒自动回落到本地统计`}
            onClick={() => void generate()}
          >
            {loading ? (elapsed > 0 ? `生成中 ${elapsed}s` : '生成中…') : summary ? '刷新' : '生成'}
          </button>
        </div>
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
