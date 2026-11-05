import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

export function BatchBar(): React.ReactNode {
  const selectionMode = useAppStore((state) => state.selectionMode)
  const selectedIds = useAppStore((state) => state.selectedIds)
  const lists = useAppStore((state) => state.lists)
  const batchComplete = useAppStore((state) => state.batchComplete)
  const batchDelete = useAppStore((state) => state.batchDelete)
  const batchMove = useAppStore((state) => state.batchMove)
  const clearSelection = useAppStore((state) => state.clearSelection)

  if (!selectionMode) return null
  const disabled = selectedIds.length === 0

  return (
    <div className="batch-bar">
      <span className="batch-count">已选 {selectedIds.length}</span>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => void batchComplete()}
      >
        <Icon name="check" size={14} />
        完成
      </button>
      <select
        className="input batch-select"
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          const listId = event.target.value
          event.target.value = ''
          if (listId) void batchMove(listId)
        }}
        aria-label="移动任务到清单"
      >
        <option value="">移动到…</option>
        {lists.map((list) => (
          <option value={list.id} key={list.id}>
            {list.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-danger"
        disabled={disabled}
        onClick={() => void batchDelete()}
      >
        <Icon name="trash" size={14} />
        删除
      </button>
      <button type="button" className="btn" onClick={clearSelection}>
        取消
      </button>
    </div>
  )
}
