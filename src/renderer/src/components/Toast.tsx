import { useAppStore } from '../store/useAppStore'

export function Toast(): React.ReactNode {
  const toast = useAppStore((state) => state.toast)
  const clearToast = useAppStore((state) => state.clearToast)

  if (!toast) return null

  return (
    <div className={`toast ${toast.kind}`} role="status" onClick={clearToast}>
      {toast.message}
    </div>
  )
}
