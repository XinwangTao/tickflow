import { useEffect, useMemo, useRef, useState } from 'react'
import {
  describeReminderOffset,
  parseQuickAdd,
  REMINDER_OFFSET_CHOICES,
  reminderTriggerAt,
  type QuickAddResult
} from '@shared/quick-add'
import {
  createQuickAddDraft,
  draftToQuickAddResult,
  type QuickAddDraft
} from '@shared/quick-add-draft'
import {
  appendTranscript,
  micErrorMessage,
  micErrorRetryable,
  pickRecorderMime,
  recordingTooShort,
  VOICE_CANCELED_HINT,
  VOICE_EMPTY_HINT,
  VOICE_MAX_AUDIO_BYTES,
  VOICE_MAX_RECORD_MS,
  VOICE_MAX_REACHED_HINT,
  VOICE_PERMISSION_TIMEOUT_HINT,
  VOICE_PERMISSION_TIMEOUT_MS,
  VOICE_START_CANCELED_HINT,
  VOICE_TIMEOUT_HINT,
  VOICE_TOO_SHORT_HINT,
  VOICE_TRANSCRIBE_TIMEOUT_MS,
  VOICE_UNSUPPORTED_HINT,
  voiceElapsedSeconds
} from '@shared/voice'
import type { Priority, TaskWithMeta } from '@shared/types'
import { describeRecurrence, formatDueLabel } from '../lib/format'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../lib/colors'
import { useAppStore } from '../store/useAppStore'
import { Icon } from './Icon'

interface QuickAddProps {
  defaultListId: string
  defaultDueDate?: string | null
}

const RECURRENCE_CHOICES = [
  { value: '', label: '不重复' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每周' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '工作日' },
  { value: 'FREQ=MONTHLY', label: '每月' },
  { value: 'FREQ=YEARLY', label: '每年' }
]

function normalizedListName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

export function QuickAdd({ defaultListId, defaultDueDate = null }: QuickAddProps): React.ReactNode {
  const lists = useAppStore((state) => state.lists)
  const settings = useAppStore((state) => state.settings)
  const createTask = useAppStore((state) => state.createTask)
  const refresh = useAppStore((state) => state.refresh)
  const showToast = useAppStore((state) => state.showToast)
  const focusToken = useAppStore((state) => state.quickAddFocus)

  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiElapsed, setAiElapsed] = useState(0)
  const [draftBusy, setDraftBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState<QuickAddDraft | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  // 已点击麦克风、正在等 getUserMedia（系统授权弹窗 / 设备启动）时也要有状态：
  // 否则按钮看起来毫无反应，用户会连点，进而申请出多条并行录音流。
  const [starting, setStarting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeSeconds, setTranscribeSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  // 录音开始时刻用于判断误触（太短）与 60 秒上限；卸载/取消时置 discard 丢弃 onstop 的结果。
  const recordingStartedAt = useRef(0)
  const discardRecording = useRef(false)
  const voiceRequestSeq = useRef(0)
  // getUserMedia 无法真正中止：用自增 token 忽略迟到的流，并主动停掉它的 track。
  const micStartSeq = useRef(0)
  const micStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onstop 在组件卸载后也可能被调用；只有卸载时才跳过 state 更新，
  // 正常取消（太短/麦克风中断）仍要把按钮恢复成「语音输入」。
  const unmounted = useRef(false)
  const activeTranscribe = useRef<{
    id: string
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 进行中的 AI 请求：id 用于取消，text 用于判断响应是否已经过期。
  const aiRequestSeq = useRef(0)
  const activeAiRequest = useRef<{ id: string; text: string } | null>(null)
  const valueRef = useRef('')

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus()
  }, [focusToken])

  // 切换视图导致组件卸载时中止进行中的解析：草稿本来也留不下来，不应继续消耗 token。
  useEffect(() => {
    return () => {
      const active = activeAiRequest.current
      if (!active) return
      activeAiRequest.current = null
      try {
        void window.api.ai.cancel(active.id).catch(() => undefined)
      } catch {
        // 旧 preload 或测试桩没有 cancel 时忽略，不影响卸载。
      }
    }
  }, [])

  // 卸载时停止麦克风并中止转写：onstop 会看到 discard 标记，不会在组件消失后写 state。
  useEffect(() => {
    return () => {
      unmounted.current = true
      discardRecording.current = true
      // 组件已经卸载：迟到的 getUserMedia 结果必须自己停掉，否则麦克风会一直亮着。
      micStartSeq.current += 1
      if (micStartTimer.current) {
        clearTimeout(micStartTimer.current)
        micStartTimer.current = null
      }
      const recorder = recorderRef.current
      recorderRef.current = null
      try {
        recorder?.stop()
      } catch {
        // 已经停止。
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      const active = activeTranscribe.current
      if (!active) return
      activeTranscribe.current = null
      clearTimeout(active.timer)
      try {
        void window.api.ai.cancel(active.id).catch(() => undefined)
      } catch {
        // 旧 preload 或测试桩没有 cancel 时忽略。
      }
    }
  }, [])

  // 请求期间显示已等待秒数：超时前用户能看到进度，不会以为界面卡住。
  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0)
      return
    }
    const timer = setInterval(() => setAiElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [aiBusy])

  // 录音计时：每 500ms 刷新一次，按钮上能看到已录时长。
  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0)
      return
    }
    const started = recordingStartedAt.current || Date.now()
    const tick = (): void =>
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [recording])

  // 到达上限自动停止并进入识别，避免无限录音占内存。
  useEffect(() => {
    if (!recording) return
    const elapsed = Date.now() - recordingStartedAt.current
    const timer = setTimeout(() => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') return
      showToast(VOICE_MAX_REACHED_HINT, 'info')
      try {
        recorder.stop()
      } catch {
        // 已经停止。
      }
    }, Math.max(0, VOICE_MAX_RECORD_MS - elapsed))
    return () => clearTimeout(timer)
  }, [recording, showToast])

  // 转写等待秒数：和 AI 解析一致，超时前能看到进度并随时取消。
  useEffect(() => {
    if (!transcribing) {
      setTranscribeSeconds(0)
      return
    }
    const started = Date.now()
    const timer = setInterval(
      () => setTranscribeSeconds(voiceElapsedSeconds(Date.now() - started)),
      1000
    )
    return () => clearInterval(timer)
  }, [transcribing])

  const aiTimeoutSeconds = Math.max(1, Math.round((settings.aiTimeoutMs || 15000) / 1000))

  const parsed = useMemo(() => parseQuickAdd(value), [value])
  const hasMeta =
    Boolean(parsed.dueDate) ||
    parsed.priority > 0 ||
    parsed.tags.length > 0 ||
    Boolean(parsed.listName) ||
    Boolean(parsed.recurrence) ||
    parsed.reminderOffsetMin != null

  const resolveList = (name: string | null): (typeof lists)[number] | undefined => {
    if (!name) return undefined
    const lowered = normalizedListName(name)
    return lists.find((list) => normalizedListName(list.name) === lowered)
  }

  /**
   * AI 创建成功后可撤销：直接移除刚创建的任务（进入垃圾箱，可再从垃圾箱恢复），
   * 不弹出额外 toast，避免把「已删除」覆盖在「已添加」上。
   */
  const notifyAdded = (
    created: TaskWithMeta,
    message: string,
    kind: 'success' | 'info' = 'success',
    duration = 6000
  ): void => {
    showToast(message, kind, {
      actionLabel: '撤销',
      duration,
      action: async () => {
        try {
          await window.api.tasks.remove(created.id)
          await refresh()
        } catch (error) {
          showToast(String(error), 'error')
        }
      }
    })
  }

  /**
   * 提前提醒落到 reminders 表。提醒时间已过或任务没有截止日期时不硬建一条永不触发的记录，
   * 而是把原因回传给调用方，拼进“已添加”提示里。
   */
  const scheduleReminder = async (
    task: TaskWithMeta,
    result: QuickAddResult
  ): Promise<string | null> => {
    if (result.reminderOffsetMin == null) return null
    const triggerAt = reminderTriggerAt(result)
    if (!triggerAt) return '未设置截止日期，提醒未创建'
    if (new Date(triggerAt).getTime() <= Date.now()) return '提醒时间已过，提醒未创建'
    try {
      await window.api.reminders?.create(task.id, triggerAt)
      return null
    } catch (error) {
      return `提醒创建失败：${String(error)}`
    }
  }

  const createFromResult = async (
    result: QuickAddResult,
    options: { listId?: string | null; applyDefaultDueDate?: boolean } = {}
  ): Promise<{ task: TaskWithMeta; reminderNote: string | null } | null> => {
    const matched = options.listId
      ? lists.find((list) => list.id === options.listId)
      : resolveList(result.listName)
    const fallback =
      lists.find((list) => list.id === defaultListId) ??
      lists.find((list) => list.isInbox) ??
      lists[0]

    const target = matched ?? fallback
    if (!target) {
      showToast('没有可用清单，请先创建一个清单', 'error')
      return null
    }
    if (result.listName && !matched) {
      showToast(`未找到清单「${result.listName}」，已放入「${target.name}」`, 'info')
    }

    const dueDate =
      options.applyDefaultDueDate === false
        ? result.dueDate
        : (result.dueDate ?? defaultDueDate ?? null)

    const task = await createTask({
      listId: target.id,
      title: result.title,
      priority: result.priority,
      dueDate,
      dueTime: result.dueTime,
      allDay: result.allDay,
      recurrence: result.recurrence,
      tagNames: result.tags
    })
    if (!task) return null
    const reminderNote = await scheduleReminder(task, { ...result, dueDate })
    return { task, reminderNote }
  }

  const submit = async (useAi: boolean): Promise<void> => {
    const text = value.trim()
    if (!text) return
    if (aiBusy) {
      // 进行中时普通 Enter 不再静默失败，明确告诉用户可以中止这次解析。
      showToast('AI 正在解析，按 Esc 或点「取消」可中止', 'info')
      return
    }
    if (aiDraft) {
      if (!useAi) {
        showToast('请先添加或取消上方的 AI 解析结果', 'info')
        return
      }
      // 再点一次 AI 视为重新解析当前输入。
      setAiDraft(null)
    }

    let result: QuickAddResult
    let aiWarning: string | null = null
    let aiUsed = false
    if (useAi && settings.aiEnabled) {
      aiUsed = true
      const requestId = `quick-add-${(aiRequestSeq.current += 1)}`
      activeAiRequest.current = { id: requestId, text }
      setAiBusy(true)
      try {
        const response = await window.api.ai.parseQuickAdd(text, requestId)
        // 已取消或已被新请求取代：迟到的结果一律丢弃，绝不落到草稿区。
        if (activeAiRequest.current?.id !== requestId) return
        if (valueRef.current.trim() !== text) {
          showToast('输入已变化，已忽略上一次 AI 解析结果', 'info')
          return
        }
        if (response.ok && response.source === 'ai') {
          // AI 成功时先进入草稿，不立即写库：用户可以改标题、时间、清单后再添加。
          const draft = createQuickAddDraft(
            response.result,
            lists,
            defaultListId,
            defaultDueDate
          )
          setAiDraft(draft)
          const wanted = response.result.listName
          if (wanted && !resolveList(wanted)) {
            const fallback = lists.find((list) => list.id === draft.listId)
            showToast(
              `未找到清单「${wanted}」，已选择「${fallback?.name ?? '当前清单'}」`,
              'info'
            )
          }
          return
        }
        result = response.result
        aiWarning = response.warning
      } catch (error) {
        if (activeAiRequest.current?.id !== requestId) return
        result = parseQuickAdd(text)
        aiWarning = String(error)
      } finally {
        if (activeAiRequest.current?.id === requestId) {
          activeAiRequest.current = null
          setAiBusy(false)
        }
      }
    } else {
      result = parseQuickAdd(text)
    }

    const created = await createFromResult(result)
    if (!created) return
    setValue('')
    inputRef.current?.focus()
    const reminderSuffix = created.reminderNote ? `（${created.reminderNote}）` : ''
    if (aiUsed) {
      notifyAdded(
        created.task,
        aiWarning
          ? `AI 未能解析，已按规则添加「${created.task.title}」：${aiWarning}${reminderSuffix}`
          : `AI 已添加「${created.task.title}」${reminderSuffix}`,
        aiWarning ? 'info' : 'success',
        aiWarning ? 7000 : 6000
      )
    } else if (created.reminderNote) {
      showToast(`已添加「${created.task.title}」${reminderSuffix}`, 'info')
    }
  }

  /** 取消进行中的 AI 解析：先让 main 中止 fetch，再丢弃响应，输入内容保持不变。 */
  const cancelAiParse = (): void => {
    const active = activeAiRequest.current
    if (!active) return
    activeAiRequest.current = null
    setAiBusy(false)
    setAiElapsed(0)
    void window.api.ai.cancel(active.id).catch(() => undefined)
    showToast('已取消 AI 解析，输入内容已保留', 'info')
    inputRef.current?.focus()
  }

  const updateDraft = (patch: Partial<QuickAddDraft>): void => {
    setAiDraft((draft) => (draft ? { ...draft, ...patch } : draft))
  }

  const cancelDraft = (): void => {
    setAiDraft(null)
    inputRef.current?.focus()
  }

  const confirmDraft = async (): Promise<void> => {
    if (!aiDraft || aiBusy || draftBusy) return
    const result = draftToQuickAddResult(aiDraft, lists)
    if (!result) {
      showToast('任务标题不能为空', 'error')
      return
    }
    setDraftBusy(true)
    try {
      const created = await createFromResult(result, {
        listId: aiDraft.listId,
        // 用户可能主动清空了日期，不能在确认时又被默认截止日期补回来。
        applyDefaultDueDate: false
      })
      if (!created) return
      setAiDraft(null)
      setValue('')
      inputRef.current?.focus()
      const reminderSuffix = created.reminderNote ? `（${created.reminderNote}）` : ''
      notifyAdded(
        created.task,
        `AI 已添加「${created.task.title}」${reminderSuffix}`,
        'success'
      )
    } finally {
      setDraftBusy(false)
    }
  }

  const recurrenceChoices = RECURRENCE_CHOICES.slice()
  if (
    aiDraft?.recurrence &&
    !recurrenceChoices.some((choice) => choice.value === aiDraft.recurrence)
  ) {
    recurrenceChoices.push({
      value: aiDraft.recurrence,
      label: describeRecurrence(aiDraft.recurrence)
    })
  }

  const reminderChoices = REMINDER_OFFSET_CHOICES.slice()
  if (
    aiDraft?.reminderOffsetMin != null &&
    !reminderChoices.some((choice) => choice.value === aiDraft.reminderOffsetMin)
  ) {
    reminderChoices.push({
      value: aiDraft.reminderOffsetMin,
      label: describeReminderOffset(aiDraft.reminderOffsetMin)
    })
  }


  // 语音输入走本机离线识别（vosk）：录完把文字追加进输入框，
  // 剩下的日期/重复解析仍由原来的规则 + AI 流程负责。
  const stopStream = (): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const cancelTranscription = (): void => {
    const active = activeTranscribe.current
    if (!active) return
    activeTranscribe.current = null
    clearTimeout(active.timer)
    setTranscribing(false)
    setTranscribeSeconds(0)
    try {
      void window.api.ai.cancel(active.id).catch(() => undefined)
    } catch {
      // 旧 preload 或测试桩没有 cancel 时忽略。
    }
    showToast(VOICE_CANCELED_HINT, 'info')
    inputRef.current?.focus()
  }

  const transcribeChunks = async (chunks: Blob[]): Promise<void> => {
    // 同一时刻只允许一次转写：失败 toast 上的「重试」被连点时不会并行启动两次识别。
    if (activeTranscribe.current) return
    const requestId = `voice-${(voiceRequestSeq.current += 1)}`
    const retry = (): void => void transcribeChunks(chunks)
    const timer = setTimeout(() => {
      if (activeTranscribe.current?.id !== requestId) return
      activeTranscribe.current = null
      setTranscribing(false)
      setTranscribeSeconds(0)
      try {
        void window.api.ai.cancel(requestId).catch(() => undefined)
      } catch {
        // 忽略旧 preload。
      }
      showToast(VOICE_TIMEOUT_HINT, 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: retry
      })
    }, VOICE_TRANSCRIBE_TIMEOUT_MS)
    activeTranscribe.current = { id: requestId, timer }
    setTranscribing(true)
    setTranscribeSeconds(0)
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })
      const result = await window.api.ai.transcribe(await blob.arrayBuffer(), requestId)
      // 取消或超时后迟到的结果一律丢弃，不覆盖用户已经改过的输入。
      if (activeTranscribe.current?.id !== requestId) return
      const text = (result?.text || '').trim()
      if (text) {
        setValue((prev) => appendTranscript(prev, text))
        inputRef.current?.focus()
        return
      }
      // 没听清/识别失败时保留录音，toast 上的「重试」复用这段音频，不用重新录。
      showToast(result?.error || '没听清，再说一次？', 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: retry
      })
    } catch (error) {
      if (activeTranscribe.current?.id !== requestId) return
      showToast(micErrorMessage(error), 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: retry
      })
    } finally {
      if (activeTranscribe.current?.id === requestId) {
        clearTimeout(timer)
        activeTranscribe.current = null
        setTranscribing(false)
        setTranscribeSeconds(0)
      }
    }
  }

  const finishRecording = async (): Promise<void> => {
    const chunks = chunksRef.current
    chunksRef.current = []
    recorderRef.current = null
    const startedAt = recordingStartedAt.current
    recordingStartedAt.current = 0
    stopStream()
    const discarded = discardRecording.current
    discardRecording.current = false
    if (!unmounted.current) {
      setRecording(false)
      setRecordingSeconds(0)
    }
    // 取消/卸载导致的停止不再继续转写；卸载时也跳过 state 更新。
    if (discarded) return
    if (!chunks.length) {
      showToast(VOICE_EMPTY_HINT, 'error')
      return
    }
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    if (bytes > VOICE_MAX_AUDIO_BYTES) {
      showToast('录音文件过大，请缩短到 60 秒以内', 'error')
      return
    }
    if (recordingTooShort(startedAt > 0 ? Date.now() - startedAt : 0)) {
      showToast(VOICE_TOO_SHORT_HINT, 'info')
      return
    }
    await transcribeChunks(chunks)
  }

  const stopRecorder = (discard: boolean): void => {
    if (discard) discardRecording.current = true
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      recorderRef.current = null
      stopStream()
      setRecording(false)
      setRecordingSeconds(0)
      return
    }
    try {
      recorder.stop()
    } catch {
      recorderRef.current = null
      stopStream()
      setRecording(false)
      setRecordingSeconds(0)
    }
  }

  const clearMicStartTimer = (): void => {
    if (!micStartTimer.current) return
    clearTimeout(micStartTimer.current)
    micStartTimer.current = null
  }

  // 取消“等授权”：getUserMedia 本身无法中止，递增 token 让迟到的 stream 自己停掉。
  const cancelMicStart = (): void => {
    micStartSeq.current += 1
    clearMicStartTimer()
    setStarting(false)
    showToast(VOICE_START_CANCELED_HINT, 'info')
  }

  const toggleRecording = async (): Promise<void> => {
    if (starting) {
      cancelMicStart()
      return
    }
    if (transcribing) {
      cancelTranscription()
      return
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      const duration = Date.now() - recordingStartedAt.current
      // 误触时直接丢弃，不把半秒的空白音频送去转写。
      const tooShort = recordingTooShort(duration)
      if (tooShort) showToast(VOICE_TOO_SHORT_HINT, 'info')
      stopRecorder(tooShort)
      return
    }
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    if (!mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast(VOICE_UNSUPPORTED_HINT, 'error')
      return
    }
    const token = (micStartSeq.current += 1)
    setStarting(true)
    micStartTimer.current = setTimeout(() => {
      if (micStartSeq.current !== token) return
      micStartTimer.current = null
      micStartSeq.current += 1
      setStarting(false)
      showToast(VOICE_PERMISSION_TIMEOUT_HINT, 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: () => void toggleRecording()
      })
    }, VOICE_PERMISSION_TIMEOUT_MS)

    let stream: MediaStream
    try {
      stream = await mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      // 用户已经取消/超时/卸载：不再提示第二次。
      if (micStartSeq.current !== token) return
      clearMicStartTimer()
      setStarting(false)
      showToast(
        micErrorMessage(error),
        'error',
        micErrorRetryable(error)
          ? {
              duration: 7000,
              actionLabel: '重试',
              action: () => void toggleRecording()
            }
          : undefined
      )
      return
    }
    // 授权弹窗挂起期间用户点了取消或切走了视图：主动停掉这条迟到的流。
    if (micStartSeq.current !== token) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    clearMicStartTimer()
    setStarting(false)
    streamRef.current = stream
    try {
      for (const track of stream.getTracks()) {
        track.addEventListener?.('ended', () => {
          const recorder = recorderRef.current
          if (!recorder || recorder.state === 'inactive') return
          discardRecording.current = true
          showToast('麦克风连接中断，本次录音已丢弃', 'error')
          try {
            recorderRef.current?.stop()
          } catch {
            // 已经停止。
          }
        })
      }

      let recorder: MediaRecorder
      const mime = pickRecorderMime(
        (type) =>
          typeof MediaRecorder.isTypeSupported === 'function' &&
          MediaRecorder.isTypeSupported(type)
      )
      try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      } catch {
        // 个别实现只接受默认格式。
        recorder = new MediaRecorder(stream)
      }

      chunksRef.current = []
      discardRecording.current = false
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = (event: Event) => {
        if (discardRecording.current) return
        discardRecording.current = true
        const detail = (event as ErrorEvent).error?.message
        showToast(detail ? `录音中断：${detail}` : '录音中断，请重试', 'error')
        try {
          recorder.stop()
        } catch {
          // 已经停止。
        }
      }
      recorder.onstop = () => {
        void finishRecording()
      }
      recorderRef.current = recorder
      recordingStartedAt.current = Date.now()
      recorder.start(250)
      setRecording(true)
      setRecordingSeconds(0)
    } catch (error) {
      stopStream()
      setRecording(false)
      setRecordingSeconds(0)
      showToast(micErrorMessage(error), 'error')
    }
  }

  return (
    <section className={`quick-add ${focused ? 'focused' : ''}`}>
      <div className="quick-add-bar">
        <Icon name="plus" size={17} className="quick-add-icon" />
        <input
          ref={inputRef}
          className="quick-add-input"
          value={value}
          placeholder="添加任务，试试「明天下午3点 交周报 #工作 !高」"
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit(event.ctrlKey || event.metaKey)
            } else if (event.key === 'Escape' && aiBusy) {
              // Esc 直接中止这次解析，不用等满超时。
              event.preventDefault()
              cancelAiParse()
            }
          }}
          aria-label="快速添加任务"
        />
        <button
          type="button"
          className={`quick-add-mic ${recording ? 'recording' : ''} ${
            transcribing ? 'transcribing' : ''
          } ${starting ? 'starting' : ''}`}
          title={
            starting
              ? '正在等待麦克风权限，点击取消'
              : transcribing
                ? `取消语音识别（已等待 ${transcribeSeconds}s）`
                : recording
                  ? `停止录音并识别 · 最长 ${VOICE_MAX_RECORD_MS / 1000} 秒`
                  : '语音输入：点一下开始，说完再点一下结束'
          }
          aria-label={
            starting
              ? '取消获取麦克风权限'
              : transcribing
                ? '取消语音识别'
                : recording
                  ? '停止录音'
                  : '语音输入'
          }
          aria-pressed={recording}
          onClick={() => void toggleRecording()}
        >
          <Icon
            name={starting ? 'timer' : transcribing ? 'close' : recording ? 'stop' : 'mic'}
            size={14}
          />
          {starting
            ? '授权中'
            : transcribing
              ? transcribeSeconds > 0
                ? `识别中 ${transcribeSeconds}s`
                : '识别中'
              : recording
                ? `录音中 ${recordingSeconds}s`
                : ''}
        </button>
        {settings.aiEnabled ? (
          <>
            {aiBusy ? (
              <button
                type="button"
                className="quick-add-ai-cancel"
                title="取消本次 AI 解析（Esc）"
                aria-label="取消 AI 解析"
                onClick={cancelAiParse}
              >
                取消
              </button>
            ) : null}
            <button
              type="button"
              className={`quick-add-ai ${aiBusy ? 'busy' : ''}`}
              title={`AI 解析并添加（Ctrl+Enter）· 超过 ${aiTimeoutSeconds} 秒自动回落到规则解析`}
              aria-label="AI 解析并添加"
              disabled={aiBusy || !value.trim()}
              onClick={() => void submit(true)}
            >
              <Icon name="sparkles" size={14} />
              {aiBusy ? (aiElapsed > 0 ? `解析中 ${aiElapsed}s` : '解析中') : 'AI'}
            </button>
          </>
        ) : null}
        {value.trim() ? <kbd className="quick-add-enter">↵</kbd> : null}
      </div>

      {aiDraft ? (
        <div className="quick-add-draft" role="dialog" aria-label="AI 解析结果">
          <div className="quick-add-draft-head">
            <span className="quick-add-draft-title">
              <Icon name="sparkles" size={13} /> AI 解析结果 · 可修改后添加
            </span>
            <button
              type="button"
              className="icon-btn"
              title="取消 AI 解析结果"
              aria-label="取消 AI 解析结果"
              onClick={cancelDraft}
            >
              <Icon name="close" size={13} />
            </button>
          </div>

          <input
            className="quick-add-draft-name"
            value={aiDraft.title}
            placeholder="任务标题"
            aria-label="AI 任务标题"
            autoFocus
            onChange={(event) => updateDraft({ title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void confirmDraft()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelDraft()
              }
            }}
          />

          <div className="quick-add-draft-fields">
            <label className="quick-add-field">
              <span>截止日期</span>
              <input
                type="date"
                value={aiDraft.dueDate}
                aria-label="AI 截止日期"
                onChange={(event) =>
                  updateDraft({
                    dueDate: event.target.value,
                    dueTime: event.target.value ? aiDraft.dueTime : '',
                    // 没有截止日期就无法换算提醒时刻，清空日期时一并清空提前量。
                    reminderOffsetMin: event.target.value ? aiDraft.reminderOffsetMin : null
                  })
                }
              />
            </label>
            <label className="quick-add-field">
              <span>时间</span>
              <input
                type="time"
                value={aiDraft.dueTime}
                aria-label="AI 截止时间"
                disabled={!aiDraft.dueDate || aiDraft.allDay}
                onChange={(event) =>
                  updateDraft({ dueTime: event.target.value, allDay: false })
                }
              />
            </label>
            <label className="quick-add-field">
              <span>优先级</span>
              <select
                value={aiDraft.priority}
                aria-label="AI 优先级"
                onChange={(event) =>
                  updateDraft({ priority: Number(event.target.value) as Priority })
                }
              >
                {PRIORITY_LABELS.map((label, index) => (
                  <option value={index} key={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="quick-add-field">
              <span>清单</span>
              <select
                value={aiDraft.listId ?? ''}
                aria-label="AI 清单"
                onChange={(event) => updateDraft({ listId: event.target.value || null })}
              >
                {aiDraft.listId === null ? <option value="">当前清单</option> : null}
                {lists.map((list) => (
                  <option value={list.id} key={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-add-draft-fields">
            <label className="quick-add-field grow">
              <span>标签</span>
              <input
                value={aiDraft.tagsText}
                placeholder="空格或逗号分隔，例如：工作 重点"
                aria-label="AI 标签"
                onChange={(event) => updateDraft({ tagsText: event.target.value })}
              />
            </label>
            <label className="quick-add-field">
              <span>重复</span>
              <select
                value={aiDraft.recurrence ?? ''}
                aria-label="AI 重复"
                onChange={(event) => updateDraft({ recurrence: event.target.value || null })}
              >
                {recurrenceChoices.map((choice) => (
                  <option value={choice.value} key={choice.value || 'none'}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="quick-add-field">
              <span>提醒</span>
              <select
                value={aiDraft.reminderOffsetMin ?? ''}
                aria-label="AI 提前提醒"
                title={
                  aiDraft.dueDate
                    ? '按截止日期/时间提前提醒；全天任务按 09:00 计算'
                    : '请先填写截止日期'
                }
                disabled={!aiDraft.dueDate}
                onChange={(event) =>
                  updateDraft({
                    reminderOffsetMin:
                      event.target.value === '' ? null : Number(event.target.value)
                  })
                }
              >
                {reminderChoices.map((choice) => (
                  <option value={choice.value ?? ''} key={choice.value ?? 'none'}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="quick-add-all-day">
              <input
                type="checkbox"
                checked={aiDraft.allDay}
                aria-label="AI 全天任务"
                onChange={(event) =>
                  updateDraft({
                    allDay: event.target.checked,
                    dueTime: event.target.checked ? '' : aiDraft.dueTime
                  })
                }
              />
              全天
            </label>
          </div>

          <div className="quick-add-draft-footer">
            <span className="quick-add-draft-note">
              修改后点「添加」写库；取消后可继续用普通 Enter 按规则添加。
            </span>
            <button type="button" className="btn" onClick={cancelDraft}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!aiDraft.title.trim() || draftBusy}
              onClick={() => void confirmDraft()}
            >
              {draftBusy ? '添加中…' : '添加'}
            </button>
          </div>
        </div>
      ) : null}

      {focused && !aiDraft && hasMeta ? (
        <div className="quick-add-preview">
          {parsed.dueDate ? (
            <span className="preview-chip">
              <Icon name="calendar" size={12} />
              {formatDueLabel(parsed.dueDate, parsed.dueTime, parsed.allDay)}
            </span>
          ) : null}
          {parsed.recurrence ? (
            <span className="preview-chip">
              <Icon name="rotate" size={12} />
              {describeRecurrence(parsed.recurrence)}
            </span>
          ) : null}
          {parsed.reminderOffsetMin != null ? (
            <span className="preview-chip">
              <Icon name="bell" size={12} />
              {describeReminderOffset(parsed.reminderOffsetMin)}
            </span>
          ) : null}
          {parsed.priority > 0 ? (
            <span className="preview-chip" style={{ color: PRIORITY_COLORS[parsed.priority] }}>
              <Icon name="flag" size={12} />
              {PRIORITY_LABELS[parsed.priority]}优先级
            </span>
          ) : null}
          {parsed.tags.map((tag) => (
            <span className="preview-chip" key={tag}>
              <Icon name="tag" size={12} />#{tag}
            </span>
          ))}
          {parsed.listName ? (
            <span className="preview-chip">
              <Icon name="folder" size={12} />
              {parsed.listName}
            </span>
          ) : null}
        </div>
      ) : null}

      {focused && !aiDraft ? (
        <div className="quick-add-hint">
          支持：明天下午 3 点 · 每周一 · 提前30分钟提醒 · #标签 · !高 · ~清单 · 点麦克风语音输入
          {settings.aiEnabled ? ' · Ctrl+Enter 用 AI 理解整句话' : ''}
        </div>
      ) : null}
    </section>
  )
}
