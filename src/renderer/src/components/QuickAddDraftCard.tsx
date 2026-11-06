import type { Priority } from '@shared/types'
import { describeReminderOffset, REMINDER_OFFSET_CHOICES } from '@shared/quick-add'
import type { QuickAddDraft, QuickAddDraftList } from '@shared/quick-add-draft'
import { describeRecurrence } from '../lib/format'
import { PRIORITY_LABELS } from '../lib/colors'
import { Icon } from './Icon'

/** 常见重复选项；AI 返回的规则不在列表里时会按语义动态补一项。 */
export const QUICK_ADD_RECURRENCE_CHOICES = [
  { value: '', label: '不重复' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每周' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '工作日' },
  { value: 'FREQ=MONTHLY', label: '每月' },
  { value: 'FREQ=YEARLY', label: '每年' }
]

interface QuickAddDraftCardProps {
  draft: QuickAddDraft
  lists: QuickAddDraftList[]
  /** 确认写库期间禁用「添加」，避免连点重复创建。 */
  busy?: boolean
  /** 底部说明文字；不同入口对“取消后怎么继续”的说明不同。 */
  note?: string
  confirmLabel?: string
  cancelLabel?: string
  onChange(patch: Partial<QuickAddDraft>): void
  onConfirm(): void
  onCancel(): void
}

/**
 * AI 解析结果的可编辑草稿卡。
 *
 * 快速添加与日历行内添加共用同一套字段与校验：标题、截止日期、时间、优先级、
 * 清单、标签、重复、提前提醒、全天都能改，确认前不写库。
 */
export function QuickAddDraftCard({
  draft,
  lists,
  busy = false,
  note = '修改后点「添加」写库；取消后可继续用普通 Enter 按规则添加。',
  confirmLabel = '添加',
  cancelLabel = '取消',
  onChange,
  onConfirm,
  onCancel
}: QuickAddDraftCardProps): React.ReactNode {
  const recurrenceChoices = QUICK_ADD_RECURRENCE_CHOICES.slice()
  if (
    draft.recurrence &&
    !recurrenceChoices.some((choice) => choice.value === draft.recurrence)
  ) {
    recurrenceChoices.push({
      value: draft.recurrence,
      label: describeRecurrence(draft.recurrence)
    })
  }

  const reminderChoices = REMINDER_OFFSET_CHOICES.slice()
  if (
    draft.reminderOffsetMin != null &&
    !reminderChoices.some((choice) => choice.value === draft.reminderOffsetMin)
  ) {
    reminderChoices.push({
      value: draft.reminderOffsetMin,
      label: describeReminderOffset(draft.reminderOffsetMin)
    })
  }

  return (
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
          onClick={onCancel}
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <input
        className="quick-add-draft-name"
        value={draft.title}
        placeholder="任务标题"
        aria-label="AI 任务标题"
        autoFocus
        onChange={(event) => onChange({ title: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onConfirm()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />

      <div className="quick-add-draft-fields">
        <label className="quick-add-field">
          <span>截止日期</span>
          <input
            type="date"
            value={draft.dueDate}
            aria-label="AI 截止日期"
            onChange={(event) =>
              onChange({
                dueDate: event.target.value,
                dueTime: event.target.value ? draft.dueTime : '',
                // 没有截止日期就无法换算提醒时刻，清空日期时一并清空提前量。
                reminderOffsetMin: event.target.value ? draft.reminderOffsetMin : null,
                // 无日期无时间时不再保留“定时任务”标记，避免建出字段自相矛盾的任务。
                allDay: event.target.value ? draft.allDay : true
              })
            }
          />
        </label>
        <label className="quick-add-field">
          <span>时间</span>
          <input
            type="time"
            value={draft.dueTime}
            aria-label="AI 截止时间"
            disabled={!draft.dueDate || draft.allDay}
            onChange={(event) => onChange({ dueTime: event.target.value, allDay: false })}
          />
        </label>
        <label className="quick-add-field">
          <span>优先级</span>
          <select
            value={draft.priority}
            aria-label="AI 优先级"
            onChange={(event) =>
              onChange({ priority: Number(event.target.value) as Priority })
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
            value={draft.listId ?? ''}
            aria-label="AI 清单"
            onChange={(event) => onChange({ listId: event.target.value || null })}
          >
            {draft.listId === null ? <option value="">当前清单</option> : null}
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
            value={draft.tagsText}
            placeholder="空格或逗号分隔，例如：工作 重点"
            aria-label="AI 标签"
            onChange={(event) => onChange({ tagsText: event.target.value })}
          />
        </label>
        <label className="quick-add-field">
          <span>重复</span>
          <select
            value={draft.recurrence ?? ''}
            aria-label="AI 重复"
            onChange={(event) => onChange({ recurrence: event.target.value || null })}
          >
            {recurrenceChoices.map((choice) => (
              <option value={choice.value} key={choice.value || 'none'}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="quick-add-field">
          <span>提醒</span>
          <select
            value={draft.reminderOffsetMin ?? ''}
            aria-label="AI 提前提醒"
            title={
              draft.dueDate
                ? '按截止日期/时间提前提醒；全天任务按 09:00 计算'
                : '请先填写截止日期'
            }
            disabled={!draft.dueDate}
            onChange={(event) =>
              onChange({
                reminderOffsetMin:
                  event.target.value === '' ? null : Number(event.target.value)
              })
            }
          >
            {reminderChoices.map((choice) => (
              <option value={choice.value ?? ''} key={choice.value ?? 'none'}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="quick-add-all-day">
          <input
            type="checkbox"
            checked={draft.allDay}
            aria-label="AI 全天任务"
            onChange={(event) =>
              onChange({
                allDay: event.target.checked,
                dueTime: event.target.checked ? '' : draft.dueTime
              })
            }
          />
          全天
        </label>
      </div>

      <div className="quick-add-draft-footer">
        <span className="quick-add-draft-note">{note}</span>
        <button type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!draft.title.trim() || busy}
          onClick={onConfirm}
        >
          {busy ? '添加中…' : confirmLabel}
        </button>
      </div>
    </div>
  )
}
