import { useEffect, useMemo, useRef, useState } from 'react'
import { parseQuickAdd, type QuickAddResult } from '@shared/quick-add'
import {
  createQuickAddDraft,
  draftToQuickAddResult,
  type QuickAddDraft
} from '@shared/quick-add-draft'
import type { Priority, TaskWithMeta } from '@shared/types'
import { describeRecurrence, formatDueLabel } from '../lib/format'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface QuickAddProps {
  defaultListId: string
  defaultDueDate?: string | null
}

const RECURRENCE_CHOICES = [
  { value: '', label: '不重复' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每周' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '工作日' },
  { value: 'FREQ=MONTHLY', label: '每月' },
  { value: 'FREQ=YEARLY', label: '每年' }
]

function normalizedListName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

export function QuickAdd({ defaultListId, defaultDueDate = null }: QuickAddProps): React.ReactNode {
  const lists = useAppStore((state) => state.lists)
  const settings = useAppStore((state) => state.settings)
  const createTask = useAppStore((state) => state.createTask)
  const refresh = useAppStore((state) => state.refresh)
  const showToast = useAppStore((state) => state.showToast)
  const focusToken = useAppStore((state) => state.quickAddFocus)

  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiElapsed, setAiElapsed] = useState(0)
  const [draftBusy, setDraftBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState<QuickAddDraft | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 进行中的 AI 请求：id 用于取消，text 用于判断响应是否已经过期。
  const aiRequestSeq = useRef(0)
  const activeAiRequest = useRef<{ id: string; text: string } | null>(null)
  const valueRef = useRef('')

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus()
  }, [focusToken])

  // 切换视图导致组件卸载时中止进行中的解析：草稿本来也留不下来，不应继续消耗 token。
  useEffect(() => {
    return () => {
      const active = activeAiRequest.current
      if (!active) return
      activeAiRequest.current = null
      try {
        void window.api.ai.cancel(active.id).catch(() => undefined)
      } catch {
        // 旧 preload 或测试桩没有 cancel 时忽略，不影响卸载。
      }
    }
  }, [])

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
    const lowered = normalizedListName(name)
    return lists.find((list) => normalizedListName(list.name) === lowered)
  }

  /**
   * AI 创建成功后可撤销：直接移除刚创建的任务（进入垃圾箱，可再从垃圾箱恢复），
   * 不弹出额外 toast，避免把「已删除」覆盖在「已添加」上。
   */
  const notifyAdded = (
    created: TaskWithMeta,
    message: string,
    kind: 'success' | 'info' = 'success',
    duration = 6000
  ): void => {
    showToast(message, kind, {
      actionLabel: '撤销',
      duration,
      action: async () => {
        try {
          await window.api.tasks.remove(created.id)
          await refresh()
        } catch (error) {
          showToast(String(error), 'error')
        }
      }
    })
  }

  const createFromResult = async (
    result: QuickAddResult,
    options: { listId?: string | null; applyDefaultDueDate?: boolean } = {}
  ): Promise<TaskWithMeta | null> => {
    const matched = options.listId
      ? lists.find((list) => list.id === options.listId)
      : resolveList(result.listName)
    const fallback =
      lists.find((list) => list.id === defaultListId) ??
      lists.find((list) => list.isInbox) ??
      lists[0]

    const target = matched ?? fallback
    if (!target) {
      showToast('没有可用清单，请先创建一个清单', 'error')
      return null
    }
    if (result.listName && !matched) {
      showToast(`未找到清单「${result.listName}」，已放入「${target.name}」`, 'info')
    }

    const dueDate =
      options.applyDefaultDueDate === false
        ? result.dueDate
        : (result.dueDate ?? defaultDueDate ?? null)

    return createTask({
      listId: target.id,
      title: result.title,
      priority: result.priority,
      dueDate,
      dueTime: result.dueTime,
      allDay: result.allDay,
      recurrence: result.recurrence,
      tagNames: result.tags
    })
  }

  const submit = async (useAi: boolean): Promise<void> => {
    const text = value.trim()
    if (!text) return
    if (aiBusy) {
      // 进行中时普通 Enter 不再静默失败，明确告诉用户可以中止这次解析。
      showToast('AI 正在解析，按 Esc 或点「取消」可中止', 'info')
      return
    }
    if (aiDraft) {
      if (!useAi) {
        showToast('请先添加或取消上方的 AI 解析结果', 'info')
        return
      }
      // 再点一次 AI 视为重新解析当前输入。
      setAiDraft(null)
    }

    let result: QuickAddResult
    let aiWarning: string | null = null
    let aiUsed = false
    if (useAi && settings.aiEnabled) {
      aiUsed = true
      const requestId = `quick-add-${(aiRequestSeq.current += 1)}`
      activeAiRequest.current = { id: requestId, text }
      setAiBusy(true)
      try {
        const response = await window.api.ai.parseQuickAdd(text, requestId)
        // 已取消或已被新请求取代：迟到的结果一律丢弃，绝不落到草稿区。
        if (activeAiRequest.current?.id !== requestId) return
        if (valueRef.current.trim() !== text) {
          showToast('输入已变化，已忽略上一次 AI 解析结果', 'info')
          return
        }
        if (response.ok && response.source === 'ai') {
          // AI 成功时先进入草稿，不立即写库：用户可以改标题、时间、清单后再添加。
          const draft = createQuickAddDraft(
            response.result,
            lists,
            defaultListId,
            defaultDueDate
          )
          setAiDraft(draft)
          const wanted = response.result.listName
          if (wanted && !resolveList(wanted)) {
            const fallback = lists.find((list) => list.id === draft.listId)
            showToast(
              `未找到清单「${wanted}」，已选择「${fallback?.name ?? '当前清单'}」`,
              'info'
            )
          }
          return
        }
        result = response.result
        aiWarning = response.warning
      } catch (error) {
        if (activeAiRequest.current?.id !== requestId) return
        result = parseQuickAdd(text)
        aiWarning = String(error)
      } finally {
        if (activeAiRequest.current?.id === requestId) {
          activeAiRequest.current = null
          setAiBusy(false)
        }
      }
    } else {
      result = parseQuickAdd(text)
    }

    const created = await createFromResult(result)
    if (!created) return
    setValue('')
    inputRef.current?.focus()
    if (aiUsed) {
      notifyAdded(
        created,
        aiWarning
          ? `AI 未能解析，已按规则添加「${created.title}」：${aiWarning}`
          : `AI 已添加「${created.title}」`,
        aiWarning ? 'info' : 'success',
        aiWarning ? 7000 : 6000
      )
    }
  }

  /** 取消进行中的 AI 解析：先让 main 中止 fetch，再丢弃响应，输入内容保持不变。 */
  const cancelAiParse = (): void => {
    const active = activeAiRequest.current
    if (!active) return
    activeAiRequest.current = null
    setAiBusy(false)
    setAiElapsed(0)
    void window.api.ai.cancel(active.id).catch(() => undefined)
    showToast('已取消 AI 解析，输入内容已保留', 'info')
    inputRef.current?.focus()
  }

  const updateDraft = (patch: Partial<QuickAddDraft>): void => {
    setAiDraft((draft) => (draft ? { ...draft, ...patch } : draft))
  }

  const cancelDraft = (): void => {
    setAiDraft(null)
    inputRef.current?.focus()
  }

  const confirmDraft = async (): Promise<void> => {
    if (!aiDraft || aiBusy || draftBusy) return
    const result = draftToQuickAddResult(aiDraft, lists)
    if (!result) {
      showToast('任务标题不能为空', 'error')
      return
    }
    setDraftBusy(true)
    try {
      const created = await createFromResult(result, {
        listId: aiDraft.listId,
        // 用户可能主动清空了日期，不能在确认时又被默认截止日期补回来。
        applyDefaultDueDate: false
      })
      if (!created) return
      setAiDraft(null)
      setValue('')
      inputRef.current?.focus()
      notifyAdded(created, `AI 已添加「${created.title}」`, 'success')
    } finally {
      setDraftBusy(false)
    }
  }

  const recurrenceChoices = RECURRENCE_CHOICES.slice()
  if (
    aiDraft?.recurrence &&
    !recurrenceChoices.some((choice) => choice.value === aiDraft.recurrence)
  ) {
    recurrenceChoices.push({
      value: aiDraft.recurrence,
      label: describeRecurrence(aiDraft.recurrence)
    })
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
            } else if (event.key === 'Escape' && aiBusy) {
              // Esc 直接中止这次解析，不用等满超时。
              event.preventDefault()
              cancelAiParse()
            }
          }}
          aria-label="快速添加任务"
        />
        {settings.aiEnabled ? (
          <>
            {aiBusy ? (
              <button
                type="button"
                className="quick-add-ai-cancel"
                title="取消本次 AI 解析（Esc）"
                aria-label="取消 AI 解析"
                onClick={cancelAiParse}
              >
                取消
              </button>
            ) : null}
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
          </>
        ) : null}
        {value.trim() ? <kbd className="quick-add-enter">↵</kbd> : null}
      </div>

      {aiDraft ? (
        <div className="quick-add-draft" role="dialog" aria-label="AI 解析结果">
          <div className="quick-add-draft-head">
            <span className="quick-add-draft-title">
              <Icon name="sparkles" size={13} /> AI 解析结果 · 可修改后添加
            </span>
            <button
              type="button"
              className="icon-btn"
              title="取消 AI 解析结果"
              aria-label="取消 AI 解析结果"
              onClick={cancelDraft}
            >
              <Icon name="close" size={13} />
            </button>
          </div>

          <input
            className="quick-add-draft-name"
            value={aiDraft.title}
            placeholder="任务标题"
            aria-label="AI 任务标题"
            autoFocus
            onChange={(event) => updateDraft({ title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void confirmDraft()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelDraft()
              }
            }}
          />

          <div className="quick-add-draft-fields">
            <label className="quick-add-field">
              <span>截止日期</span>
              <input
                type="date"
                value={aiDraft.dueDate}
                aria-label="AI 截止日期"
                onChange={(event) =>
                  updateDraft({
                    dueDate: event.target.value,
                    dueTime: event.target.value ? aiDraft.dueTime : ''
                  })
                }
              />
            </label>
            <label className="quick-add-field">
              <span>时间</span>
              <input
                type="time"
                value={aiDraft.dueTime}
                aria-label="AI 截止时间"
                disabled={!aiDraft.dueDate || aiDraft.allDay}
                onChange={(event) =>
                  updateDraft({ dueTime: event.target.value, allDay: false })
                }
              />
            </label>
            <label className="quick-add-field">
              <span>优先级</span>
              <select
                value={aiDraft.priority}
                aria-label="AI 优先级"
                onChange={(event) =>
                  updateDraft({ priority: Number(event.target.value) as Priority })
                }
              >
                {PRIORITY_LABELS.map((label, index) => (
                  <option value={index} key={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="quick-add-field">
              <span>清单</span>
              <select
                value={aiDraft.listId ?? ''}
                aria-label="AI 清单"
                onChange={(event) => updateDraft({ listId: event.target.value || null })}
              >
                {aiDraft.listId === null ? <option value="">当前清单</option> : null}
                {lists.map((list) => (
                  <option value={list.id} key={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-add-draft-fields">
            <label className="quick-add-field grow">
              <span>标签</span>
              <input
                value={aiDraft.tagsText}
                placeholder="空格或逗号分隔，例如：工作 重点"
                aria-label="AI 标签"
                onChange={(event) => updateDraft({ tagsText: event.target.value })}
              />
            </label>
            <label className="quick-add-field">
              <span>重复</span>
              <select
                value={aiDraft.recurrence ?? ''}
                aria-label="AI 重复"
                onChange={(event) => updateDraft({ recurrence: event.target.value || null })}
              >
                {recurrenceChoices.map((choice) => (
                  <option value={choice.value} key={choice.value || 'none'}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="quick-add-all-day">
              <input
                type="checkbox"
                checked={aiDraft.allDay}
                aria-label="AI 全天任务"
                onChange={(event) =>
                  updateDraft({
                    allDay: event.target.checked,
                    dueTime: event.target.checked ? '' : aiDraft.dueTime
                  })
                }
              />
              全天
            </label>
          </div>

          <div className="quick-add-draft-footer">
            <span className="quick-add-draft-note">
              修改后点「添加」写库；取消后可继续用普通 Enter 按规则添加。
            </span>
            <button type="button" className="btn" onClick={cancelDraft}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!aiDraft.title.trim() || draftBusy}
              onClick={() => void confirmDraft()}
            >
              {draftBusy ? '添加中…' : '添加'}
            </button>
          </div>
        </div>
      ) : null}

      {focused && !aiDraft && hasMeta ? (
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

      {focused && !aiDraft ? (
        <div className="quick-add-hint">
          支持：明天下午 3 点 · 每周一 · #标签 · !高 · ~清单
          {settings.aiEnabled ? ' · Ctrl+Enter 用 AI 理解整句话' : ''}
        </div>
      ) : null}
    </section>
  )
}
