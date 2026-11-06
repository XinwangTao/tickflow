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
  autoLaunch: false,
  startMinimized: false,
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
        cancel: vi.fn(async () => true),
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

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const AI_OK_RESULT = {
  title: '交周报',
  priority: 3,
  tags: ['工作'],
  listName: null,
  dueDate: '2026-11-06',
  dueTime: '15:00',
  allDay: false,
  recurrence: null
}

describe('QuickAdd AI 请求取消与过期结果', () => {
  const createTask = vi.fn(async (input: CreateTaskInput) => taskFrom(input, 'task-1'))

  function mountWith(deferredResponse: Deferred<unknown>): {
    parseQuickAdd: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  } {
    const parseQuickAdd = vi.fn(
      (_input: string, _requestId?: string) => deferredResponse.promise as Promise<never>
    )
    const cancel = vi.fn(async () => true)
    useAppStore.setState({ lists: LISTS, settings: SETTINGS, tasks: [], toast: null })
    ;(window as unknown as { api: unknown }).api = {
      ai: { parseQuickAdd, cancel },
      tasks: {
        create: createTask,
        remove: vi.fn(async () => undefined),
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
    render(createElement(QuickAdd, { defaultListId: 'inbox' }))
    return { parseQuickAdd, cancel }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ lists: LISTS, settings: SETTINGS, tasks: [], toast: null })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ tasks: [], toast: null })
  })

  it('点「取消」会中止请求，迟到的 AI 结果不再弹出草稿', async () => {
    const pending = deferred<unknown>()
    const { parseQuickAdd, cancel } = mountWith(pending)

    const input = screen.getByLabelText('快速添加任务') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))

    const cancelButton = await screen.findByLabelText('取消 AI 解析')
    fireEvent.click(cancelButton)

    // 取消要精确落到刚才那次请求的 id 上，main 才能中止对应的 fetch。
    const requestId = parseQuickAdd.mock.calls[0][1] as string
    expect(requestId).toMatch(/^quick-add-\d+$/)
    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(screen.queryByLabelText('取消 AI 解析')).toBeNull()
    expect(useAppStore.getState().toast?.message).toContain('已取消 AI 解析')
    expect(useAppStore.getState().toast?.message).toContain('输入内容已保留')

    // 请求在取消之后才返回：结果必须被丢弃，不写库也不再显示草稿。
    pending.resolve({ ok: true, source: 'ai', warning: null, attempts: 1, result: AI_OK_RESULT })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
    expect(input.value).toBe('明天下午3点交周报')
  })

  it('解析中修改了输入时，旧输入的 AI 结果被忽略', async () => {
    const pending = deferred<unknown>()
    mountWith(pending)

    const input = screen.getByLabelText('快速添加任务') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))

    // 等待期间用户继续改写成另一条任务。
    fireEvent.change(input, { target: { value: '每周一 开例会' } })

    pending.resolve({ ok: true, source: 'ai', warning: null, attempts: 1, result: AI_OK_RESULT })
    await waitFor(() =>
      expect(useAppStore.getState().toast?.message).toContain('输入已变化，已忽略上一次 AI 解析结果')
    )

    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
    expect(input.value).toBe('每周一 开例会')
  })

  it('解析中按 Enter 不会静默失败，按 Esc 可中止', async () => {
    const pending = deferred<unknown>()
    const { cancel } = mountWith(pending)

    const input = screen.getByLabelText('快速添加任务') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))
    await screen.findByLabelText('取消 AI 解析')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(useAppStore.getState().toast?.message).toContain('AI 正在解析')
    )
    expect(createTask).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('取消 AI 解析')).toBeNull()

    pending.resolve({ ok: true, source: 'ai', warning: null, attempts: 1, result: AI_OK_RESULT })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
  })
})
