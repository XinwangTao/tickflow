import { describe, expect, it } from 'vitest'
import {
  appendTranscript,
  micErrorMessage,
  pickRecorderMime,
  recordingTooShort,
  VOICE_MAX_RECORD_MS,
  VOICE_MAX_AUDIO_BYTES,
  VOICE_MIN_RECORD_MS,
  VOICE_TRANSCRIBE_TIMEOUT_MS,
  voiceElapsedSeconds
} from '../src/shared/voice'

describe('语音输入辅助函数', () => {
  it('把录音错误翻译成可操作的中文提示', () => {
    const named = (name: string): Error => Object.assign(new Error('raw'), { name })
    expect(micErrorMessage(named('NotAllowedError'))).toContain('麦克风权限被拒绝')
    expect(micErrorMessage(named('PermissionDeniedError'))).toContain('麦克风权限被拒绝')
    expect(micErrorMessage(named('NotFoundError'))).toContain('没有找到麦克风')
    expect(micErrorMessage(named('NotReadableError'))).toContain('被其他程序占用')
    expect(micErrorMessage(named('SecurityError'))).toContain('安全策略')
    expect(micErrorMessage(named('OverconstrainedError'))).toContain('不支持当前录音参数')
    expect(micErrorMessage(named('AbortError'))).toContain('录音启动被中断')
  })

  it('未知错误保留原始信息，空错误也有兜底文案', () => {
    expect(micErrorMessage(new Error('device busy'))).toBe('打不开麦克风：device busy')
    expect(micErrorMessage('boom')).toBe('打不开麦克风：boom')
    expect(micErrorMessage(null)).toBe('打不开麦克风，请检查系统权限')
  })

  it('按兼容性顺序挑选录音格式，全部不支持时交给浏览器默认值', () => {
    const supported = new Set(['audio/webm', 'audio/mp4'])
    expect(pickRecorderMime((type) => supported.has(type))).toBe('audio/webm')
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMime(() => false)).toBeNull()
    expect(pickRecorderMime()).toBeNull()
    expect(
      pickRecorderMime((type) => {
        if (type === 'audio/webm;codecs=opus') throw new Error('nope')
        return type === 'audio/ogg;codecs=opus'
      })
    ).toBe('audio/ogg;codecs=opus')
  })

  it('识别文字追加到已有输入，保留用户先前的内容', () => {
    expect(appendTranscript('', '明天下午三点提醒我浇花')).toBe('明天下午三点提醒我浇花')
    expect(appendTranscript('买牛奶', '明天下午三点提醒我浇花')).toBe(
      '买牛奶 明天下午三点提醒我浇花'
    )
    expect(appendTranscript('  买牛奶  ', ' 浇花 ')).toBe('买牛奶 浇花')
    expect(appendTranscript('买牛奶', '   ')).toBe('买牛奶')
  })

  it('录音太短与等待秒数的边界', () => {
    expect(recordingTooShort(0)).toBe(true)
    expect(recordingTooShort(VOICE_MIN_RECORD_MS - 1)).toBe(true)
    expect(recordingTooShort(VOICE_MIN_RECORD_MS)).toBe(false)
    expect(voiceElapsedSeconds(0)).toBe(0)
    expect(voiceElapsedSeconds(200)).toBe(1)
    expect(voiceElapsedSeconds(1000)).toBe(1)
    expect(voiceElapsedSeconds(1001)).toBe(2)
  })

  it('时长与体积上限保持一致，给 UI 和主进程共用', () => {
    expect(VOICE_MAX_RECORD_MS).toBe(60_000)
    expect(VOICE_TRANSCRIBE_TIMEOUT_MS).toBeGreaterThan(VOICE_MAX_RECORD_MS)
    expect(VOICE_MAX_AUDIO_BYTES).toBeGreaterThan(VOICE_MAX_RECORD_MS)
    expect(VOICE_MIN_RECORD_MS).toBeLessThan(VOICE_MAX_RECORD_MS)
  })
})
