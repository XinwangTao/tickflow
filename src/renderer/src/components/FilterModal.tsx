import { useState } from 'react'
import type { FilterDue, FilterStatus, Priority } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'

const STATUS_OPTIONS: Array<{ value: FilterStatus; label: string }> = [
  { value: 'open', label: '未完成' },
  { value: 'completed', label: '已完成' },
  { value: 'abandoned', label: '已放弃' },
  { value: 'all', label: '全部状态' }
]

const DUE_OPTIONS: Array<{ value: FilterDue; label: string }> = [
  { value: 'any', label: '任意日期' },
  { value: 'today', label: '今天（含逾期）' },
  { value: 'overdue', label: '已逾期' },
  { value: 'next7', label: '最近 7 天' },
  { value: 'no_date', label: '无日期' }
]

const PRIORITY_OPTIONS: Array<{ value: Priority | null; label: string }> = [
  { value: null, label: '任意优先级' },
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' }
]

export function FilterModal({
  onClose,
  onSaved
}: {
  onClose: () => void
  onSaved: () => void
}): React.ReactNode {
  const lists = useAppStore((state) => state.lists)
  const tags = useAppStore((state) => state.tags)
  const createFilter = useAppStore((state) => state.createFilter)

  const [name, setName] = useState('')
  const [status, setStatus] = useState<FilterStatus>('open')
  const [priority, setPriority] = useState<Priority | null>(null)
  const [listId, setListId] = useState('')
  const [tag, setTag] = useState('')
  const [due, setDue] = useState<FilterDue>('any')

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    await createFilter(name, {
      listId: listId || null,
      status,
      priority,
      tag: tag || null,
      due
    })
    onSaved()
  }

  return (
    <Modal title="新建过滤器" onClose={onClose} width={520}>
      <label className="field">
        <span className="field-label">名称</span>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="例如：本周高优先级工作"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </label>

      <div className="filter-grid">
        <label className="field">
          <span className="field-label">状态</span>
          <select
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as FilterStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">优先级</span>
          <select
            className="input"
            value={priority === null ? '' : String(priority)}
            onChange={(event) =>
              setPriority(
                event.target.value === ''
                  ? null
                  : (Number(event.target.value) as Priority)
              )
            }
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option value={option.value === null ? '' : String(option.value)} key={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">清单</span>
          <select
            className="input"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            <option value="">任意清单</option>
            {lists.map((list) => (
              <option value={list.id} key={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">标签</span>
          <select
            className="input"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="">任意标签</option>
            {tags.map((tagItem) => (
              <option value={tagItem.name} key={tagItem.id}>
                #{tagItem.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field filter-grid-wide">
          <span className="field-label">日期</span>
          <select
            className="input"
            value={due}
            onChange={(event) => setDue(event.target.value as FilterDue)}
          >
            {DUE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          创建
        </button>
      </div>
    </Modal>
  )
}
