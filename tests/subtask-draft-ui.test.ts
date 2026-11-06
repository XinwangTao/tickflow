import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Subtasks } from '../src/renderer/src/components/DetailDrawer'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS } from '../src/shared/ai'
import type { CreateTaskInput, Settings, TaskWithMeta } from '../src/shared/types'

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

function makeTask(input: CreateTaskInput, id: string): TaskWithMeta {
  return {
    id,
    listId: input.listId,
    parentId: input.parentId ?? null,
    title: input.title,
    notes: '',
    status: 'open',
    priority: input.priority ?? 0,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    allDay: input.allDay ?? true,
    startDate: input.startDate ?? null,
    recurrence: input.recurrence ?? null,
    pinned: false,
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

const PARENT: TaskWithMeta = makeTask({ listId: 'work', title: '准备季度复盘' }, 'parent-1')

const AI_RESPONSE = {
  ok: true,
  source: 'ai' as const,
  warning: null,
  attempts: 1,
  subtasks: [
    { title: '整理季度数据', priority: 2 as const, dueDate: null, dueTime: null, allDay: true },
    { title: '撰写复盘结论', priority: 0 as const, dueDate: null, dueTime: null, allDay: true }
  ]
}

describe('Subtasks AI 拆解草稿', () => {
  let currentSubtasks: TaskWithMeta[]
  let createTask: ReturnType<typeof vi.fn>
  let removeTask: ReturnType<typeof vi.fn>
  let breakdown: ReturnType<typeof vi.fn>
  let cancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    currentSubtasks = []
    let seq = 0
    createTask = vi.fn(async (input: CreateTaskInput) => {
      const task = makeTask(input, `subtask-${(seq += 1)}`)
      currentSubtasks.push(task)
      return task
    })
    removeTask = vi.fn(async (id: string) => {
      currentSubtasks = currentSubtasks.filter((task) => task.id !== id)
    })
    breakdown = vi.fn(async () => AI_RESPONSE)
    cancel = vi.fn(async () => true)

    useAppStore.setState({
      settings: SETTINGS,
      tasks: [],
      toast: null,
      refresh: vi.fn(async () => undefined),
      showToast: (message, kind = 'info', options) => {
        useAppStore.setState({ toast: { id: Date.now(), message, kind, ...options } })
      }
    })
    ;(window as unknown as { api: unknown }).api = {
      ai: { breakdownSubtasks: breakdown, cancel },
      tasks: {
        query: vi.fn(async () => currentSubtasks),
        create: createTask,
        remove: removeTask
      }
    }
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ tasks: [], toast: null })
  })

  /** 测试里替换拆解实现后，同步给 window.api，模拟 renderer 真实调用链。 */
  function swapBreakdown(impl: ReturnType<typeof vi.fn>): void {
    ;(
      window as unknown as { api: { ai: { breakdownSubtasks: ReturnType<typeof vi.fn> } } }
    ).api.ai.breakdownSubtasks = impl
  }

  it('AI 结果先进入可编辑草稿，确认后才写库，并可通过 toast 撤销', async () => {
    render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))

    const group = await screen.findByRole('group', { name: 'AI 拆解结果' })
    expect(group).toBeInTheDocument()
    expect(createTask).not.toHaveBeenCalled()

    const title = screen.getByLabelText('子任务标题 1') as HTMLInputElement
    expect(title.value).toBe('整理季度数据')
    fireEvent.change(title, { target: { value: '整理季度原始数据' } })
    fireEvent.change(screen.getByLabelText('子任务优先级 1'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('选择子任务 2'))
    fireEvent.click(screen.getByRole('button', { name: /添加选中/ }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      listId: 'work',
      parentId: 'parent-1',
      title: '整理季度原始数据',
      priority: 3
    })
    await waitFor(() => expect(screen.queryByRole('group', { name: 'AI 拆解结果' })).toBeNull())
    expect(screen.getByText('整理季度原始数据')).toBeInTheDocument()

    const toast = useAppStore.getState().toast
    expect(toast?.message).toBe('AI 已添加 1 个子任务')
    expect(toast?.actionLabel).toBe('撤销')
    await toast?.action?.()
    expect(removeTask).toHaveBeenCalledWith('subtask-1')
  })

  it('取消草稿不写库，也不占用 AI 按钮', async () => {
    render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))
    await screen.findByRole('group', { name: 'AI 拆解结果' })

    fireEvent.click(screen.getByRole('button', { name: '取消 AI 拆解结果' }))
    expect(screen.queryByRole('group', { name: 'AI 拆解结果' })).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
    expect(screen.getByLabelText('AI 拆解子任务')).toBeEnabled()
  })

  it('全部取消勾选时添加按钮不可用，不会写入空子任务', async () => {
    render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))
    await screen.findByRole('group', { name: 'AI 拆解结果' })

    fireEvent.click(screen.getByLabelText('选择子任务 1'))
    fireEvent.click(screen.getByLabelText('选择子任务 2'))
    expect(screen.getByRole('button', { name: '添加选中（0）' })).toBeDisabled()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('草稿确认时按当前列表再过滤一次，不会写入同名子任务', async () => {
    currentSubtasks = [makeTask({ listId: 'work', title: '整理季度数据' }, 'manual-1')]
    render(createElement(Subtasks, { task: PARENT }))
    // 等面板读完现有子任务，再触发 AI 拆解。
    await screen.findByText('整理季度数据')
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))
    await screen.findByRole('group', { name: 'AI 拆解结果' })

    fireEvent.click(screen.getByRole('button', { name: /添加选中/ }))
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0].title).toBe('撰写复盘结论')
  })

  it('AI 不可用时仍按规则拆解立即添加，并保留失败原因与撤销', async () => {
    breakdown = vi.fn(async () => ({
      ok: false,
      source: 'rule' as const,
      warning: '连接不上 AI 服务（127.0.0.1:15721），请确认 CC Switch 已启动',
      attempts: 2,
      subtasks: [
        { title: '整理数据', priority: 0 as const, dueDate: null, dueTime: null, allDay: true }
      ]
    }))
    ;(
      window as unknown as { api: { ai: { breakdownSubtasks: ReturnType<typeof vi.fn> } } }
    ).api.ai.breakdownSubtasks = breakdown

    render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('AI 拆解不可用，已按规则添加 1 个子任务')
    expect(toast?.message).toContain('连接不上 AI 服务')
    expect(toast?.kind).toBe('info')
    expect(toast?.actionLabel).toBe('撤销')
    expect(screen.queryByRole('group', { name: 'AI 拆解结果' })).toBeNull()
  })

  it('取消进行中的拆解会中止请求，迟到的结果不进入草稿', async () => {
    let resolveBreakdown!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      resolveBreakdown = resolve
    })
    breakdown = vi.fn(() => pending)
    swapBreakdown(breakdown)

    render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))

    fireEvent.click(await screen.findByLabelText('取消 AI 拆解'))

    // 取消要精确落到刚才那次请求的 id 上，main 才能中止对应的 fetch。
    const requestId = breakdown.mock.calls[0][1]
    expect(requestId).toMatch(/^subtasks-\d+$/)
    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(useAppStore.getState().toast?.message).toContain('已取消 AI 拆解')
    expect(screen.getByLabelText('AI 拆解子任务')).toBeEnabled()

    // 迟到响应：不弹草稿、不写库。
    resolveBreakdown(AI_RESPONSE)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByRole('group', { name: 'AI 拆解结果' })).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('切换到别的任务时自动中止进行中的拆解请求', async () => {
    let resolveBreakdown!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      resolveBreakdown = resolve
    })
    breakdown = vi.fn(() => pending)
    swapBreakdown(breakdown)
    const OTHER = makeTask({ listId: 'work', title: '写季度总结' }, 'parent-2')

    const view = render(createElement(Subtasks, { task: PARENT }))
    fireEvent.click(screen.getByLabelText('AI 拆解子任务'))
    await screen.findByLabelText('取消 AI 拆解')

    view.rerender(createElement(Subtasks, { task: OTHER }))

    expect(cancel).toHaveBeenCalledWith(breakdown.mock.calls[0][1])
    // 新任务的按钮恢复可用，旧请求的响应不会把草稿塞进新任务。
    await waitFor(() => expect(screen.getByLabelText('AI 拆解子任务')).toBeEnabled())
    resolveBreakdown(AI_RESPONSE)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByRole('group', { name: 'AI 拆解结果' })).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
  })
})
