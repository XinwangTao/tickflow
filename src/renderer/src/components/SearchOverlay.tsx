import { useEffect, useRef, useState } from 'react'
import type { TaskWithMeta } from '@shared/types'
import { formatDueLabel } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

export function SearchOverlay(): React.ReactNode {
  const seed = useAppStore((state) => state.searchSeed)
  const setSearchOpen = useAppStore((state) => state.setSearchOpen)
  const openDetail = useAppStore((state) => state.openDetail)
  const showToast = useAppStore((state) => state.showToast)

  const [query, setQuery] = useState(seed)
  const [results, setResults] = useState<TaskWithMeta[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      window.api.tasks
        .query({ view: 'search', q: trimmed })
        .then((rows) => {
          setResults(rows)
          setActive(0)
        })
        .catch((error) => showToast(String(error), 'error'))
        .finally(() => setLoading(false))
    }, 160)
    return () => window.clearTimeout(timer)
  }, [query, showToast])

  const choose = (task: TaskWithMeta): void => {
    openDetail(task.id)
    setSearchOpen(false)
  }

  return (
    <div
      className="search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSearchOpen(false)
      }}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="搜索任务">
        <div className="search-bar">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            placeholder="搜索任务、备注、标签；#标签 只搜标签"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((value) => Math.max(value - 1, 0))
              } else if (event.key === 'Enter') {
                const task = results[active]
                if (task) choose(task)
              } else if (event.key === 'Escape') {
                setSearchOpen(false)
              }
            }}
            aria-label="搜索关键词"
          />
          <kbd className="search-kbd">Esc</kbd>
        </div>

        <div className="search-results">
          {loading ? <div className="search-note">搜索中…</div> : null}
          {!loading && query.trim() && results.length === 0 ? (
            <div className="search-note">没有匹配的任务</div>
          ) : null}
          {!query.trim() ? (
            <div className="search-note">
              输入关键词搜索标题、备注和标签；输入 <code>#工作</code> 只搜标签。
            </div>
          ) : null}
          {results.map((task, index) => (
            <button
              type="button"
              key={task.id}
              className={`search-result ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(task)}
            >
              <span
                className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
                aria-hidden="true"
              >
                {task.status === 'completed' ? <Icon name="check" size={11} /> : null}
              </span>
              <span className="search-result-main">
                <span className="search-result-title">{task.title}</span>
                <span className="search-result-meta">
                  {task.listName}
                  {task.dueDate
                    ? ` · ${formatDueLabel(task.dueDate, task.dueTime, task.allDay)}`
                    : ''}
                  {task.tags.length > 0
                    ? ` · ${task.tags.map((tag) => `#${tag.name}`).join(' ')}`
                    : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
