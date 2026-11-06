import { describe, expect, it } from 'vitest'
import {
  AI_CANCELED_MESSAGE,
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  describeAiFailure,
  isAiCanceled,
  type AiConfig
} from '../src/shared/ai'
import {
  activeAiRequestCount,
  cancelAiRequest,
  parseQuickAddWithAi,
  registerAiRequest,
  releaseAiRequest
} from '../src/main/ai'
import { requestAiTextResult, type FetchLike } from '../src/main/ai-client'

/**
 * 取消 AI 请求：
 * - 取消与超时都表现为 AbortError，但提示与重试策略完全不同，必须分开；
 * - main 进程维护 requestId → AbortController 的注册表，renderer 的「取消」按钮靠它中止 fetch；
 * - 注册表在请求结束时必须清空，不能随使用时长堆积。
 */

const NOW = new Date(2026, 10, 5, 9, 0, 0)

const CONFIG: AiConfig = {
  enabled: true,
  baseUrl: AI_DEFAULT_BASE_URL,
  model: AI_DEFAULT_MODEL,
  token: '',
  timeoutMs: 5000
}

function abortError(): Error {
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'
  return error
}

/** 永不返回的 fetch：只有收到的 signal 中止时才 reject，用来模拟推理模型的长响应。 */
function hangingFetch(): { fetch: FetchLike; calls: () => number } {
  let count = 0
  const fetchImpl: FetchLike = (_url, init) => {
    count += 1
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      signal?.addEventListener('abort', () => reject(abortError()), { once: true })
    })
  }
  return { fetch: fetchImpl, calls: () => count }
}

const REQUEST = {
  system: 'system',
  prompt: 'prompt',
  maxTokens: 32
}

describe('取消 AI 请求', () => {
  it('外部 signal 中止时抛出取消错误，且不会自动重试', async () => {
    const hanging = hangingFetch()
    const controller = new AbortController()
    const pending = requestAiTextResult(CONFIG, REQUEST, {
      fetch: hanging.fetch,
      signal: controller.signal,
      maxAttempts: 3,
      retryDelayMs: 0
    })

    controller.abort()

    await expect(pending).rejects.toThrow(AI_CANCELED_MESSAGE)
    // 取消不是瞬时故障：即使配置了 3 次尝试也只发一次请求。
    expect(hanging.calls()).toBe(1)
    await expect(pending).rejects.toMatchObject({ attempts: 1 })
  })

  it('已经取消的 signal 不会发出任何请求', async () => {
    const hanging = hangingFetch()
    const controller = new AbortController()
    controller.abort()

    await expect(
      requestAiTextResult(CONFIG, REQUEST, { fetch: hanging.fetch, signal: controller.signal })
    ).rejects.toThrow(AI_CANCELED_MESSAGE)
    expect(hanging.calls()).toBe(0)
  })

  it('没有取消信号时仍然按超时提示，不会误报「已取消」', async () => {
    const hanging = hangingFetch()
    const pending = requestAiTextResult({ ...CONFIG, timeoutMs: 20 }, REQUEST, {
      fetch: hanging.fetch,
      maxAttempts: 1
    })

    await expect(pending).rejects.toThrow('AI 请求超时')
    await expect(pending).rejects.not.toThrow(AI_CANCELED_MESSAGE)
  })

  it('失败分类把取消归为 canceled、不重试，且不提示调大超时', () => {
    const info = describeAiFailure(new Error(AI_CANCELED_MESSAGE), CONFIG, 1)
    expect(info.kind).toBe('canceled')
    expect(info.retryable).toBe(false)
    expect(info.hint).toContain('已取消 AI 解析')
    expect(info.hint).not.toContain('调大超时')

    expect(isAiCanceled(new Error(AI_CANCELED_MESSAGE))).toBe(true)
    expect(isAiCanceled(new Error('AI 请求超时'))).toBe(false)
  })

  it('requestId 注册表：取消未知/已结束的请求返回 false，结束后不泄漏', () => {
    const before = activeAiRequestCount()
    expect(cancelAiRequest('not-exist')).toBe(false)
    expect(cancelAiRequest('')).toBe(false)

    const controller = registerAiRequest('quick-add-1')
    expect(controller).not.toBeNull()
    expect(activeAiRequestCount()).toBe(before + 1)

    expect(cancelAiRequest('quick-add-1')).toBe(true)
    expect(controller?.signal.aborted).toBe(true)
    // 取消后同 id 再取消一次是空操作。
    expect(cancelAiRequest('quick-add-1')).toBe(false)
    expect(activeAiRequestCount()).toBe(before)

    // 正常结束走 release，同样不能残留。
    const second = registerAiRequest('quick-add-2')
    expect(second).not.toBeNull()
    releaseAiRequest('quick-add-2')
    expect(activeAiRequestCount()).toBe(before)
  })

  it('非法 requestId 不登记，避免 renderer 传空值把注册表搞乱', () => {
    expect(registerAiRequest('')).toBeNull()
    expect(registerAiRequest('x'.repeat(200))).toBeNull()
    expect(registerAiRequest('bad id with space')).toBeNull()
  })

  it('取消进行中的快速添加：回落到规则结果并说明已取消', async () => {
    const hanging = hangingFetch()
    const controller = registerAiRequest('quick-add-cancel')
    expect(controller).not.toBeNull()

    const pending = parseQuickAddWithAi('明天下午3点 交周报', ['收集箱'], {
      config: CONFIG,
      now: NOW,
      fetch: hanging.fetch,
      signal: controller?.signal,
      maxAttempts: 3,
      retryDelayMs: 0
    })

    expect(cancelAiRequest('quick-add-cancel')).toBe(true)
    const response = await pending

    expect(hanging.calls()).toBe(1)
    expect(response.ok).toBe(false)
    expect(response.source).toBe('rule')
    expect(response.warning).toBe('已取消 AI 解析')
    // 语义与降级一致：返回规则解析结果，调用方可以安全忽略或直接使用。
    expect(response.result.title).toBe('交周报')
    expect(activeAiRequestCount()).toBe(0)
  })

  it('取消只作用于指定 requestId，不影响并行的其他请求', () => {
    const first = registerAiRequest('quick-add-a')
    const second = registerAiRequest('quick-add-b')
    expect(first && second).toBeTruthy()

    expect(cancelAiRequest('quick-add-a')).toBe(true)
    expect(first?.signal.aborted).toBe(true)
    expect(second?.signal.aborted).toBe(false)

    releaseAiRequest('quick-add-b')
    expect(activeAiRequestCount()).toBe(0)
  })
})
