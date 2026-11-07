import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncResult } from '../src/shared/types'
import { SyncScheduler } from '../src/main/sync-scheduler'

function ok(): SyncResult {
  return { ok: true, message: '同步完成' }
}

function fail(message = '离线'): SyncResult {
  return { ok: false, message }
}

describe('SyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('3 秒内多次写入只同步一次', async () => {
    const sync = vi.fn(async () => ok())
    const scheduler = new SyncScheduler({ sync, isAutoEnabled: () => true })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(2999)
    expect(sync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(sync).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('自动同步关闭时后台不触发，手动同步仍可执行', async () => {
    const sync = vi.fn(async () => ok())
    const scheduler = new SyncScheduler({ sync, isAutoEnabled: () => false })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).not.toHaveBeenCalled()
    await expect(scheduler.runStartup()).resolves.toBeNull()

    await expect(scheduler.runManual()).resolves.toEqual(ok())
    expect(sync).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('失败按 5 / 15 / 45 秒退避，最多重试 3 次', async () => {
    const sync = vi.fn(async () => fail())
    const notify = vi.fn()
    const scheduler = new SyncScheduler({
      sync,
      isAutoEnabled: () => true,
      notify,
      retryDelaysMs: [5000, 15000, 45000]
    })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(sync).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15000)
    expect(sync).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(45000)
    expect(sync).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(45000)
    expect(sync).toHaveBeenCalledTimes(4)
    expect(notify).toHaveBeenCalledTimes(4)
    scheduler.stop()
  })

  it('一次成功后停止退避，新写入会重置重试计数', async () => {
    const sync = vi
      .fn<() => Promise<SyncResult>>()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(fail())
      .mockResolvedValue(ok())
    const scheduler = new SyncScheduler({
      sync,
      isAutoEnabled: () => true,
      retryDelaysMs: [5000, 15000]
    })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sync).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(45000)
    expect(sync).toHaveBeenCalledTimes(2)

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(3)
    // 新写入后第一次失败重新从 5 秒开始退避。
    await vi.advanceTimersByTimeAsync(5000)
    expect(sync).toHaveBeenCalledTimes(4)
    scheduler.stop()
  })

  it('单飞：同步进行中再次触发只排一次尾随', async () => {
    const first: { resolve: (value: SyncResult) => void } = { resolve: () => undefined }
    const sync = vi
      .fn<() => Promise<SyncResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<SyncResult>((resolve) => {
            first.resolve = resolve
          })
      )
      .mockResolvedValue(ok())
    const scheduler = new SyncScheduler({ sync, isAutoEnabled: () => true })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(1)

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(1)

    first.resolve(ok())
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('手动同步会清掉在途的退避重试', async () => {
    const sync = vi.fn<() => Promise<SyncResult>>().mockResolvedValue(fail())
    const scheduler = new SyncScheduler({
      sync,
      isAutoEnabled: () => true,
      retryDelaysMs: [5000]
    })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(1)

    await scheduler.runManual()
    expect(sync).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sync).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})
