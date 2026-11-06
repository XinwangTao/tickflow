import { useEffect, useMemo, useRef, useState } from 'react'
import { parseQuickAdd, type QuickAddResult } from '@shared/quick-add'
import { describeRecurrence, formatDueLabel } from '../lib/format'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface QuickAddProps {
  defaultListId: string
  defaultDueDate?: string | null
}

export function QuickAdd({ defaultListId, defaultDueDate = null }: QuickAddProps): React.ReactNode {
  const lists = useAppStore((state) => state.lists)
  const settings = useAppStore((state) => state.settings)
  const createTask = useAppStore((state) => state.createTask)
  const showToast = useAppStore((state) => state.showToast)
  const focusToken = useAppStore((state) => state.quickAddFocus)

  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiElapsed, setAiElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus()
  }, [focusToken])

  // 请求期间显示已等待秒数：超时前用户能看到进度，不会以为界面卡住。
  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0)
      return
    }
    const timer = setInterval(() => setAiElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [aiBusy])

  const aiTimeoutSeconds = Math.max(1, Math.round((settings.aiTimeoutMs || 15000) / 1000))

  const parsed = useMemo(() => parseQuickAdd(value), [value])
  const hasMeta =
    Boolean(parsed.dueDate) ||
    parsed.priority > 0 ||
    parsed.tags.length > 0 ||
    Boolean(parsed.listName) ||
    Boolean(parsed.recurrence)

  const resolveList = (name: string | null): (typeof lists)[number] | undefined => {
    if (!name) return undefined
    const lowered = name.toLowerCase()
    return lists.find((list) => list.name.toLowerCase() === lowered)
  }

  const createFromResult = async (result: QuickAddResult): Promise<boolean> => {
    const matched = resolveList(result.listName)
    const fallback =
      lists.find((list) => list.id === defaultListId) ??
      lists.find((list) => list.isInbox) ??
      lists[0]

    const target = matched ?? fallback
    if (!target) {
      showToast('没有可用清单，请先创建一个清单', 'error')
      return false
    }
    if (result.listName && !matched) {
      showToast(`未找到清单「${result.listName}」，已放入「${target.name}」`, 'info')
    }

    const created = await createTask({
      listId: target.id,
      title: result.title,
      priority: result.priority,
      dueDate: result.dueDate ?? defaultDueDate ?? null,
      dueTime: result.dueTime,
      allDay: result.allDay,
      recurrence: result.recurrence,
      tagNames: result.tags
    })
    return Boolean(created)
  }

  const submit = async (useAi: boolean): Promise<void> => {
    const text = value.trim()
    if (!text || aiBusy) return

    let result: QuickAddResult
    if (useAi && settings.aiEnabled) {
      setAiBusy(true)
      try {
        const response = await window.api.ai.parseQuickAdd(text)
        result = response.result
        if (!response.ok) {
          showToast(
            `AI 未能解析，已使用规则解析${response.warning ? `：${response.warning}` : ''}`,
            'info',
            { duration: 5000 }
          )
        }
      } catch (error) {
        result = parseQuickAdd(text)
        showToast(`AI 不可用，已使用规则解析：${String(error)}`, 'info', { duration: 5000 })
      } finally {
        setAiBusy(false)
      }
    } else {
      result = parseQuickAdd(text)
    }

    const created = await createFromResult(result)
    if (created) {
      setValue('')
      inputRef.current?.focus()
    }
  }

  return (
    <section className={`quick-add ${focused ? 'focused' : ''}`}>
      <div className="quick-add-bar">
        <Icon name="plus" size={17} className="quick-add-icon" />
        <input
          ref={inputRef}
          className="quick-add-input"
          value={value}
          placeholder="添加任务，试试「明天下午3点 交周报 #工作 !高」"
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit(event.ctrlKey || event.metaKey)
            }
          }}
          aria-label="快速添加任务"
        />
        {settings.aiEnabled ? (
          <button
            type="button"
            className={`quick-add-ai ${aiBusy ? 'busy' : ''}`}
            title={`AI 解析并添加（Ctrl+Enter）· 超过 ${aiTimeoutSeconds} 秒自动回落到规则解析`}
            aria-label="AI 解析并添加"
            disabled={aiBusy || !value.trim()}
            onClick={() => void submit(true)}
          >
            <Icon name="sparkles" size={14} />
            {aiBusy ? (aiElapsed > 0 ? `解析中 ${aiElapsed}s` : '解析中') : 'AI'}
          </button>
        ) : null}
        {value.trim() ? <kbd className="quick-add-enter">↵</kbd> : null}
      </div>

      {focused && hasMeta ? (
        <div className="quick-add-preview">
          {parsed.dueDate ? (
            <span className="preview-chip">
              <Icon name="calendar" size={12} />
              {formatDueLabel(parsed.dueDate, parsed.dueTime, parsed.allDay)}
            </span>
          ) : null}
          {parsed.recurrence ? (
            <span className="preview-chip">
              <Icon name="rotate" size={12} />
              {describeRecurrence(parsed.recurrence)}
            </span>
          ) : null}
          {parsed.priority > 0 ? (
            <span className="preview-chip" style={{ color: PRIORITY_COLORS[parsed.priority] }}>
              <Icon name="flag" size={12} />
              {PRIORITY_LABELS[parsed.priority]}优先级
            </span>
          ) : null}
          {parsed.tags.map((tag) => (
            <span className="preview-chip" key={tag}>
              <Icon name="tag" size={12} />#{tag}
            </span>
          ))}
          {parsed.listName ? (
            <span className="preview-chip">
              <Icon name="folder" size={12} />
              {parsed.listName}
            </span>
          ) : null}
        </div>
      ) : null}

      {focused ? (
        <div className="quick-add-hint">
          支持：明天下午 3 点 · 每周一 · #标签 · !高 · ~清单
          {settings.aiEnabled ? ' · Ctrl+Enter 用 AI 理解整句话' : ''}
        </div>
      ) : null}
    </section>
  )
}
