/**
 * 离线语音输入相关的纯函数与常量。
 *
 * 录音发生在 renderer（MediaRecorder），转写发生在 main（ffmpeg + vosk）。
 * 两侧共用这里的上限与提示文案，避免 UI 显示 60 秒、主进程却按别的值截断。
 */

/** 单次录音上限：60 秒足够说清一句话，也能避免把超长音频塞进 IPC。 */
export const VOICE_MAX_RECORD_MS = 60_000
/** 低于这个时长通常只是误触，直接提示重录，不浪费一次转写。 */
export const VOICE_MIN_RECORD_MS = 600
/** main 里 ffmpeg 转码单步上限。 */
export const VOICE_FFMPEG_TIMEOUT_MS = 20_000
/** main 里 vosk 转写单步上限。 */
export const VOICE_ASR_TIMEOUT_MS = 60_000
/**
 * renderer 等待转写的总上限；超时后中止 main 里的子进程，按钮立即恢复。
 * 必须大于 main 两步子进程的上限之和（20s + 60s = 80s），否则 renderer 会先
 * 超时取消，用户只能看到「识别超时」，拿不到 main 准备好的具体失败原因。
 */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 90_000
/**
 * 等待系统麦克风授权/设备启动的上限。部分系统会把权限弹窗挂在后台不返回，
 * 没有上限时按钮会一直停在“没反应”的状态，只能重启应用。
 */
export const VOICE_PERMISSION_TIMEOUT_MS = 15_000
/** IPC 传输的录音上限，留出 webm 容器开销。 */
export const VOICE_MAX_AUDIO_BYTES = 24 * 1024 * 1024

export const VOICE_UNSUPPORTED_HINT = '当前环境不支持录音，请改用键盘输入'
export const VOICE_TOO_SHORT_HINT = '录音太短，点一下开始、说完再点一下结束'
export const VOICE_EMPTY_HINT = '没有录到声音，请检查麦克风'
export const VOICE_MAX_REACHED_HINT = '已达到 60 秒录音上限，正在识别'
export const VOICE_CANCELED_HINT = '已取消语音识别'
export const VOICE_TIMEOUT_HINT = `语音识别超时（${
  VOICE_TRANSCRIBE_TIMEOUT_MS / 1000
} 秒），请缩短录音后重试`
export const VOICE_PERMISSION_TIMEOUT_HINT =
  '等待麦克风权限超时，请检查系统权限弹窗后重试'
export const VOICE_START_CANCELED_HINT = '已取消录音启动'
/** 语音链路占着输入框时，Enter 不该把半截文字当成任务创建。 */
export const VOICE_BUSY_CHECKING_HINT = '正在检查语音识别环境，请稍候再添加'
export const VOICE_BUSY_STARTING_HINT = '正在等待麦克风权限，请稍候再添加'
export const VOICE_BUSY_RECORDING_HINT = '正在录音，先结束录音再添加'
export const VOICE_BUSY_TRANSCRIBING_HINT = '正在识别语音，请稍候再添加'
/** AI 草稿/解析与语音抢同一个输入框时，先让用户处理掉其中一个。 */
export const VOICE_DRAFT_OPEN_HINT = '请先添加或取消上方的 AI 解析结果，再使用语音输入'
export const VOICE_AI_BUSY_HINT = 'AI 正在解析，请稍候再使用语音输入'
export const VOICE_APPENDED_HINT = '已追加语音文字'
export const VOICE_APPEND_UNDONE_HINT = '已撤销语音文字'
export const VOICE_APPEND_UNDO_STALE_HINT = '输入已变化，未撤销语音文字'
/** 录音前自检：环境缺项时直接说明，不再先录一段必然失败的音频。 */
export const VOICE_ASR_NOT_READY_HINT = '离线语音识别不可用'

export interface VoiceTranscribeResult {
  text?: string
  error?: string
}

/** 设置页“检查语音环境”的返回结构；ready 为 false 时 message 说明缺哪一项。 */
export interface AsrEnvironment {
  ready: boolean
  python: string | null
  model: string | null
  script: string
  message: string
}

/**
 * 录音前判断环境是否可用：只有明确返回 `ready: false` 才拦截。
 * IPC 失败、旧 preload 没有 asrStatus 或返回 undefined 时返回 null（放行），
 * 避免“自检接口坏了”连带把本来能用的语音输入也一起禁用。
 */
export function asrEnvironmentProblem(
  status: Pick<AsrEnvironment, 'ready' | 'message'> | null | undefined
): string | null {
  if (!status || status.ready) return null
  return status.message?.trim() || '缺少 Python、vosk 模型或转写脚本'
}

/**
 * 转写 IPC 本身失败（main 崩溃、通道异常）时的提示。
 * 这类错误不是麦克风打不开，不能复用 `micErrorMessage`，否则会误导用户去调系统权限。
 */
export function transcribeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const detail = raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  if (!detail) return '语音识别失败，请重试；若反复失败，请在设置里检查语音识别环境'
  const clipped = detail.length > 180 ? `${detail.slice(0, 177)}…` : detail
  return `语音识别失败：${clipped}；可在设置 → 语音输入（离线）里检查环境`
}

/**
 * 把 getUserMedia / MediaRecorder 的异常翻译成人话。
 * 浏览器原始文案（如 `Permission denied`）对用户没有指导意义，保留在冒号后面便于排查。
 */
export function micErrorMessage(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : ''
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return '麦克风权限被拒绝，请在系统设置里允许 TickFlow 使用麦克风'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '没有找到麦克风，请先连接录音设备'
    case 'NotReadableError':
    case 'TrackStartError':
      return '麦克风被其他程序占用，请关闭占用后重试'
    case 'SecurityError':
      return '系统安全策略不允许录音，请检查权限设置'
    case 'OverconstrainedError':
      return '麦克风不支持当前录音参数，请换一个设备'
    case 'AbortError':
      return '录音启动被中断，请重试'
    default:
      return raw ? `打不开麦克风：${raw}` : '打不开麦克风，请检查系统权限'
  }
}

/** 权限被拒或系统策略禁止时，重试同一个调用只会再失败一次，不给「重试」按钮。 */
export function micErrorRetryable(error: unknown): boolean {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : ''
  return (
    name !== 'NotAllowedError' &&
    name !== 'PermissionDeniedError' &&
    name !== 'SecurityError'
  )
}

/** 按兼容性顺序尝试的容器格式；拿到第一个支持的即可。 */
export const VOICE_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
] as const

/** 返回 MediaRecorder 支持的第一个格式；都不支持时返回 null，交给浏览器默认值。 */
export function pickRecorderMime(
  isSupported?: (type: string) => boolean
): string | null {
  if (typeof isSupported !== 'function') return null
  for (const type of VOICE_MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type
    } catch {
      // 某些实现会对未知类型抛异常，继续尝试下一个。
    }
  }
  return null
}

/** 把新识别出的文字追加到已有输入，保留用户先前输入的内容。 */
export function appendTranscript(current: string, transcript: string): string {
  const next = transcript.trim()
  if (!next) return current
  const base = current.trim()
  if (!base) return next
  return `${base} ${next}`
}

/**
 * 撤销一次语音追加：输入没被改动时原样恢复到追加前；
 * 用户又输入了新内容但识别文字仍在末尾时，只摘掉末尾这一段；
 * 其余情况不动输入，避免误删用户手打的内容。
 */
export function removeTranscript(
  current: string,
  before: string,
  transcript: string
): string {
  const next = transcript.trim()
  if (!next) return current
  if (current === appendTranscript(before, next)) return before
  // 允许末尾跟着用户补的标点：识别文字仍算“在末尾”。
  const trimmedCurrent = current.replace(/[\s,，。.!！?？、;；:：]+$/u, '')
  if (!trimmedCurrent.endsWith(next)) return current
  const head = trimmedCurrent
    .slice(0, trimmedCurrent.length - next.length)
    .replace(/[\s,，。.!！?？、;；:：]+$/u, '')
  return head.trim() === before.trim() ? before : head
}

export function recordingTooShort(durationMs: number): boolean {
  return durationMs >= 0 && durationMs < VOICE_MIN_RECORD_MS
}

/** 按钮上的等待秒数：0.2 秒也显示 1s，避免一直停在「识别中」。 */
export function voiceElapsedSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / 1000))
}
