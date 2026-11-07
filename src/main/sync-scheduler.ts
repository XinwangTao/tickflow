import type { SyncResult } from '@shared/types'

export interface SyncSchedulerOptions {
  /** 执行一次同步（含拉取、合并、上传）。 */
  sync: () => Promise<SyncResult>
  /** 自动同步闸门：设置开启且 R2 配置完整。 */
  isAutoEnabled: () => boolean
  /** 后台同步完成后通知渲染进程；手动同步由 IPC 返回，不重复通知。 */
  notify?: (result: SyncResult) => void
  debounceMs?: number
  retryDelaysMs?: number[]
}

/**
 * 同步调度器：本地写入防抖聚合、单飞执行、失败退避重试。
 * 对应 docs/archify/sync_reliability_workflow.html 的 S1–S8。
 */
export class SyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<SyncResult> | null = null
  private trailing = false
  private retryIndex = 0
  private stopped = false
  private readonly debounceMs: number
  private readonly retryDelaysMs: number[]

  constructor(private readonly options: SyncSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 3000
    this.retryDelaysMs = options.retryDelaysMs ?? [5000, 15000, 45000]
  }

  /** 本地写入后调用：重置重试计数并重新计时。 */
  schedule(): void {
    if (this.stopped) return
    this.retryIndex = 0
    this.arm(this.debounceMs)
  }

  /** 设置页「立即同步」：清空退避、等待在途同步后立即执行。 */
  async runManual(): Promise<SyncResult> {
    this.retryIndex = 0
    this.clearTimer()
    if (this.running) await this.running.catch(() => undefined)
    this.clearTimer()
    this.trailing = false
    const result = await this.execute(true)
    return result ?? { ok: false, message: '同步未执行' }
  }

  /** 启动同步：仅在自动同步开启且配置完整时执行。 */
  async runStartup(): Promise<SyncResult | null> {
    if (!this.options.isAutoEnabled()) return null
    return this.execute(false)
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private arm(ms: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.execute(false)
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private execute(force: boolean): Promise<SyncResult> | null {
    if (this.stopped) return null
    if (this.running) {
      this.trailing = true
      return null
    }
    if (!force && !this.options.isAutoEnabled()) return null

    const run = this.options
      .sync()
      .catch((error): SyncResult => ({ ok: false, message: errorMessage(error) }))
    this.running = run
    void run.then((result) => {
      this.running = null
      this.options.notify?.(result)
      if (result.ok) this.retryIndex = 0
      if (this.trailing) {
        this.trailing = false
        this.arm(this.debounceMs)
      } else if (!result.ok && !force) {
        this.scheduleRetry()
      }
    })
    return run
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryIndex >= this.retryDelaysMs.length) return
    const delay = this.retryDelaysMs[this.retryIndex] as number
    this.retryIndex += 1
    this.arm(delay)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
