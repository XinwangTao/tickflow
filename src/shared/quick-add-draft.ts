import { normalizeDateKey, normalizeTime } from './dates'
import { normalizeReminderOffset, type QuickAddResult } from './quick-add'
import type { Priority } from './types'

/** 草稿只需要清单的定位信息，便于在测试里构造最小列表。 */
export interface QuickAddDraftList {
  id: string
  name: string
  isInbox?: boolean
}

/**
 * AI 快速添加的中间草稿：在写库前把模型结果摊平成可编辑字段。
 * 标题、日期、时间、优先级、清单、标签、重复都能在这里修改，
 * 确认时才通过 draftToQuickAddResult 做最后一次校验并创建任务。
 */
export interface QuickAddDraft {
  title: string
  priority: Priority
  tagsText: string
  listId: string | null
  dueDate: string
  dueTime: string
  allDay: boolean
  recurrence: string | null
  /** 提前提醒的分钟数；0 表示截止时提醒，null 表示不提醒。 */
  reminderOffsetMin: number | null
}

function listKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

function defaultList(
  lists: QuickAddDraftList[],
  defaultListId: string | null
): QuickAddDraftList | undefined {
  return (
    lists.find((list) => list.id === defaultListId) ??
    lists.find((list) => list.isInbox) ??
    lists[0]
  )
}

/** 把 AI 结果转成可编辑草稿；清单名匹配忽略大小写与空白，匹配不到时回落到当前清单。 */
export function createQuickAddDraft(
  result: QuickAddResult,
  lists: QuickAddDraftList[],
  defaultListId: string | null = null,
  defaultDueDate: string | null = null
): QuickAddDraft {
  const wanted = result.listName ? listKey(result.listName) : ''
  const matched = wanted
    ? lists.find((list) => listKey(list.name) === wanted)
    : undefined
  const dueDate = result.dueDate ?? defaultDueDate ?? ''
  return {
    title: result.title,
    priority: result.priority,
    tagsText: result.tags.join(' '),
    listId: (matched ?? defaultList(lists, defaultListId))?.id ?? null,
    dueDate,
    dueTime: result.dueTime ?? '',
    allDay: result.allDay,
    recurrence: result.recurrence,
    // 没有截止日期时提前量无处落点，直接清空，避免草稿里显示“提前提醒”却建不出提醒。
    reminderOffsetMin: dueDate ? normalizeReminderOffset(result.reminderOffsetMin) : null
  }
}

function clampPriority(value: number): Priority {
  if (value >= 3) return 3
  if (value <= 0) return 0
  if (value === 2) return 2
  return 1
}

/** 标签输入支持空格、逗号、顿号与分号，去重后最多保留 8 个。 */
export function parseDraftTags(text: string): string[] {
  const tags: string[] = []
  for (const part of text.split(/[\s,，;；、]+/)) {
    const tag = part.replace(/^#+/, '').trim()
    if (!tag || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= 8) break
  }
  return tags
}

/**
 * 草稿落库前的最后校验：非法日期/时间被丢弃而不是整体失败，
 * 用户清空日期后不会被默认截止日期悄悄补回来（由调用方决定 defaultDueDate）。
 * 标题为空时返回 null，避免创建空任务。
 */
export function draftToQuickAddResult(
  draft: QuickAddDraft,
  lists: QuickAddDraftList[]
): QuickAddResult | null {
  const title = draft.title.trim()
  if (!title) return null
  const dueDate = normalizeDateKey(draft.dueDate)
  const dueTime = dueDate ? normalizeTime(draft.dueTime) : null
  const recurrence =
    draft.recurrence && /^FREQ=/i.test(draft.recurrence.trim())
      ? draft.recurrence.trim().toUpperCase()
      : null
  return {
    title,
    priority: clampPriority(draft.priority),
    tags: parseDraftTags(draft.tagsText),
    listName: lists.find((list) => list.id === draft.listId)?.name ?? null,
    dueDate,
    dueTime,
    allDay: dueTime ? false : draft.allDay,
    recurrence,
    reminderOffsetMin: dueDate ? normalizeReminderOffset(draft.reminderOffsetMin) : null
  }
}
