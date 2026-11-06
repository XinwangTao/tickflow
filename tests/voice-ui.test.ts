import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from '../src/renderer/src/components/QuickAdd'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS } from '../src/shared/ai'
import type { ListWithCount, Settings } from '../src/shared/types'
import {
  VOICE_TOO_SHORT_HINT,
  VOICE_UNSUPPORTED_HINT
} from '../src/shared/voice'

// 把 75 秒的转写超时缩短到 40ms，测试不用真的等一分多钟。
vi.mock('@shared/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/voice')>()
  return { ...actual, VOICE_TRANSCRIBE_TIMEOUT_MS: 40 }
})

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
  aiTimeoutMs: AI_DEFAULT_TIMEOUT_MS,
  asrPython: '',
  asrModel: ''
}

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  fireEnded: () => void
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus')

  state: 'inactive' | 'recording' = 'inactive'
  mimeType = ''
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(
    public stream: unknown,
    options?: { mimeType?: string }
  ) {
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }

  start = vi.fn((_timeslice?: number) => {
    this.state = 'recording'
  })

  stop = vi.fn(() => {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({
      data: new Blob(['audio-bytes'], { type: this.mimeType || 'audio/webm' })
    })
    this.onstop?.()
  })

  emitError(message: string): void {
    const event = Object.assign(new Event('error'), { error: new Error(message) })
    this.onerror?.(event)
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const transcribe = vi.fn()
const cancel = vi.fn(async () => true)

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    ai: {
      transcribe,
      cancel,
      parseQuickAdd: vi.fn(),
      breakdownSubtasks: vi.fn(),
      dailySummary: vi.fn(),
      models: vi.fn(),
      test: vi.fn(),
      asrStatus: vi.fn()
    },
    tasks: {
      create: vi.fn(),
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
}

function setupMedia(options: { reject?: Error } = {}): {
  getUserMedia: ReturnType<typeof vi.fn>
  tracks: FakeTrack[]
} {
  const tracks: FakeTrack[] = []
  const getUserMedia = vi.fn(async () => {
    if (options.reject) throw options.reject
    const listeners: Array<() => void> = []
    const track: FakeTrack = {
      stop: vi.fn(),
      addEventListener: vi.fn((event: string, callback: () => void) => {
        if (event === 'ended') listeners.push(callback)
      }),
      fireEnded: () => {
        for (const callback of listeners) callback()
      }
    }
    tracks.push(track)
    return {
      getTracks: () => tracks,
      getAudioTracks: () => tracks
    }
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  return { getUserMedia, tracks }
}

function mount(): HTMLInputElement {
  render(createElement(QuickAdd, { defaultListId: 'inbox' }))
  return screen.getByLabelText('快速添加任务') as HTMLInputElement
}

async function startRecording(): Promise<void> {
  fireEvent.click(screen.getByLabelText('语音输入'))
  await waitFor(() => expect(screen.getByLabelText('停止录音')).toBeInTheDocument())
}

function toastMessage(): string {
  return useAppStore.getState().toast?.message ?? ''
}

describe('快速添加栏语音输入', () => {
  let now = 1_700_000_000_000

  beforeEach(() => {
    vi.clearAllMocks()
    FakeMediaRecorder.instances = []
    transcribe.mockResolvedValue({ text: '明天下午三点提醒我浇花' })
    cancel.mockResolvedValue(true)
    now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    useAppStore.setState({ lists: LISTS, settings: SETTINGS, tasks: [], toast: null })
    installApi()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined
    })
    useAppStore.setState({ tasks: [], toast: null })
  })

  it('识别成功后把文字追加到已有输入，并恢复麦克风按钮', async () => {
    setupMedia()
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(input.value).toBe('买牛奶 明天下午三点提醒我浇花'))
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
    expect(transcribe.mock.calls[0][1]).toMatch(/^voice-\d+$/)
  })

  it('麦克风权限被拒绝时给出可读提示，不调用识别', async () => {
    setupMedia({
      reject: Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    })
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    await waitFor(() => expect(toastMessage()).toContain('麦克风权限被拒绝'))
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('录音太短时直接丢弃，不浪费一次转写', async () => {
    setupMedia()
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(toastMessage()).toContain(VOICE_TOO_SHORT_HINT))
    expect(transcribe).not.toHaveBeenCalled()
    expect(input.value).toBe('买牛奶')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('识别失败时提示原因且不改写输入', async () => {
    setupMedia()
    transcribe.mockResolvedValue({ error: '没有找到离线语音识别环境（vosk 模型与运行时）' })
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() =>
      expect(toastMessage()).toContain('没有找到离线语音识别环境')
    )
    expect(input.value).toBe('买牛奶')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('识别中可取消，迟到的结果不会覆盖输入', async () => {
    setupMedia()
    const pending = deferred<{ text?: string; error?: string }>()
    transcribe.mockReturnValue(pending.promise)
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    const cancelButton = await screen.findByLabelText('取消语音识别')
    fireEvent.click(cancelButton)

    const requestId = transcribe.mock.calls[0][1] as string
    expect(requestId).toMatch(/^voice-\d+$/)
    expect(cancel).toHaveBeenCalledWith(requestId)
    expect(toastMessage()).toContain('已取消语音识别')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()

    pending.resolve({ text: '迟到的识别结果' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.value).toBe('买牛奶')
  })

  it('识别超时会中止请求、给出重试入口并恢复按钮', async () => {
    setupMedia()
    const pending = deferred<{ text?: string; error?: string }>()
    transcribe.mockReturnValue(pending.promise)
    const input = mount()

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1), { timeout: 2000 })
    await waitFor(() => expect(toastMessage()).toContain('语音识别超时'))
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('环境不支持录音时提示改用键盘输入', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined
    })
    vi.stubGlobal('MediaRecorder', undefined)
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    await waitFor(() => expect(toastMessage()).toContain(VOICE_UNSUPPORTED_HINT))
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('麦克风连接中断时丢弃本次录音', async () => {
    const { tracks } = setupMedia()
    mount()

    await startRecording()
    now += 1200
    act(() => {
      tracks[0]!.fireEnded()
    })

    await waitFor(() => expect(toastMessage()).toContain('麦克风连接中断'))
    expect(transcribe).not.toHaveBeenCalled()
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('录音中卸载会停止麦克风，也不会发起转写', async () => {
    const { tracks } = setupMedia()
    mount()

    await startRecording()
    cleanup()

    expect(tracks[0]!.stop).toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
  })
})
