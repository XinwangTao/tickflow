import { useCallback, useRef, useState, type ReactNode } from 'react'

export type ConfirmOptions = {
  title?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type Pending = ConfirmOptions & { message: string }

/**
 * 应用内二次确认：替代 window.confirm。
 * 移动端 WebView 用系统 confirm 会弹出英文 CANCEL / OK，且样式与暗色主题不一致。
 */
export function useConfirm(): {
  ask: (message: string, options?: ConfirmOptions) => Promise<boolean>
  dialog: ReactNode
} {
  const [pending, setPending] = useState<Pending | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const ask = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      // 连续触发时先把上一笔按取消收尾，避免 Promise 悬挂
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setPending({ message, ...options })
    })
  }, [])

  const close = (value: boolean): void => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setPending(null)
  }

  const dialog = pending ? (
    <div
      className="sheet-overlay confirm-overlay"
      role="presentation"
      onClick={() => close(false)}
    >
      <div
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title ?? '确认操作'}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{pending.title ?? '确认操作'}</h2>
        <p>{pending.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={() => close(false)}>
            {pending.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className={pending.danger ? 'btn-danger' : 'btn-accent'}
            onClick={() => close(true)}
          >
            {pending.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { ask, dialog }
}
