import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 不可撤销的操作（清空垃圾箱等）用红色确认按钮。 */
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

/**
 * 应用内的二次确认框：替代 `window.confirm`（Electron 里会阻塞渲染进程且样式不统一）。
 * 默认聚焦「取消」，避免用户顺手按 Enter 把不可恢复的操作执行掉。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onClose
}: ConfirmDialogProps): ReactNode {
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={380}>
      <p className="modal-text">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn" autoFocus disabled={busy} onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
