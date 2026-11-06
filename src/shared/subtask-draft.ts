import type { AiSubtaskDraft } from './ai'
import type { Priority } from './types'

/**
 * AI 拆解子任务的可编辑草稿行：在写库前允许用户改标题、调优先级、
 * 勾选/取消或删除某一条，确认后才批量创建，避免模型结果直接落库。
 */
export interface AiSubtaskDraftRow extends AiSubtaskDraft {
  /** 稳定的 React key；同一批草稿内唯一即可。 */
  key: string
  selected: boolean
}

export const AI_SUBTASK_DRAFT_LIMIT = 10

/** 把主进程校验过的子任务摊平成可编辑行；默认全部勾选。 */
export function createSubtaskDraftRows(drafts: AiSubtaskDraft[]): AiSubtaskDraftRow[] {
  return drafts.slice(0, AI_SUBTASK_DRAFT_LIMIT).map((draft, index) => ({
    key: `ai-subtask-${index}`,
    title: draft.title,
    priority: draft.priority as Priority,
    dueDate: draft.dueDate,
    dueTime: draft.dueTime,
    allDay: draft.allDay,
    selected: true
  }))
}

/**
 * 收集用户确认要添加的行：只取勾选行，标题去首尾空白，
 * 忽略空标题与忽略大小写/空白后的重复标题，最多 10 条。
 */
export function collectSelectedSubtasks(rows: AiSubtaskDraftRow[]): AiSubtaskDraft[] {
  const seen = new Set<string>()
  const result: AiSubtaskDraft[] = []
  for (const row of rows) {
    if (!row.selected) continue
    const title = row.title.trim()
    const key = title.replace(/\s+/g, '').toLowerCase()
    if (!title || seen.has(key)) continue
    seen.add(key)
    result.push({
      title,
      priority: row.priority,
      dueDate: row.dueDate,
      dueTime: row.dueTime,
      allDay: row.allDay
    })
    if (result.length >= AI_SUBTASK_DRAFT_LIMIT) break
  }
  return result
}
