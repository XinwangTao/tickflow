import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/src/components/SettingsDialog'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import {
  AI_CANCELED_MODELS_HINT,
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS,
  type AiModelsResult
} from '../src/shared/ai'
import type { Settings } from '../src/shared/types'

/**
 * 设置页模型目录的失败重试与取消：
 * - 加载中显示已等待秒数并可取消，设置页关闭时也会中止请求；
 * - 失败 toast 带「重试」入口，恢复后目录下拉框出现；
 * - 取消与失败分开，不引导用户重试或调大超时。
 */

const SETTINGS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: 'inbox',
  showCompleted: false,
  autoLaunch: false,
  startMinimized: false,
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

const MODELS_OK: AiModelsResult = {
  ok: true,
  models: [{ id: 'ccs-claude-openai--ccs-claude-openai-2--kimi-k2.7-code', displayName: 'Kimi' }],
  message: '已获取 1 个本机模型',
  attempts: 1
}

const MODELS_FAILED: AiModelsResult = {
  ok: false,
  models: [],
  message: '获取模型列表失败：AI 服务繁忙，请稍后再试 · AI 模型列表返回 500（已自动重试 1 次）',
  attempts: 2
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

describe('设置页模型目录的失败重试与取消', () => {
  const models = vi.fn<(requestId?: string) => Promise<AiModelsResult>>()
  const cancel = vi.fn(async () => true)
  const setSettings = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      settings: SETTINGS,
      lists: [],
      toast: null,
      setSettings,
      showToast: (message, kind = 'info', options) => {
        useAppStore.setState({ toast: { id: Date.now(), message, kind, ...options } })
      }
    })
    ;(window as unknown as { api: unknown }).api = {
      app: { info: vi.fn(async () => ({ version: '0.1.0', platform: 'win32', dataDir: 'tmp' })) },
      ai: { models, cancel }
    }
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ toast: null })
  })

  it('获取成功后展示本机模型下拉框，并回报一次请求', async () => {
    models.mockResolvedValueOnce(MODELS_OK)
    render(createElement(SettingsDialog))

    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }))

    const catalog = await screen.findByLabelText(/本机模型/)
    expect(catalog).toBeInTheDocument()
    expect(models).toHaveBeenCalledTimes(1)
    expect(models.mock.calls[0][0]).toMatch(/^models-\d+$/)
    expect(useAppStore.getState().toast?.kind).toBe('success')
    expect(useAppStore.getState().toast?.message).toContain('已获取 1 个本机模型')
  })

  it('失败 toast 带重试入口，重试成功后目录出现且 requestId 不同', async () => {
    models.mockResolvedValueOnce(MODELS_FAILED).mockResolvedValueOnce(MODELS_OK)
    render(createElement(SettingsDialog))

    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }))
    await waitFor(() => expect(useAppStore.getState().toast?.message).toContain('获取模型列表失败'))

    const toast = useAppStore.getState().toast
    expect(toast?.kind).toBe('error')
    expect(toast?.actionLabel).toBe('重试')
    expect(toast?.message).toContain('AI 服务繁忙')
    // 失败时不展示空目录下拉框。
    expect(screen.queryByLabelText(/本机模型/)).toBeNull()

    await toast?.action?.()

    expect(await screen.findByLabelText(/本机模型/)).toBeInTheDocument()
    expect(models).toHaveBeenCalledTimes(2)
    expect(models.mock.calls[0][0]).not.toBe(models.mock.calls[1][0])
  })

  it('加载中可以取消，迟到的目录不再展示', async () => {
    const pending = deferred<AiModelsResult>()
    models.mockImplementationOnce(() => pending.promise)
    render(createElement(SettingsDialog))

    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }))
    const cancelButton = await screen.findByLabelText('取消获取模型列表')
    fireEvent.click(cancelButton)

    // 取消要精确落到刚才那次目录请求的 id 上，main 才能中止对应 fetch。
    const requestId = models.mock.calls[0][0]
    expect(requestId).toMatch(/^models-\d+$/)
    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(useAppStore.getState().toast?.message).toContain(AI_CANCELED_MODELS_HINT)
    expect(screen.queryByLabelText('取消获取模型列表')).toBeNull()
    expect(screen.getByRole('button', { name: '获取模型列表' })).toBeEnabled()

    // 请求在取消之后才返回：目录与提示都不应更新。
    pending.resolve(MODELS_OK)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByLabelText(/本机模型/)).toBeNull()
    expect(useAppStore.getState().toast?.message).toContain(AI_CANCELED_MODELS_HINT)
  })

  it('关闭设置页会中止进行中的目录请求', async () => {
    const pending = deferred<AiModelsResult>()
    models.mockImplementationOnce(() => pending.promise)
    const view = render(createElement(SettingsDialog))

    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }))
    await screen.findByLabelText('取消获取模型列表')
    const requestId = models.mock.calls[0][0]

    view.unmount()

    expect(cancel).toHaveBeenCalledWith(requestId)
    // 迟到的响应没有组件可更新，也不应写回 store。
    pending.resolve(MODELS_OK)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useAppStore.getState().toast).toBeNull()
  })
})
