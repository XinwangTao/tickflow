import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiDailySummary } from '../src/renderer/src/components/AiDailySummary'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import {
  AI_CANCELED_SUMMARY_HINT,
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS,
  type AiSummaryResponse
} from '../src/shared/ai'
import type { Settings } from '../src/shared/types'

/**
 * 今日总结卡片的取消与失败重试：
 * - 生成中可以取消，main 里那次 fetch 会被精确中止，迟到的响应不能覆盖卡片；
 * - 失败时展示本地统计，并保留 toast「重试」入口，恢复后切回 AI 文案。
 */

const SETTINGS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: 'inbox',
  showCompleted: false,
  fontScale: 1,
  r2Endpoint: '',
  r2Bucket: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2Prefix: 'tickflow/snapshots/',
  r2AutoSync: false,
  r2LastSync: null,
  aiEnabled: true,
  aiBaseUrl: AI_DEFAULT_BASE_URL,
  aiModel: AI_DEFAULT_MODEL,
  aiToken: '',
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function aiResponse(text: string): AiSummaryResponse {
  return {
    ok: true,
    source: 'ai',
    warning: null,
    attempts: 1,
    summary: {
      summary: text,
      highlights: ['下一个时间点：15:00 交周报'],
      suggestions: ['先处理逾期任务']
    }
  }
}

function ruleResponse(warning: string): AiSummaryResponse {
  return {
    ok: false,
    source: 'rule',
    warning,
    attempts: 2,
    summary: {
      summary: '本地统计：今天剩余 2 个任务。',
      highlights: [],
      suggestions: []
    }
  }
}

describe('AI 今日总结的取消与失败重试', () => {
  const dailySummary = vi.fn<(requestId?: string) => Promise<AiSummaryResponse>>()
  const cancel = vi.fn(async () => true)

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      settings: SETTINGS,
      toast: null,
      showToast: (message, kind = 'info', options) => {
        useAppStore.setState({ toast: { id: Date.now(), message, kind, ...options } })
      }
    })
    ;(window as unknown as { api: unknown }).api = { ai: { dailySummary, cancel } }
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ toast: null })
  })

  it('生成成功后展示 summary、重点与建议', async () => {
    dailySummary.mockResolvedValueOnce(aiResponse('今天先交周报，再准备复盘。'))

    render(createElement(AiDailySummary))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))

    expect(await screen.findByText('今天先交周报，再准备复盘。')).toBeInTheDocument()
    expect(screen.getByText('下一个时间点：15:00 交周报')).toBeInTheDocument()
    expect(screen.getByText('先处理逾期任务')).toBeInTheDocument()
    expect(screen.queryByText(/已使用本地统计生成/)).toBeNull()
    // 完成后按钮变成「刷新」，不再有取消入口。
    expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled()
    expect(screen.queryByLabelText('取消 AI 总结生成')).toBeNull()
  })

  it('生成中可取消，迟到的响应不会覆盖卡片', async () => {
    const pending = deferred<AiSummaryResponse>()
    dailySummary.mockImplementationOnce(() => pending.promise)

    render(createElement(AiDailySummary))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))

    fireEvent.click(await screen.findByLabelText('取消 AI 总结生成'))

    // 取消要精确落到刚才那次请求的 id 上，main 才能中止对应的 fetch。
    const requestId = dailySummary.mock.calls[0][0]
    expect(requestId).toMatch(/^summary-\d+$/)
    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(useAppStore.getState().toast?.message).toContain(AI_CANCELED_SUMMARY_HINT)

    // 请求在取消之后才返回：结果被丢弃，卡片保持未生成状态。
    pending.resolve(aiResponse('迟到的 AI 总结'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('迟到的 AI 总结')).toBeNull()
    expect(screen.getByRole('button', { name: '生成' })).toBeEnabled()
    expect(screen.queryByLabelText('取消 AI 总结生成')).toBeNull()
  })

  it('失败时回落到本地统计，可从 toast 重试并切回 AI 文案', async () => {
    dailySummary
      .mockResolvedValueOnce(ruleResponse('AI 请求超时（15 秒），可在设置里调大超时或换更快的模型'))
      .mockResolvedValueOnce(aiResponse('重试后的 AI 总结'))

    render(createElement(AiDailySummary))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))

    await waitFor(() =>
      expect(screen.getByText('本地统计：今天剩余 2 个任务。')).toBeInTheDocument()
    )
    expect(screen.getByText(/已使用本地统计生成/)).toBeInTheDocument()

    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('AI 总结不可用')
    expect(toast?.message).toContain('AI 请求超时（15 秒）')
    expect(toast?.actionLabel).toBe('重试')

    await toast?.action?.()

    await waitFor(() => expect(screen.getByText('重试后的 AI 总结')).toBeInTheDocument())
    expect(screen.queryByText(/已使用本地统计生成/)).toBeNull()
    expect(dailySummary).toHaveBeenCalledTimes(2)
    // 两次请求使用不同的 requestId，避免旧响应被当成新请求的结果。
    expect(dailySummary.mock.calls[0][0]).not.toBe(dailySummary.mock.calls[1][0])
  })

  it('关闭 AI 时不渲染卡片，也不发请求', () => {
    useAppStore.setState({ settings: { ...SETTINGS, aiEnabled: false } })

    render(createElement(AiDailySummary))

    expect(screen.queryByText('AI 今日总结')).toBeNull()
    expect(dailySummary).not.toHaveBeenCalled()
  })
})
