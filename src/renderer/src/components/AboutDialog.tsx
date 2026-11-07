import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo } from '@shared/types'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useAppStore } from '../store/useAppStore'

export function AboutDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const showToast = useAppStore((state) => state.showToast)

  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  const openDir = async (): Promise<void> => {
    try {
      await window.api.data.openDir()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const backup = async (): Promise<void> => {
    try {
      const path = await window.api.data.backup()
      showToast(`已备份到 ${path}`, 'success', { duration: 5000 })
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <Modal title="关于刻度清单" onClose={onClose} width={440}>
      <div className="about-hero">
        <span className="about-logo">刻</span>
        <div>
          <h3>刻度清单 TickFlow</h3>
          <p>本地优先的任务管理 · 桌面 + Android</p>
        </div>
      </div>
      <div className="about-meta">
        <span>版本 {info?.version ?? '…'}</span>
        <span>{info?.platform ?? ''}</span>
      </div>
      <code className="settings-path">{info?.dataDir ?? '加载中…'}</code>
      <p className="settings-note">
        数据默认保存在本机；R2 同步清单、任务与习惯数据，桌面端密钥使用系统安全存储加密。
      </p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void openDir()}>
          <Icon name="folder" size={14} />
          打开数据目录
        </button>
        <button type="button" className="btn" onClick={() => void backup()}>
          立即备份
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  )
}
