import { describe, expect, it } from 'vitest'
import {
  collectSelectedSubtasks,
  createSubtaskDraftRows,
  type AiSubtaskDraftRow
} from '../src/shared/subtask-draft'
import type { AiSubtaskDraft } from '../src/shared/ai'

const DRAFTS: AiSubtaskDraft[] = [
  { title: '整理季度数据', priority: 2, dueDate: null, dueTime: null, allDay: true },
  { title: '撰写复盘结论', priority: 0, dueDate: '2026-11-07', dueTime: '10:00', allDay: false }
]

describe('createSubtaskDraftRows', () => {
  it('把 AI 子任务摊平成默认全选的可编辑行', () => {
    const rows = createSubtaskDraftRows(DRAFTS)
    expect(rows.map((row) => row.key)).toEqual(['ai-subtask-0', 'ai-subtask-1'])
    expect(rows.every((row) => row.selected)).toBe(true)
    expect(rows[1]).toMatchObject({
      title: '撰写复盘结论',
      priority: 0,
      dueDate: '2026-11-07',
      dueTime: '10:00',
      allDay: false
    })
  })

  it('最多生成 10 行，与主进程的拆解上限一致', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      ...DRAFTS[0],
      title: `子任务 ${index + 1}`
    }))
    expect(createSubtaskDraftRows(many)).toHaveLength(10)
  })
})

describe('collectSelectedSubtasks', () => {
  function rows(): AiSubtaskDraftRow[] {
    return createSubtaskDraftRows(DRAFTS)
  }

  it('只收集勾选行，标题去首尾空白', () => {
    const draftRows = rows()
    draftRows[0] = { ...draftRows[0], title: '  整理季度数据  ', selected: false }
    draftRows[1] = { ...draftRows[1], title: '  撰写复盘结论  ' }
    expect(collectSelectedSubtasks(draftRows)).toEqual([
      {
        title: '撰写复盘结论',
        priority: 0,
        dueDate: '2026-11-07',
        dueTime: '10:00',
        allDay: false
      }
    ])
  })

  it('忽略空标题与忽略大小写/空白后的重复标题', () => {
    const draftRows: AiSubtaskDraftRow[] = [
      ...rows(),
      { ...rows()[0], key: 'ai-subtask-2', title: '   ' },
      { ...rows()[0], key: 'ai-subtask-3', title: '整 理季度数据' }
    ]
    expect(collectSelectedSubtasks(draftRows).map((draft) => draft.title)).toEqual([
      '整理季度数据',
      '撰写复盘结论'
    ])
  })

  it('全部取消勾选时返回空数组，不会写入空任务', () => {
    expect(collectSelectedSubtasks(rows().map((row) => ({ ...row, selected: false })))).toEqual([])
  })

  it('最多返回 10 条', () => {
    const draftRows = createSubtaskDraftRows(
      Array.from({ length: 10 }, (_, index) => ({ ...DRAFTS[0], title: `子任务 ${index + 1}` }))
    )
    expect(collectSelectedSubtasks(draftRows)).toHaveLength(10)
  })
})
