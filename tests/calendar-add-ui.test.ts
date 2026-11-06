import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../src/renderer/src/components/CalendarView'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS } from '../src/shared/ai'
import { addDaysToKey, todayKey } from '../src/shared/dates'
import type {
  CreateTaskInput,
  ListWithCount,
  Settings,
  TaskWithMeta
} from '../src/shared/types'
import type { QuickAddResult } from '../src/shared/quick-add'

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
    listName: '收集箱',
    listColor: '#f5c542',
    listEmoji: null,
    subtaskCount: 0,
    subtaskDone: 0
  }
}

const createTask = vi.fn(async (input: CreateTaskInput) => taskFrom(input, 'task-1'))
const removeTask = vi.fn(async () => undefined)
const parseAi = vi.fn()
const cancelAi = vi.fn(async () => true)
const createReminder = vi.fn(async () => ({
  id: 'reminder-1',
  taskId: 'task-1',
  triggerAt: '2026-11-06T00:00:00.000Z',
  sentAt: null,
  createdAt: '2026-11-06T00:00:00.000Z'
}))

let showToastSpy: ReturnType<typeof vi.fn>

function aiRuleResult(overrides: Partial<QuickAddResult> = {}): QuickAddResult {
  return {
    title: '买牛奶',
    priority: 0,
    tags: [],
    listName: null,
    dueDate: todayKey(),
    dueTime: null,
    allDay: true,
    recurrence: null,
    reminderOffsetMin: null,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  parseAi.mockReset()
  parseAi.mockResolvedValue({
    ok: false,
    source: 'rule',
    result: aiRuleResult(),
    warning: null,
    attempts: 1
  })
  cancelAi.mockReset()
  cancelAi.mockResolvedValue(true)
  const realShowToast = useAppStore.getState().showToast
  showToastSpy = vi.fn(realShowToast)
  useAppStore.setState({
    lists: LISTS,
    settings: SETTINGS,
    tasks: [],
    toast: null,
    showToast: showToastSpy as unknown as typeof realShowToast
  })
  ;(window as unknown as { api: unknown }).api = {
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
    filters: { list: vi.fn(async () => []) },
    reminders: {
      create: createReminder,
      list: vi.fn(async () => []),
      remove: vi.fn(async () => undefined)
    },
    ai: {
      parseQuickAdd: parseAi,
      cancel: cancelAi
    }
  }
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ tasks: [], toast: null })
})

function renderCalendar(): ReturnType<typeof render> {
  return render(
    createElement(CalendarView, {
      tasks: [],
      month: todayKey().slice(0, 7),
      weekStart: 1,
      onShiftMonth: vi.fn(),
      onSetMonth: vi.fn()
    })
  )
}

function openAddForm(): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: '添加任务' }))
  return screen.getByLabelText('日历添加任务标题') as HTMLInputElement
}

// 全量并行跑测试时 jsdom 竞争激烈，给这组交互用例留足超时。
describe('日历选中日期行内添加任务', { timeout: 20_000 }, () => {
  it('自然语言输入先显示解析预览，确认后落到选中日期并可撤销', async () => {
    renderCalendar()
    const input = openAddForm()
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: '明天 9点 晨会 #工作 !高 提前15分钟提醒' } })

    const preview = screen.getByLabelText('解析预览')
    expect(preview).toHaveTextContent('明天 09:00')
    expect(preview).toHaveTextContent('高优先级')
    expect(preview).toHaveTextContent('#工作')
    expect(preview).toHaveTextContent('提前 15 分钟提醒')
    expect(createTask).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    // 全量并行跑测试时机器可能很忙，给这条写库断言留足时间。
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(createTask.mock.calls[0][0]).toMatchObject({
      listId: 'inbox',
      title: '晨会',
      dueDate: addDaysToKey(todayKey(), 1),
      dueTime: '09:00',
      allDay: false,
      priority: 3,
      tagNames: ['工作'],
      recurrence: null
    })

    // 提前 15 分钟 → 选中日 08:45 的本地时间。
    expect(createReminder).toHaveBeenCalledTimes(1)
    const [reminderTaskId, triggerAt] = createReminder.mock.calls[0] as unknown as [string, string]
    expect(reminderTaskId).toBe('task-1')
    const [year, month, day] = addDaysToKey(todayKey(), 1).split('-').map(Number)
    expect(triggerAt).toBe(new Date(year, month - 1, day, 8, 45, 0, 0).toISOString())

    // 添加成功后收起表单，输入框清空。
    expect(screen.queryByLabelText('日历添加任务标题')).toBeNull()

    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('已添加「晨会」')
    expect(toast?.actionLabel).toBe('撤销')
    await toast?.action?.()
    expect(removeTask).toHaveBeenCalledWith('task-1')
  })

  it('只写标题时创建全天任务，不改动选中日期', async () => {
    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '买牛奶' } })
    expect(screen.getByLabelText('解析预览')).toHaveTextContent('今天')

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      listId: 'inbox',
      title: '买牛奶',
      dueDate: todayKey(),
      dueTime: null,
      allDay: true,
      priority: 0,
      tagNames: []
    })
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('输入里明确写了日期时按输入日期创建，预览同步显示', async () => {
    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '明天 10点 开会' } })
    expect(screen.getByLabelText('解析预览')).toHaveTextContent('明天 10:00')

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '开会',
      dueDate: addDaysToKey(todayKey(), 1),
      dueTime: '10:00',
      allDay: false
    })
  })

  it('空标题不写库，提示后输入内容保留', async () => {
    renderCalendar()
    openAddForm()

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(await screen.findByRole('status')).toHaveTextContent('请输入任务标题')
    expect(createTask).not.toHaveBeenCalled()
    expect(screen.getByLabelText('日历添加任务标题')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('日历添加任务标题'), {
      target: { value: '写周报' }
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('按 Esc 或「取消」收起表单并清空草稿', () => {
    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '临时草稿' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('日历添加任务标题')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加任务' }))
    expect((screen.getByLabelText('日历添加任务标题') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('日历添加任务标题')).toBeNull()
  })

  it('~清单 命中的清单优先，找不到时落回默认清单并提示', async () => {
    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '~工作 买菜' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({ listId: 'work', title: '买菜' })

    const second = openAddForm()
    fireEvent.change(second, { target: { value: '~不存在的清单 交表' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2))
    expect(createTask.mock.calls[1][0]).toMatchObject({ listId: 'inbox', title: '交表' })
    expect(
      showToastSpy.mock.calls.some((call) => String(call[0]).includes('未找到清单「不存在的清单」'))
    ).toBe(true)
  })

  it('切换选中的日期会收起表单，避免任务建到看不见的那天', async () => {
    const { container } = renderCalendar()
    openAddForm()
    fireEvent.change(screen.getByLabelText('日历添加任务标题'), {
      target: { value: '跨天草稿' }
    })

    const otherCell = container.querySelector('.calendar-cell:not(.outside):not(.selected)')
    expect(otherCell).not.toBeNull()
    fireEvent.click(otherCell as Element)

    await waitFor(() => expect(screen.queryByLabelText('日历添加任务标题')).toBeNull())
    expect(createTask).not.toHaveBeenCalled()
  })

  it('日视图也能直接添加，目标日期是当前这一天', async () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: '日' }))
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '15点 复盘' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '复盘',
      dueDate: todayKey(),
      dueTime: '15:00',
      allDay: false
    })
  })
})

describe('日历行内添加 AI 解析', { timeout: 20_000 }, () => {
  it('AI 结果先进入可编辑草稿，确认后才写库并可撤销', async () => {
    parseAi.mockResolvedValue({
      ok: true,
      source: 'ai',
      result: aiRuleResult({
        title: '跟客户开会',
        priority: 3,
        tags: ['工作'],
        dueDate: todayKey(),
        dueTime: '09:00',
        allDay: false
      }),
      warning: null,
      attempts: 1
    })

    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '明早九点跟客户开会 #工作' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    // 草稿展示期间不写库，并带上选中的日期供 main 兜底。
    await screen.findByLabelText('AI 任务标题')
    expect(createTask).not.toHaveBeenCalled()
    expect(parseAi).toHaveBeenCalledWith(
      '明早九点跟客户开会 #工作',
      expect.stringMatching(/^calendar-add-\d+$/),
      todayKey()
    )
    expect(screen.queryByLabelText('解析预览')).toBeNull()

    // 草稿未处理时普通 Enter 不会绕过草稿重复建任务。
    fireEvent.keyDown(screen.getByLabelText('日历添加任务标题'), { key: 'Enter' })
    expect(
      showToastSpy.mock.calls.some((call) =>
        String(call[0]).includes('请先添加或取消上方的 AI 解析结果')
      )
    ).toBe(true)
    expect(createTask).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('AI 任务标题'), {
      target: { value: '跟客户开会（已改）' }
    })
    fireEvent.change(screen.getByLabelText('AI 优先级'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('AI 截止日期'), {
      target: { value: addDaysToKey(todayKey(), 1) }
    })
    fireEvent.click(screen.getByRole('button', { name: '确认添加' }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      listId: 'inbox',
      title: '跟客户开会（已改）',
      priority: 1,
      tagNames: ['工作'],
      dueDate: addDaysToKey(todayKey(), 1),
      dueTime: '09:00',
      allDay: false
    })
    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()

    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('AI 已添加「跟客户开会（已改）」')
    expect(toast?.actionLabel).toBe('撤销')
    await toast?.action?.()
    expect(removeTask).toHaveBeenCalledWith('task-1')
  })

  it('AI 失败时按规则立即添加，提示原因并保留撤销', async () => {
    parseAi.mockResolvedValue({
      ok: false,
      source: 'rule',
      result: aiRuleResult({ title: '买牛奶' }),
      warning: 'AI 服务繁忙，请稍后再试',
      attempts: 2
    })

    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '买牛奶' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '买牛奶',
      dueDate: todayKey(),
      allDay: true
    })

    const toast = useAppStore.getState().toast
    expect(toast?.message).toContain('AI 未能解析，已按规则添加「买牛奶」')
    expect(toast?.message).toContain('AI 服务繁忙')
    expect(toast?.actionLabel).toBe('撤销')
  })

  it('取消进行中的 AI 解析：中止请求、不建任务、输入保留', async () => {
    let resolveAi: (value: unknown) => void = () => undefined
    parseAi.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAi = resolve
        })
    )

    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '明早 晨会' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    const cancelButton = await screen.findByRole('button', { name: '取消 AI 解析' })
    fireEvent.click(cancelButton)

    expect(cancelAi).toHaveBeenCalledWith(expect.stringMatching(/^calendar-add-\d+$/))
    expect(createTask).not.toHaveBeenCalled()
    expect((screen.getByLabelText('日历添加任务标题') as HTMLInputElement).value).toBe(
      '明早 晨会'
    )
    expect(
      showToastSpy.mock.calls.some((call) => String(call[0]).includes('已取消 AI 解析'))
    ).toBe(true)

    // 取消后迟到的结果不会弹出草稿。
    resolveAi({
      ok: true,
      source: 'ai',
      result: aiRuleResult({ title: '迟到的结果' }),
      warning: null,
      attempts: 1
    })
    await waitFor(() => expect(screen.queryByLabelText('AI 任务标题')).toBeNull())
  })

  it('等待解析期间改写输入会丢弃迟到结果', async () => {
    let resolveAi: (value: unknown) => void = () => undefined
    parseAi.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAi = resolve
        })
    )

    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '旧的一句话' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await screen.findByRole('button', { name: '取消 AI 解析' })

    fireEvent.change(input, { target: { value: '换了一句新任务' } })
    resolveAi({
      ok: true,
      source: 'ai',
      result: aiRuleResult({ title: '旧任务' }),
      warning: null,
      attempts: 1
    })

    await waitFor(() =>
      expect(
        showToastSpy.mock.calls.some((call) =>
          String(call[0]).includes('输入已变化，已忽略上一次 AI 解析结果')
        )
      ).toBe(true)
    )
    expect(screen.queryByLabelText('AI 任务标题')).toBeNull()
    expect(createTask).not.toHaveBeenCalled()
    expect((screen.getByLabelText('日历添加任务标题') as HTMLInputElement).value).toBe(
      '换了一句新任务'
    )
  })

  it('草稿里清空日期后确认，不会被选中日期补回来', async () => {
    parseAi.mockResolvedValue({
      ok: true,
      source: 'ai',
      result: aiRuleResult({
        title: '待定会议',
        dueDate: todayKey(),
        dueTime: '10:00',
        allDay: false
      }),
      warning: null,
      attempts: 1
    })

    renderCalendar()
    const input = openAddForm()
    fireEvent.change(input, { target: { value: '待定会议' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await screen.findByLabelText('AI 任务标题')

    fireEvent.change(screen.getByLabelText('AI 截止日期'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '确认添加' }))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '待定会议',
      dueDate: null,
      dueTime: null,
      allDay: true
    })
    expect(createReminder).not.toHaveBeenCalled()
  })

  it('关闭 AI 时不显示 AI 按钮，普通 Enter 仍按规则添加', async () => {
    useAppStore.setState({ settings: { ...SETTINGS, aiEnabled: false } })
    renderCalendar()
    const input = openAddForm()
    expect(screen.queryByRole('button', { name: 'AI 解析' })).toBeNull()

    fireEvent.change(input, { target: { value: '9点 晨会' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask.mock.calls[0][0]).toMatchObject({
      title: '晨会',
      dueDate: todayKey(),
      dueTime: '09:00'
    })
    expect(parseAi).not.toHaveBeenCalled()
  })
})
