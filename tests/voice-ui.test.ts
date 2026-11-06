import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from '../src/renderer/src/components/QuickAdd'
import { useAppStore } from '../src/renderer/src/store/useAppStore'
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS } from '../src/shared/ai'
import type { ListWithCount, Settings } from '../src/shared/types'
import {
  VOICE_AI_BUSY_HINT,
  VOICE_APPENDED_HINT,
  VOICE_ASR_NOT_READY_HINT,
  VOICE_BUSY_CHECKING_HINT,
  VOICE_BUSY_RECORDING_HINT,
  VOICE_BUSY_TRANSCRIBING_HINT,
  VOICE_DRAFT_OPEN_HINT,
  VOICE_PERMISSION_TIMEOUT_HINT,
  VOICE_START_CANCELED_HINT,
  VOICE_TOO_SHORT_HINT,
  VOICE_UNSUPPORTED_HINT
} from '../src/shared/voice'

// 把 90 秒的转写超时与 15 秒的授权等待都缩短到 40ms，测试不用真的等。
vi.mock('@shared/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/voice')>()
  return {
    ...actual,
    VOICE_TRANSCRIBE_TIMEOUT_MS: 40,
    VOICE_PERMISSION_TIMEOUT_MS: 40
  }
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
      asrStatus: vi.fn(async () => ({
        ready: true,
        python: 'python',
        model: 'model',
        script: 'script',
        message: '离线语音识别可用'
      }))
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

function makeDeferredMedia(): {
  pending: { promise: Promise<MediaStream>; resolve: (value: MediaStream) => void }
  stream: MediaStream
  track: FakeTrack
} {
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
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track]
  } as unknown as MediaStream
  const pending = deferred<MediaStream>()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => pending.promise) }
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  return { pending, stream, track }
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

  it('麦克风权限被拒绝时给出可读提示，且不提供无意义的重试', async () => {
    setupMedia({
      reject: Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    })
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    await waitFor(() => expect(toastMessage()).toContain('麦克风权限被拒绝'))
    expect(useAppStore.getState().toast?.action).toBeUndefined()
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('等待授权时按钮显示可取消状态，取消后迟到的麦克风流会被停掉', async () => {
    const { pending, stream, track } = makeDeferredMedia()
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    expect(await screen.findByLabelText('取消获取麦克风权限')).toBeInTheDocument()
    expect(screen.getByText('授权中')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('取消获取麦克风权限'))

    expect(toastMessage()).toContain(VOICE_START_CANCELED_HINT)
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()

    pending.resolve(stream)
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('授权等待超时后恢复按钮并给重试入口，迟到的麦克风流会被停掉', async () => {
    const { pending, stream, track } = makeDeferredMedia()
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    await waitFor(() => expect(toastMessage()).toContain(VOICE_PERMISSION_TIMEOUT_HINT), {
      timeout: 2000
    })
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()

    pending.resolve(stream)
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('授权等待期间卸载，迟到的麦克风流会被停掉', async () => {
    const { pending, stream, track } = makeDeferredMedia()
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))
    await screen.findByLabelText('取消获取麦克风权限')
    cleanup()

    pending.resolve(stream)
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
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
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    expect(input.value).toBe('买牛奶')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('识别失败后点重试会复用同一段录音，成功时追加文字', async () => {
    setupMedia()
    transcribe
      .mockResolvedValueOnce({ error: '转写失败，请重试' })
      .mockResolvedValueOnce({ text: '下午三点交周报' })
    const input = mount()

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastMessage()).toContain('转写失败'))

    await act(async () => {
      await useAppStore.getState().toast?.action?.()
    })

    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(input.value).toBe('下午三点交周报'))
    expect(transcribe.mock.calls[0][1]).not.toBe(transcribe.mock.calls[1][1])
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

  it('识别成功后提示可撤销，撤销会恢复追加前的输入', async () => {
    setupMedia()
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(input.value).toBe('买牛奶 明天下午三点提醒我浇花'))
    expect(toastMessage()).toContain(VOICE_APPENDED_HINT)
    const toast = useAppStore.getState().toast
    expect(toast?.actionLabel).toBe('撤销')

    await act(async () => {
      await toast?.action?.()
    })
    expect(input.value).toBe('买牛奶')
    expect(toastMessage()).toContain('已撤销语音文字')
  })

  it('撤销前输入已被改动时不动输入，并说明未撤销', async () => {
    setupMedia()
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))
    await waitFor(() => expect(input.value).toBe('买牛奶 明天下午三点提醒我浇花'))

    const toast = useAppStore.getState().toast
    fireEvent.change(input, { target: { value: '买牛奶 明天下午三点提醒我浇花 晚上买菜' } })
    await act(async () => {
      await toast?.action?.()
    })
    expect(input.value).toBe('买牛奶 明天下午三点提醒我浇花 晚上买菜')
    expect(toastMessage()).toContain('输入已变化')
  })

  it('录音中按 Enter 不会把半截输入当成任务创建', async () => {
    setupMedia()
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(toastMessage()).toContain(VOICE_BUSY_RECORDING_HINT)
    expect(window.api.tasks.create).not.toHaveBeenCalled()
    expect(input.value).toBe('买牛奶')
    expect(screen.getByLabelText('停止录音')).toBeInTheDocument()
  })

  it('识别中按 Enter 会提示等待，而不是拿旧输入建任务', async () => {
    setupMedia()
    const pending = deferred<{ text?: string; error?: string }>()
    transcribe.mockReturnValue(pending.promise)
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))
    await screen.findByLabelText('取消语音识别')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(toastMessage()).toContain(VOICE_BUSY_TRANSCRIBING_HINT)
    expect(window.api.tasks.create).not.toHaveBeenCalled()
    expect(input.value).toBe('买牛奶')

    pending.resolve({ text: '' })
    await waitFor(() => expect(screen.getByLabelText('语音输入')).toBeInTheDocument())
  })

  it('AI 草稿未处理时点麦克风会提示先处理草稿', async () => {
    const { getUserMedia } = setupMedia()
    ;(window.api.ai.parseQuickAdd as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      source: 'ai',
      warning: null,
      attempts: 1,
      result: {
        title: '交周报',
        priority: 2,
        tags: [],
        listName: null,
        dueDate: '2026-11-06',
        dueTime: '15:00',
        allDay: false,
        recurrence: null,
        reminderOffsetMin: null
      }
    })
    const input = mount()
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))
    await screen.findByLabelText('AI 任务标题')

    fireEvent.click(screen.getByLabelText('语音输入'))

    expect(toastMessage()).toContain(VOICE_DRAFT_OPEN_HINT)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('AI 解析进行中不允许同时开启录音', async () => {
    const { getUserMedia } = setupMedia()
    ;(window.api.ai.parseQuickAdd as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {
        // 永远不返回：只验证解析期间麦克风入口被拦住。
      })
    )
    const input = mount()
    fireEvent.change(input, { target: { value: '明天下午3点交周报' } })
    fireEvent.click(screen.getByLabelText('AI 解析并添加'))

    fireEvent.click(screen.getByLabelText('语音输入'))

    expect(toastMessage()).toContain(VOICE_AI_BUSY_HINT)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('录音前发现离线环境缺失时直接提示，不申请麦克风', async () => {
    const { getUserMedia } = setupMedia()
    ;(window.api.ai.asrStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      ready: false,
      python: null,
      model: null,
      script: 'asr_transcribe.py',
      message: '没有找到 Python 运行时，请在设置里填写 Python 路径'
    })
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))

    await waitFor(() => expect(toastMessage()).toContain(VOICE_ASR_NOT_READY_HINT))
    expect(toastMessage()).toContain('Python')
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('环境缺失提示里的重试会重新自检，环境恢复后正常录音', async () => {
    const { getUserMedia } = setupMedia()
    const asrStatus = window.api.ai.asrStatus as ReturnType<typeof vi.fn>
    asrStatus
      .mockResolvedValueOnce({
        ready: false,
        python: null,
        model: null,
        script: 'asr_transcribe.py',
        message: '没有找到 vosk 模型目录，请在设置里填写模型路径'
      })
      .mockResolvedValueOnce({
        ready: true,
        python: 'python',
        model: 'model',
        script: 'asr_transcribe.py',
        message: '离线语音识别可用'
      })
    mount()

    fireEvent.click(screen.getByLabelText('语音输入'))
    await waitFor(() => expect(toastMessage()).toContain(VOICE_ASR_NOT_READY_HINT))
    expect(getUserMedia).not.toHaveBeenCalled()

    await act(async () => {
      await useAppStore.getState().toast?.action?.()
    })

    await waitFor(() => expect(screen.getByLabelText('停止录音')).toBeInTheDocument())
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(asrStatus).toHaveBeenCalledTimes(2)
  })

  it('环境自检接口异常时放行录音，不把语音入口整体禁用', async () => {
    const { getUserMedia } = setupMedia()
    ;(window.api.ai.asrStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ipc unavailable')
    )
    mount()

    await startRecording()

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(toastMessage()).not.toContain(VOICE_ASR_NOT_READY_HINT)
  })

  it('检查环境期间显示检查中，可取消且 Enter 不会建任务', async () => {
    setupMedia()
    const pending = deferred<{
      ready: boolean
      python: string | null
      model: string | null
      script: string
      message: string
    }>()
    ;(window.api.ai.asrStatus as ReturnType<typeof vi.fn>).mockReturnValue(pending.promise)
    const input = mount()
    fireEvent.change(input, { target: { value: '买牛奶' } })

    fireEvent.click(screen.getByLabelText('语音输入'))

    expect(await screen.findByLabelText('取消语音环境检查')).toBeInTheDocument()
    expect(screen.getByText('检查中')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(toastMessage()).toContain(VOICE_BUSY_CHECKING_HINT)
    expect(window.api.tasks.create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('取消语音环境检查'))
    expect(toastMessage()).toContain(VOICE_START_CANCELED_HINT)
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()

    pending.resolve({
      ready: true,
      python: 'python',
      model: 'model',
      script: 'asr_transcribe.py',
      message: '离线语音识别可用'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('转写 IPC 失败时提示识别失败并可重试，不说成麦克风问题', async () => {
    setupMedia()
    transcribe.mockRejectedValue(
      new Error("Error invoking remote method 'ai:transcribe': Error: ffmpeg crashed")
    )
    const input = mount()

    await startRecording()
    now += 1200
    fireEvent.click(screen.getByLabelText('停止录音'))

    await waitFor(() => expect(toastMessage()).toContain('语音识别失败'))
    expect(toastMessage()).toContain('ffmpeg crashed')
    expect(toastMessage()).not.toContain('打不开麦克风')
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    expect(input.value).toBe('')
    expect(screen.getByLabelText('语音输入')).toBeInTheDocument()
  })

  it('录音器报错后恢复按钮并给重试入口', async () => {
    const { getUserMedia } = setupMedia()
    mount()

    await startRecording()
    act(() => {
      FakeMediaRecorder.instances[0]!.emitError('设备错误')
    })

    await waitFor(() => expect(toastMessage()).toContain('录音中断'))
    expect(toastMessage()).toContain('设备错误')
    expect(useAppStore.getState().toast?.actionLabel).toBe('重试')
    await waitFor(() => expect(screen.getByLabelText('语音输入')).toBeInTheDocument())

    await act(async () => {
      await useAppStore.getState().toast?.action?.()
    })

    await waitFor(() => expect(screen.getByLabelText('停止录音')).toBeInTheDocument())
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(FakeMediaRecorder.instances).toHaveLength(2)
  })
})
