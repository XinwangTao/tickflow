import { addDaysToKey, todayKey } from '@shared/dates'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

export function BatchBar(): React.ReactNode {
  const selectionMode = useAppStore((state) => state.selectionMode)
  const selectedIds = useAppStore((state) => state.selectedIds)
  const tasks = useAppStore((state) => state.tasks)
  const lists = useAppStore((state) => state.lists)
  const batchComplete = useAppStore((state) => state.batchComplete)
  const batchDelete = useAppStore((state) => state.batchDelete)
  const batchMove = useAppStore((state) => state.batchMove)
  const batchPriority = useAppStore((state) => state.batchPriority)
  const batchDueDate = useAppStore((state) => state.batchDueDate)
  const selectAll = useAppStore((state) => state.selectAll)
  const clearSelection = useAppStore((state) => state.clearSelection)

  if (!selectionMode) return null
  const disabled = selectedIds.length === 0

  return (
    <div className="batch-bar">
      <span className="batch-count">已选 {selectedIds.length}</span>
      <button
        type="button"
        className="btn"
        onClick={() =>
          selectAll(
            selectedIds.length === tasks.length ? [] : tasks.map((task) => task.id)
          )
        }
      >
        {selectedIds.length === tasks.length && tasks.length > 0 ? '取消全选' : '全选'}
      </button>
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
          const value = event.target.value
          event.target.value = ''
          if (value) void batchPriority(Number(value) as 0 | 1 | 2 | 3)
        }}
        aria-label="批量设置优先级"
      >
        <option value="">优先级…</option>
        <option value="3">高</option>
        <option value="2">中</option>
        <option value="1">低</option>
        <option value="0">无</option>
      </select>
      <select
        className="input batch-select"
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value
          event.target.value = ''
          if (value === 'today') void batchDueDate(todayKey())
          else if (value === 'tomorrow') void batchDueDate(addDaysToKey(todayKey(), 1))
          else if (value === 'none') void batchDueDate(null)
        }}
        aria-label="批量设置截止日期"
      >
        <option value="">日期…</option>
        <option value="today">今天</option>
        <option value="tomorrow">明天</option>
        <option value="none">清除日期</option>
      </select>
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
