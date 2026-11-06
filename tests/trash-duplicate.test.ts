import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../src/renderer/src/components/ConfirmDialog'
import { MainView } from '../src/renderer/src/components/MainView'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import type { ListWithCount, TaskWithMeta } from '../src/shared/types'

// 每个用例后都清掉 DOM，避免上一个用例的确认框/主视图残留下来影响查询。
afterEach(cleanup)

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

function makeTask(overrides: Partial<TaskWithMeta> = {}): TaskWithMeta {
  return {
    id: 'task-1',
    listId: 'work',
    parentId: null,
    title: '交周报',
    notes: '汇总本周进展',
    status: 'open',
    priority: 2,
    dueDate: '2026-11-06',
    dueTime: '15:00',
    allDay: false,
    startDate: '2026-11-04',
    recurrence: 'FREQ=WEEKLY',
    pinned: false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    deletedAt: null,
    tags: [
      {
        id: 'tag-1',
        name: '工作',
        color: '#0091ff',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z'
      }
    ],
    listName: '工作',
    listColor: '#0091ff',
    listEmoji: null,
    subtaskCount: 0,
    subtaskDone: 0,
    ...overrides
  }
}

const get = vi.fn()
const create = vi.fn()
const purge = vi.fn(async () => undefined)

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    tasks: {
      get,
      create,
      purge,
      remove: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
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
}

describe('任务复制与垃圾箱', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    useAppStore.setState({
      lists: LISTS,
      tasks: [],
      toast: null,
      detailId: null,
      detailTask: null,
      view: 'trash'
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ tasks: [], toast: null, detailId: null, detailTask: null })
  })

  it('复制任务保留清单、日期、重复与标签，并加上副本后缀', async () => {
    const source = makeTask()
    get.mockResolvedValue(source)
    create.mockResolvedValue(makeTask({ id: 'copy-1', title: '交周报 副本' }))

    await act(async () => {
      await useAppStore.getState().duplicateTask('task-1')
    })

    expect(create).toHaveBeenCalledWith({
      listId: 'work',
      parentId: null,
      title: '交周报 副本',
      notes: '汇总本周进展',
      priority: 2,
      dueDate: '2026-11-06',
      dueTime: '15:00',
      allDay: false,
      startDate: '2026-11-04',
      recurrence: 'FREQ=WEEKLY',
      tagNames: ['工作']
    })
    expect(useAppStore.getState().toast?.message).toBe('已复制「交周报」')
    expect(useAppStore.getState().toast?.actionLabel).toBe('撤销')
  })

  it('撤销复制会永久删除刚创建的那条副本', async () => {
    get.mockResolvedValue(makeTask())
    create.mockResolvedValue(makeTask({ id: 'copy-1', title: '交周报 副本' }))

    await act(async () => {
      await useAppStore.getState().duplicateTask('task-1')
    })
    const toast = useAppStore.getState().toast
    await act(async () => {
      await toast?.action?.()
    })

    expect(purge).toHaveBeenCalledWith('copy-1')
    expect(useAppStore.getState().toast?.message).toBe('已撤销复制')
  })

  it('源任务不存在时复制静默跳过，不弹错误', async () => {
    get.mockResolvedValue(null)

    await act(async () => {
      await useAppStore.getState().duplicateTask('missing')
    })

    expect(create).not.toHaveBeenCalled()
    expect(useAppStore.getState().toast).toBeNull()
  })

  it('清空垃圾箱只永久删除已删除的任务，并回报数量', async () => {
    useAppStore.setState({
      tasks: [
        makeTask({ id: 'trash-1', deletedAt: '2026-11-05T00:00:00.000Z' }),
        makeTask({ id: 'trash-2', deletedAt: '2026-11-05T00:00:00.000Z' }),
        makeTask({ id: 'open-1' })
      ]
    })

    await act(async () => {
      await useAppStore.getState().emptyTrash()
    })

    expect(purge.mock.calls).toEqual([['trash-1'], ['trash-2']])
    expect(useAppStore.getState().toast?.message).toBe('已永久删除 2 个任务')
  })

  it('垃圾箱为空时清空操作不调用 IPC、也不弹多余提示', async () => {
    useAppStore.setState({ tasks: [makeTask()] })

    await act(async () => {
      await useAppStore.getState().emptyTrash()
    })

    expect(purge).not.toHaveBeenCalled()
    expect(useAppStore.getState().toast).toBeNull()
  })
})

describe('应用内二次确认框', () => {
  it('展示确认文案，默认聚焦取消，确认与取消分别回调', () => {
    const onConfirm = vi.fn(async () => undefined)
    const onClose = vi.fn()
    render(
      createElement(ConfirmDialog, {
        title: '清空垃圾箱',
        message: '垃圾箱中的 3 个任务将被永久删除，无法恢复。',
        danger: true,
        confirmLabel: '永久删除',
        onConfirm,
        onClose
      })
    )

    expect(screen.getByRole('dialog', { name: '清空垃圾箱' })).toBeInTheDocument()
    expect(
      screen.getByText('垃圾箱中的 3 个任务将被永久删除，无法恢复。')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(screen.getByRole('dialog', { name: '清空垃圾箱' })).getByRole('button', {
        name: '永久删除'
      })
    )
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭确认框，不会执行确认动作', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      createElement(ConfirmDialog, {
        title: '清空垃圾箱',
        message: '确认？',
        onConfirm,
        onClose
      })
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('垃圾箱视图清空入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    useAppStore.setState({
      lists: LISTS,
      toast: null,
      detailId: null,
      detailTask: null,
      view: 'trash',
      tasks: [makeTask({ id: 'trash-1', deletedAt: '2026-11-05T00:00:00.000Z' })]
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState({ tasks: [], toast: null, view: 'today' })
  })

  it('点清空按钮先弹确认框，确认后才永久删除', async () => {
    render(createElement(MainView))

    fireEvent.click(screen.getByLabelText('清空垃圾箱'))
    expect(screen.getByRole('dialog', { name: '清空垃圾箱' })).toBeInTheDocument()
    expect(screen.getByText(/1 个任务将被永久删除/)).toBeInTheDocument()
    expect(purge).not.toHaveBeenCalled()

    fireEvent.click(
      within(screen.getByRole('dialog', { name: '清空垃圾箱' })).getByRole('button', {
        name: '永久删除'
      })
    )

    await waitFor(() => expect(purge).toHaveBeenCalledWith('trash-1'))
    expect(screen.queryByRole('dialog', { name: '清空垃圾箱' })).toBeNull()
  })

  it('垃圾箱为空时清空按钮禁用', () => {
    useAppStore.setState({ tasks: [] })
    render(createElement(MainView))

    expect(screen.getByLabelText('清空垃圾箱')).toBeDisabled()
  })
})
