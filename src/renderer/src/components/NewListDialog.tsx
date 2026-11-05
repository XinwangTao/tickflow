import { useState } from 'react'
import type { TodoList } from '@shared/types'
import { LIST_COLORS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'

export function NewListDialog({
  list = null,
  onClose
}: {
  list?: TodoList | null
  onClose?: () => void
}): React.ReactNode {
  const storeClose = useAppStore((state) => state.setNewListOpen)
  const createList = useAppStore((state) => state.createList)
  const updateList = useAppStore((state) => state.updateList)
  const close = onClose ?? (() => storeClose(false))

  const [name, setName] = useState(list?.name ?? '')
  const [color, setColor] = useState(list?.color ?? LIST_COLORS[0])
  const [emoji, setEmoji] = useState(list?.emoji ?? '')

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    if (list) {
      await updateList(list.id, {
        name: name.trim(),
        color,
        emoji: emoji.trim() || null
      })
    } else {
      await createList(name, color, emoji.trim() || null)
    }
    close()
  }

  return (
    <Modal title={list ? '编辑清单' : '新建清单'} onClose={close} width={420}>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="例如：工作、阅读、家务"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </label>

      <div className="field">
        <span className="field-label">颜色</span>
        <div className="color-swatches">
          {LIST_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={`color-swatch ${color === item ? 'selected' : ''}`}
              style={{ background: item }}
              aria-label={`颜色 ${item}`}
              onClick={() => setColor(item)}
            />
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">图标（可选）</span>
        <input
          className="input"
          value={emoji}
          maxLength={2}
          placeholder="例如 📚"
          onChange={(event) => setEmoji(event.target.value)}
        />
      </label>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={close}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          {list ? '保存' : '创建'}
        </button>
      </div>
    </Modal>
  )
}
