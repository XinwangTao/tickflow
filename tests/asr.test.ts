import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transcribeAudio } from '../src/main/asr'

// 需要本机已装 vosk 运行时与模型、且 ffmpeg 在 PATH 上；缺环境时整组跳过，
// 不让 CI 因为没有 60MB 模型而红。
const PYTHON = 'F:/projects/workflow-kit/.asr/venv/Scripts/python.exe'
const MODEL = 'F:/projects/workflow-kit/.asr/models/vosk-model-small-cn-0.22'
const SCRIPT = 'scripts/voice/asr_transcribe.py'
const SAMPLE = '.tmp/tts.wav'
const ready = existsSync(PYTHON) && existsSync(MODEL) && existsSync(SAMPLE)

describe.skipIf(!ready)('transcribeAudio', () => {
  it('把录音转成中文文本', async () => {
    const result = await transcribeAudio(
      { python: PYTHON, model: MODEL, script: SCRIPT },
      readFileSync(SAMPLE)
    )
    expect(result.error).toBeUndefined()
    expect(result.text).toBeTruthy()
    expect(result.text).toMatch(/提醒|浇|三点/)
  }, 60000)

  it('空音频给出人话而不是抛异常', async () => {
    const result = await transcribeAudio(
      { python: PYTHON, model: MODEL, script: SCRIPT },
      Buffer.alloc(0)
    )
    expect(result.text).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})
