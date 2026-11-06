import { describe, expect, it } from 'vitest'
import {
  createQuickAddDraft,
  draftToQuickAddResult,
  parseDraftTags,
  type QuickAddDraft
} from '../src/shared/quick-add-draft'
import type { QuickAddResult } from '../src/shared/quick-add'

const LISTS = [
  { id: 'inbox', name: '收集箱', isInbox: true },
  { id: 'work', name: '工作' },
  { id: 'life', name: '生活' }
]

const AI_RESULT: QuickAddResult = {
  title: '交周报',
  priority: 3,
  tags: ['工作', '重点'],
  listName: '工作',
  dueDate: '2026-11-06',
  dueTime: '15:00',
  allDay: false,
  recurrence: 'FREQ=WEEKLY',
  reminderOffsetMin: null
}

describe('createQuickAddDraft', () => {
  it('把 AI 结果摊平成可编辑草稿，并匹配清单', () => {
    const draft = createQuickAddDraft(AI_RESULT, LISTS, 'inbox')
    expect(draft).toEqual({
      title: '交周报',
      priority: 3,
      tagsText: '工作 重点',
      listId: 'work',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      recurrence: 'FREQ=WEEKLY',
      reminderOffsetMin: null
    })
  })

  it('清单名匹配忽略大小写与空白', () => {
    const draft = createQuickAddDraft(
      { ...AI_RESULT, listName: ' 工 作 ' },
      LISTS,
      'inbox'
    )
    expect(draft.listId).toBe('work')
  })

  it('清单不存在时回落到默认清单，没有默认值时用收集箱', () => {
    expect(createQuickAddDraft({ ...AI_RESULT, listName: '不存在' }, LISTS, 'life').listId).toBe(
      'life'
    )
    expect(createQuickAddDraft({ ...AI_RESULT, listName: null }, LISTS, null).listId).toBe(
      'inbox'
    )
  })

  it('AI 没给日期时使用视图默认日期，便于用户直接改', () => {
    const draft = createQuickAddDraft(
      { ...AI_RESULT, dueDate: null, dueTime: null },
      LISTS,
      null,
      '2026-11-05'
    )
    expect(draft.dueDate).toBe('2026-11-05')
    expect(draft.dueTime).toBe('')
  })

  it('保留提前提醒；没有截止日期时清空提前量', () => {
    const draft = createQuickAddDraft({ ...AI_RESULT, reminderOffsetMin: 30 }, LISTS, 'inbox')
    expect(draft.reminderOffsetMin).toBe(30)

    const noDate = createQuickAddDraft(
      { ...AI_RESULT, dueDate: null, dueTime: null, reminderOffsetMin: 30 },
      LISTS,
      'inbox'
    )
    expect(noDate.reminderOffsetMin).toBeNull()
  })
})

describe('draftToQuickAddResult', () => {
  const baseDraft: QuickAddDraft = {
    title: '  交周报  ',
    priority: 2,
    tagsText: '工作, #重点 工作、生活',
    listId: 'work',
    dueDate: '2026-11-06',
    dueTime: '15:00',
    allDay: true,
    recurrence: 'freq=weekly',
    reminderOffsetMin: null
  }

  it('校验并规范化用户改过的字段', () => {
    expect(draftToQuickAddResult(baseDraft, LISTS)).toEqual({
      title: '交周报',
      priority: 2,
      tags: ['工作', '重点', '生活'],
      listName: '工作',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      recurrence: 'FREQ=WEEKLY',
      reminderOffsetMin: null
    })
  })

  it('用户清空日期后不会被默认日期补回来，时间也随之清空', () => {
    const result = draftToQuickAddResult({ ...baseDraft, dueDate: '', dueTime: '15:00' }, LISTS)
    expect(result?.dueDate).toBeNull()
    expect(result?.dueTime).toBeNull()
    expect(result?.allDay).toBe(true)
  })

  it('保留合法提前量；清空日期或提前量非法时不创建提醒', () => {
    expect(
      draftToQuickAddResult({ ...baseDraft, reminderOffsetMin: 15 }, LISTS)?.reminderOffsetMin
    ).toBe(15)
    expect(
      draftToQuickAddResult(
        { ...baseDraft, dueDate: '', reminderOffsetMin: 15 },
        LISTS
      )?.reminderOffsetMin
    ).toBeNull()
    expect(
      draftToQuickAddResult(
        { ...baseDraft, reminderOffsetMin: -5 },
        LISTS
      )?.reminderOffsetMin
    ).toBeNull()
  })

  it('非法日期或时间只丢弃该字段，不整体失败', () => {
    const invalidDate = draftToQuickAddResult({ ...baseDraft, dueDate: '2026-02-30' }, LISTS)
    expect(invalidDate?.title).toBe('交周报')
    expect(invalidDate?.dueDate).toBeNull()

    const invalidTime = draftToQuickAddResult({ ...baseDraft, dueTime: '25:99' }, LISTS)
    expect(invalidTime?.dueDate).toBe('2026-11-06')
    expect(invalidTime?.dueTime).toBeNull()
  })

  it('标题为空返回 null，避免创建空任务', () => {
    expect(draftToQuickAddResult({ ...baseDraft, title: '   ' }, LISTS)).toBeNull()
  })

  it('清单 ID 失效时 listName 为 null，由创建逻辑回落到当前清单', () => {
    expect(draftToQuickAddResult({ ...baseDraft, listId: 'gone' }, LISTS)?.listName).toBeNull()
  })

  it('重复规则非法时只丢弃该字段，不整体失败', () => {
    expect(
      draftToQuickAddResult({ ...baseDraft, recurrence: 'FREQ=HOURLY' }, LISTS)?.recurrence
    ).toBeNull()
    expect(
      draftToQuickAddResult(
        { ...baseDraft, recurrence: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1' },
        LISTS
      )?.recurrence
    ).toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1')
  })

  it('优先级越界会被夹到 0–3', () => {
    expect(
      draftToQuickAddResult({ ...baseDraft, priority: 9 as QuickAddDraft['priority'] }, LISTS)
        ?.priority
    ).toBe(3)
    expect(
      draftToQuickAddResult({ ...baseDraft, priority: -2 as QuickAddDraft['priority'] }, LISTS)
        ?.priority
    ).toBe(0)
  })
})

describe('parseDraftTags', () => {
  it('支持空格、逗号、顿号、分号并去重', () => {
    expect(parseDraftTags(' 工作,工作 #工作；生活、重点  ')).toEqual(['工作', '生活', '重点'])
  })

  it('最多保留 8 个标签', () => {
    expect(parseDraftTags('a b c d e f g h i j')).toHaveLength(8)
  })
})
