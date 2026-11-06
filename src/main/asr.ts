import { spawn, type ChildProcess } from 'child_process'
import { mkdtemp, readFile, rm, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import {
  VOICE_CANCELED_HINT,
  VOICE_MAX_AUDIO_BYTES,
  type AsrEnvironment,
  type VoiceTranscribeResult
} from '@shared/voice'

export interface AsrConfig {
  python: string
  model: string
  script: string
}

interface AsrSetting {
  asrPython?: string
  asrModel?: string
}

// 转写分两步：ffmpeg 转码很快，vosk 加载模型 + 60 秒音频通常也在几十秒内。
const FFMPEG_TIMEOUT_MS = 20_000
const TRANSCRIBE_TIMEOUT_MS = 60_000

/**
 * 语音识别是可选能力：模型和 vosk 运行时都在应用之外（60MB 量级），
 * 找不到就返回一句人话，不让快速添加整体失败。
 *
 * 查找顺序：设置项 > 环境变量 > 本机已知路径（开发机上已装好的那份）。
 */
const KNOWN_PYTHON = [
  'F:/projects/workflow-kit/.asr/venv/Scripts/python.exe',
  '/usr/bin/python3'
]
const KNOWN_MODEL = [
  'F:/projects/workflow-kit/.asr/models/vosk-model-small-cn-0.22',
  '/opt/asr/vosk-model-small-cn-0.22'
]

async function exists(path: string): Promise<boolean> {
  if (!path) return false
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function scriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'scripts', 'voice', 'asr_transcribe.py')
    : join(app.getAppPath(), 'scripts', 'voice', 'asr_transcribe.py')
}

async function firstExisting(candidates: Array<string | undefined>): Promise<string> {
  for (const candidate of candidates) {
    if (candidate && (await exists(candidate))) return candidate
  }
  return ''
}

async function locateAsr(settings: AsrSetting): Promise<{
  script: string
  scriptFound: boolean
  python: string
  model: string
}> {
  const script = scriptPath()
  return {
    script,
    scriptFound: await exists(script),
    python: await firstExisting([
      settings.asrPython,
      process.env.TICKFLOW_ASR_PYTHON,
      ...KNOWN_PYTHON
    ]),
    model: await firstExisting([
      settings.asrModel,
      process.env.TICKFLOW_ASR_MODEL,
      ...KNOWN_MODEL
    ])
  }
}

export async function resolveAsrConfig(settings: AsrSetting): Promise<AsrConfig | null> {
  const located = await locateAsr(settings)
  if (!located.scriptFound || !located.python || !located.model) return null
  return { python: located.python, model: located.model, script: located.script }
}

/** 设置页用来解释“为什么麦克风按钮没反应”：缺哪一项就直说。 */
export async function checkAsrEnvironment(settings: AsrSetting): Promise<AsrEnvironment> {
  const located = await locateAsr(settings)
  let message = '离线语音识别可用'
  if (!located.scriptFound) {
    message = '缺少语音转写脚本，请重新安装或更新应用'
  } else if (!located.python) {
    message = '没有找到 Python 运行时，请在设置里填写 Python 路径'
  } else if (!located.model) {
    message = '没有找到 vosk 模型目录，请在设置里填写模型路径'
  }
  return {
    ready: located.scriptFound && Boolean(located.python) && Boolean(located.model),
    python: located.python || null,
    model: located.model || null,
    script: located.script,
    message
  }
}

interface RunResult {
  code: number
  out: string
  err: string
  timedOut: boolean
  aborted: boolean
  missing: boolean
}

/**
 * 跑一个外部进程，并支持超时与外部取消。
 * 超时/取消都立即 resolve（子进程随后被 kill），调用方不用再等 close 事件。
 */
function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: -1, out: '', err: 'aborted', timedOut: false, aborted: true, missing: false })
      return
    }
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({ code: -1, out: '', err: String(error), timedOut: false, aborted: false, missing })
      return
    }

    let out = ''
    let err = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, out, err, timedOut, aborted, missing: false })
    }

    const onAbort = (): void => {
      aborted = true
      try {
        child.kill()
      } catch {
        // 进程可能已经退出。
      }
      finish(-1)
    }

    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // 进程可能已经退出。
      }
      finish(-1)
    }, timeoutMs)

    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk) => (out += String(chunk)))
    child.stderr?.on('data', (chunk) => (err += String(chunk)))
    child.on('error', (error) => {
      if (settled) return
      err = err || String(error)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        settled = true
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve({ code: -1, out, err, timedOut, aborted, missing: true })
        return
      }
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

function tail(value: string, length = 200): string {
  const text = value.trim()
  return text.length > length ? text.slice(-length) : text
}

function friendlyAsrError(raw: string): string {
  if (/No module named ['"]?vosk/i.test(raw) || /ModuleNotFoundError/i.test(raw)) {
    return '语音识别环境缺少 vosk，请先安装依赖'
  }
  if (/expected 16-bit mono wav/i.test(raw)) {
    return '录音格式不受支持，请重试'
  }
  return ''
}

export async function transcribeAudio(
  config: AsrConfig,
  audio: Buffer,
  options: { signal?: AbortSignal } = {}
): Promise<VoiceTranscribeResult> {
  if (options.signal?.aborted) return { error: VOICE_CANCELED_HINT }
  if (!audio.length) return { error: '没有录到声音' }
  if (audio.length > VOICE_MAX_AUDIO_BYTES) {
    return { error: '录音文件过大（超过 24 MB），请缩短到 60 秒以内' }
  }
  const dir = await mkdtemp(join(tmpdir(), 'tickflow-asr-'))
  const source = join(dir, 'in.webm')
  const wav = join(dir, 'in.wav')
  try {
    await writeFile(source, audio)
    // 浏览器录的是 webm/opus，vosk 只吃 16k 单声道 PCM。
    const convert = await runProcess(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', source, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
      FFMPEG_TIMEOUT_MS,
      options.signal
    )
    if (convert.aborted) return { error: VOICE_CANCELED_HINT }
    if (convert.missing) return { error: '缺少 ffmpeg，无法转换录音格式' }
    if (convert.timedOut) {
      return { error: `录音转码超时（${FFMPEG_TIMEOUT_MS / 1000} 秒），请缩短录音后重试` }
    }
    if (convert.code !== 0) {
      const detail = tail(convert.err || '', 160)
      return { error: detail ? `转码失败：${detail}` : '转码失败，录音格式可能无法识别' }
    }

    const result = await runProcess(
      config.python,
      [config.script, '--model', config.model, wav],
      TRANSCRIBE_TIMEOUT_MS,
      options.signal
    )
    if (result.aborted) return { error: VOICE_CANCELED_HINT }
    if (result.missing) return { error: '找不到语音识别运行时（Python），请在设置里填写路径' }
    if (result.timedOut) {
      return {
        error: `语音识别超时（${TRANSCRIBE_TIMEOUT_MS / 1000} 秒），请缩短录音后重试`
      }
    }

    const line = (result.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
    if (!line) {
      const friendly = friendlyAsrError(result.err || '')
      return {
        error:
          friendly ||
          `识别进程没有输出：${tail(result.err || '', 200) || `退出码 ${result.code}`}`
      }
    }
    try {
      const parsed = JSON.parse(line) as { text?: string; error?: string }
      if (parsed.error) {
        return { error: friendlyAsrError(parsed.error) || `语音识别失败：${parsed.error}` }
      }
      const text = (parsed.text || '').trim()
      return text ? { text } : { error: '没听清，再说一次？' }
    } catch {
      return { error: '识别结果解析失败' }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function transcribeWithFallback(
  settings: AsrSetting,
  audio: Buffer,
  signal?: AbortSignal
): Promise<VoiceTranscribeResult> {
  if (signal?.aborted) return { error: VOICE_CANCELED_HINT }
  const config = await resolveAsrConfig(settings)
  if (!config) return { error: '没有找到离线语音识别环境（vosk 模型与运行时）' }
  return transcribeAudio(config, audio, { signal })
}

export async function readAudioFile(path: string): Promise<Buffer> {
  return readFile(path)
}
