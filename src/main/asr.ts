import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'

export interface AsrConfig {
  python: string
  model: string
  script: string
}

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

export async function resolveAsrConfig(settings: {
  asrPython?: string
  asrModel?: string
}): Promise<AsrConfig | null> {
  const script = app.isPackaged
    ? join(process.resourcesPath, 'scripts', 'voice', 'asr_transcribe.py')
    : join(app.getAppPath(), 'scripts', 'voice', 'asr_transcribe.py')
  if (!(await exists(script))) return null

  const pythonCandidates = [
    settings.asrPython,
    process.env.TICKFLOW_ASR_PYTHON,
    ...KNOWN_PYTHON
  ].filter(Boolean) as string[]
  const modelCandidates = [
    settings.asrModel,
    process.env.TICKFLOW_ASR_MODEL,
    ...KNOWN_MODEL
  ].filter(Boolean) as string[]

  let python = ''
  for (const candidate of pythonCandidates) {
    if (await exists(candidate)) {
      python = candidate
      break
    }
  }
  let model = ''
  for (const candidate of modelCandidates) {
    if (await exists(candidate)) {
      model = candidate
      break
    }
  }
  if (!python || !model) return null
  return { python, model, script }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, out, err: err || 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (out += String(chunk)))
    child.stderr.on('data', (chunk) => (err += String(chunk)))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, out, err: String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
  })
}

export async function transcribeAudio(
  config: AsrConfig,
  audio: Buffer
): Promise<{ text?: string; error?: string }> {
  if (!audio.length) return { error: '没有录到声音' }
  const dir = await mkdtemp(join(tmpdir(), 'tickflow-asr-'))
  const source = join(dir, 'in.webm')
  const wav = join(dir, 'in.wav')
  try {
    await writeFile(source, audio)
    // 浏览器录的是 webm/opus，vosk 只吃 16k 单声道 PCM。
    const convert = await run(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', source, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
      20000
    )
    if (convert.code !== 0) {
      return { error: `转码失败：${(convert.err || '').slice(-200) || 'ffmpeg 不可用'}` }
    }
    const result = await run(
      config.python,
      [config.script, '--model', config.model, wav],
      60000
    )
    const line = (result.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
    if (!line) return { error: `识别进程没有输出：${(result.err || '').slice(-200)}` }
    try {
      const parsed = JSON.parse(line) as { text?: string; error?: string }
      if (parsed.error) return { error: parsed.error }
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
  settings: { asrPython?: string; asrModel?: string },
  audio: Buffer
): Promise<{ text?: string; error?: string }> {
  const config = await resolveAsrConfig(settings)
  if (!config) return { error: '没有找到离线语音识别环境（vosk 模型与运行时）' }
  return transcribeAudio(config, audio)
}

export async function readAudioFile(path: string): Promise<Buffer> {
  return readFile(path)
}
