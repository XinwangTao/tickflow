import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchOverlay } from '../src/renderer/src/components/SearchOverlay'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import type { TaskWithMeta } from '../src/shared/types'

const RECENT_KEY = 'tickflow.recentSearches'

const TASK: TaskWithMeta = {
  id: 'task-1',
  listId: 'work',
  parentId: null,
  title: '交周报',
  notes: '',
  status: 'open',
  priority: 0,
  dueDate: null,
  dueTime: null,
  allDay: true,
  startDate: null,
  recurrence: null,
  pinned: false,
  sortOrder: 0,
  completedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
  tags: [],
  listName: '工作',
  listColor: '#0091ff',
  listEmoji: null,
  subtaskCount: 0,
  subtaskDone: 0
}

const query = vi.fn(async () => [TASK])
const get = vi.fn(async () => TASK)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    searchSeed: '',
    searchOpen: true,
    detailId: null,
    detailTask: null,
    toast: null
  })
  ;(window as unknown as { api: unknown }).api = {
    tasks: { query, get }
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  useAppStore.setState({ searchOpen: false, searchSeed: '', detailId: null, detailTask: null })
})

async function search(input: HTMLInputElement, term: string): Promise<void> {
  fireEvent.change(input, { target: { value: term } })
  await waitFor(() => expect(query).toHaveBeenCalledWith({ view: 'search', q: term }))
  await screen.findByText('交周报')
}

describe('搜索最近关键词', () => {
  it('选中搜索结果后记录关键词，重新打开可一键复用', async () => {
    render(createElement(SearchOverlay))
    const input = screen.getByLabelText('搜索关键词') as HTMLInputElement
    await search(input, '周报')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['周报'])
    expect(useAppStore.getState().searchOpen).toBe(false)
    expect(useAppStore.getState().detailId).toBe('task-1')

    cleanup()
    useAppStore.setState({ searchSeed: '', searchOpen: true })
    render(createElement(SearchOverlay))

    expect(screen.getByText('最近搜索')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /周报/ }))
    expect((screen.getByLabelText('搜索关键词') as HTMLInputElement).value).toBe('周报')
  })

  it('重复使用同一个关键词不会重复记录', async () => {
    render(createElement(SearchOverlay))
    const input = screen.getByLabelText('搜索关键词') as HTMLInputElement
    await search(input, '周报')
    fireEvent.keyDown(input, { key: 'Enter' })

    cleanup()
    useAppStore.setState({ searchSeed: '', searchOpen: true })
    render(createElement(SearchOverlay))
    fireEvent.click(screen.getByRole('button', { name: /周报/ }))

    const reopened = screen.getByLabelText('搜索关键词') as HTMLInputElement
    await screen.findByText('交周报')
    fireEvent.keyDown(reopened, { key: 'Enter' })

    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['周报'])
  })

  it('可以清除最近搜索，记录同时从本地存储移除', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['周报', '浇水']))
    render(createElement(SearchOverlay))

    expect(screen.getByText('最近搜索')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /浇水/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清除' }))

    expect(localStorage.getItem(RECENT_KEY)).toBeNull()
    expect(screen.queryByText('最近搜索')).toBeNull()
    expect(screen.queryByRole('button', { name: /浇水/ })).toBeNull()
  })

  it('输入关键词后隐藏最近搜索，清空输入后恢复', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['周报']))
    render(createElement(SearchOverlay))
    const input = screen.getByLabelText('搜索关键词') as HTMLInputElement

    await search(input, '周报')
    expect(screen.queryByText('最近搜索')).toBeNull()

    await act(async () => {
      fireEvent.change(input, { target: { value: '' } })
    })
    await waitFor(() => expect(screen.getByText('最近搜索')).toBeInTheDocument())
  })
})
