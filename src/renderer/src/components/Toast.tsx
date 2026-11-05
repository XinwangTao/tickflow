import { useAppStore } from '../store/useAppStore'

export function Toast(): React.ReactNode {
  const toast = useAppStore((state) => state.toast)
  const clearToast = useAppStore((state) => state.clearToast)

  if (!toast) return null

  return (
    <div className={`toast ${toast.kind}`} role="status" onClick={clearToast}>
      <span className="toast-message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={(event) => {
            event.stopPropagation()
            void toast.action?.()
            clearToast()
          }}
        >
          {toast.actionLabel ?? '撤销'}
        </button>
      ) : null}
    </div>
  )
}
