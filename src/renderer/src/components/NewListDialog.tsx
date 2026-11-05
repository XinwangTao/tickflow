import { useState } from 'react'
import { LIST_COLORS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'

export function NewListDialog(): React.ReactNode {
  const close = useAppStore((state) => state.setNewListOpen)
  const createList = useAppStore((state) => state.createList)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LIST_COLORS[0])
  const [emoji, setEmoji] = useState('')

  const submit = (): void => {
    if (!name.trim()) return
    void createList(name, color, emoji.trim() || null)
    close(false)
  }

  return (
    <Modal title="新建清单" onClose={() => close(false)} width={420}>
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
            if (event.key === 'Enter') submit()
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
        <button type="button" className="btn" onClick={() => close(false)}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={submit}
        >
          创建
        </button>
      </div>
    </Modal>
  )
}
