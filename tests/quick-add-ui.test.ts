import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from '../src/renderer/src/components/QuickAdd'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS } from '../src/shared/ai'
import type { CreateTaskInput, ListWithCount, Settings, TaskWithMeta } from '../src/shared/types'

const LISTS: ListWithCount[] = [
  {
    id: 'inbox',
    name: '收集箱',
    color: '#f5c542',
    emoji: null,
    sortOrder: 0,
    isInbox: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deletedAt: null,
    openCount: 0
  },
  {
    id: 'work',
    name: '工作',
    color: '#0091ff',
    emoji: null,
    sortOrder: 1,
    isInbox: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deletedAt: null,
    openCount: 0
  }
]

const SETTINGS: Settings = {
  theme: 'dark',
  accent: '#f5c542',
  weekStart: 1,
  defaultListId: 'inbox',
  showCompleted: false,
  fontScale: 1,
  r2Endpoint: '',
  r2Bucket: '',
  r2AccessKeyId: '',
  r2SecretAccessKey: '',
  r2Prefix: 'tickflow/snapshots/',
  r2AutoSync: false,
  r2LastSync: null,
  aiEnabled: true,
  aiBaseUrl: AI_DEFAULT_BASE_URL,
  aiModel: AI_DEFAULT_MODEL,
  aiToken: '',
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS
}

function taskFrom(input: CreateTaskInput, id: string): TaskWithMeta {
  return {
    id,
    listId: input.listId,
    parentId: input.parentId ?? null,
    title: input.title,
    notes: input.notes ?? '',
    status: 'open',
    priority: input.priority ?? 0,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    allDay: input.allDay ?? true,
    startDate: input.startDate ?? null,
    recurrence: input.recurrence ?? null,
    pinned: input.pinned ?? false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    deletedAt: null,
    tags: [],
    listName: '工作',
    listColor: '#0091ff',
    listEmoji: null,
    subtaskCount: 0,
    subtaskDone: 0
  }
}

describe('QuickAdd AI 结果草稿', () => {
  const createTask = vi.fn(async (input: CreateTaskInput) => taskFrom(input, 'task-1'))
  const removeTask = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ lists: LISTS, settings: SETTINGS, tasks: [], toast: null })
    ;(window as unknown as { api: unknown }).api = {
      ai: {
        parseQuickAdd: vi.fn(async () => ({
          ok: true,
          source: 'ai',
          warning: null,
          attempts: 1,
          result: {
            title: '交周报',
            priority: 3,
            tags: ['工作', '重点'],
            listName: '工作',
            dueDate: '2026-11-06',
            dueTime: '15:00',
            allDay: false,
            recurrence: 'FREQ=WEEKLY'
          }
        }))
      },
      tasks: {
        create: createTask,
        remove: removeTask,
        query: vi.fn(async () => []),
        counts: vi.fn(async () => ({
          inbox: 0,
          today: 0,
          next7: 0,
          completed: 0,
          abandoned: 0,
          trash: 0,
          lists: {}
        }))
      },
      lists: { list: vi.fn(async () => LISTS) },
      tags: { list: vi.fn(async () => []) },
      filters: { list: vi.fn(async () => []) }
    }
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ tasks: [], toast: null })
  })

  it('先展示可编辑草稿，确认后才写库，并可通过 toast 撤销', async () => {
    render(createElement(QuickAdd, { defaultListId: 'inbox' }))
    const input = screen.getByLabelText('快速添加任务') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))

    const titleInput = (await screen.findByLabelText('AI 任务标题')) as HTMLInputElement
    expect(titleInput.value).toBe('交周报')
    expect(createTask).not.toHaveBeenCalled()

    fireEvent.change(titleInput, { target: { value: '交周报（终稿）' } })
    fireEvent.change(screen.getByLabelText('AI 优先级'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '交周报（终稿）',
      priority: 2,
      listId: 'work',
      dueDate: '2026-11-06',
      dueTime: '15:00',
      tagNames: ['工作', '重点']
    })
    expect(input.value).toBe('')
    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()

    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('AI 已添加「交周报（终稿）」')
    expect(toast?.actionLabel).toBe('撤销')
    await toast?.action?.()
    expect(removeTask).toHaveBeenCalledWith('task-1')
  })

  it('取消草稿不写库，原输入保留', async () => {
    render(createElement(QuickAdd, { defaultListId: 'inbox' }))
    const input = screen.getByLabelText('快速添加任务') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))
    await screen.findByLabelText('AI 任务标题')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
    expect(input.value).toBe('明天下午3点交周报')
  })
})
