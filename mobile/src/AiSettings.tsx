import { useEffect, useState, type ReactNode } from 'react'
import {
  AI_CLOUD_DEFAULT_BASE_URL,
  AI_CLOUD_DEFAULT_MODEL,
  AI_LOCAL_DEFAULT_MODEL,
  generateAi,
  getAiConfig,
  isLocalAiSupported,
  localAiStatus,
  saveAiConfig,
  unloadLocalAi,
  type AiChannel,
  type LocalAiStatus,
  type MobileAiConfig
} from './ai'

type Toast = (message: string, kind: 'success' | 'error' | 'info') => void

const CHANNELS: Array<{ value: AiChannel; label: string; hint: string }> = [
  { value: 'local', label: '本地', hint: '只在手机端推理，离线可用、零额度' },
  { value: 'cloud', label: '云端', hint: '走 OpenAI 兼容接口，快但需要网络和 Key' },
  { value: 'auto', label: '自动', hint: '先云端，失败自动回退本地' }
]

export function AiSettings({ onToast }: { onToast: Toast }): ReactNode {
  const [config, setConfig] = useState<MobileAiConfig | null>(null)
  const [status, setStatus] = useState<LocalAiStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    setConfig(await getAiConfig())
    setStatus(await localAiStatus())
  }

  useEffect(() => {
    void reload()
  }, [])

  const update = async (patch: Partial<MobileAiConfig>): Promise<void> => {
    if (!config) return
    const next = { ...config, ...patch }
    setConfig(next)
    await saveAiConfig(patch)
  }

  const test = async (): Promise<void> => {
    if (!config) return
    setTesting(true)
    setTestResult(null)
    const started = Date.now()
    try {
      const result = await generateAi(
        config,
        'You are a connectivity probe.',
        'Reply with exactly: OK',
        32
      )
      setTestResult(`${result.source === 'local' ? '本地' : '云端'}返回：${result.text.trim().slice(0, 40)} · ${Date.now() - started}ms`)
      await reload()
    } catch (error) {
      setTestResult(`失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  const releaseLocal = async (): Promise<void> => {
    await unloadLocalAi()
    await reload()
    onToast('已释放本地模型内存', 'info')
  }

  if (!config) {
    return (
      <section className="settings-section">
        <h3>AI</h3>
        <p className="hint">读取配置中…</p>
      </section>
    )
  }

  return (
    <section className="settings-section">
      <h3>AI（本地 / 云端）</h3>
      <label className="switch-row">
        <span>启用 AI 解析</span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => void update({ enabled: event.target.checked })}
        />
      </label>

      <div className="segmented">
        {CHANNELS.map((channel) => (
          <button
            type="button"
            key={channel.value}
            className={config.channel === channel.value ? 'selected' : ''}
            onClick={() => void update({ channel: channel.value })}
          >
            {channel.label}
          </button>
        ))}
      </div>
      <p className="hint">{CHANNELS.find((item) => item.value === config.channel)?.hint}</p>

      {config.channel !== 'local' ? (
        <>
          <label className="field-label" htmlFor="ai-cloud-base">云端 Base URL</label>
          <input
            id="ai-cloud-base"
            className="input"
            value={config.cloudBaseUrl}
            placeholder={AI_CLOUD_DEFAULT_BASE_URL}
            onChange={(event) => void update({ cloudBaseUrl: event.target.value })}
          />
          <label className="field-label" htmlFor="ai-cloud-key">API Key</label>
          <input
            id="ai-cloud-key"
            className="input"
            type="password"
            value={config.cloudApiKey}
            placeholder="sk-…"
            onChange={(event) => void update({ cloudApiKey: event.target.value })}
          />
          <label className="field-label" htmlFor="ai-cloud-model">云端模型</label>
          <input
            id="ai-cloud-model"
            className="input"
            value={config.cloudModel}
            placeholder={AI_CLOUD_DEFAULT_MODEL}
            onChange={(event) => void update({ cloudModel: event.target.value })}
          />
        </>
      ) : null}

      {config.channel !== 'cloud' ? (
        <>
          <label className="field-label" htmlFor="ai-local-model">本地模型目录名</label>
          <input
            id="ai-local-model"
            className="input"
            value={config.localModel}
            placeholder={AI_LOCAL_DEFAULT_MODEL}
            onChange={(event) => void update({ localModel: event.target.value })}
          />
          <p className="hint">
            {!isLocalAiSupported()
              ? '仅 Android 端支持本地模型。'
              : status?.loaded
                ? `已加载：${status.model}`
                : status?.internalModels.length
                  ? `已就绪：${status.internalModels.join('、')}（首次使用会拷贝到应用内部目录）`
                  : status?.externalModels.length
                    ? `已投递：${status.externalModels.join('、')}，首次使用会拷贝到应用内部目录`
                    : `未找到模型。把模型目录推到 /sdcard/Android/data/com.tickflow.mobile/files/models/mnn/${config.localModel}/ 后重进设置页。`}
          </p>
          {status?.loaded ? (
            <button type="button" className="secondary-btn" onClick={() => void releaseLocal()}>
              释放本地模型内存
            </button>
          ) : null}
        </>
      ) : null}

      <div className="button-row">
        <button type="button" className="secondary-btn" disabled={testing} onClick={() => void test()}>
          {testing ? '测试中…' : '测试 AI 连接'}
        </button>
      </div>
      {testResult ? <p className="hint">{testResult}</p> : null}
      <p className="hint">
        云端走 OpenAI 兼容的 /chat/completions；本地模型与雅思 App 相同（MNN），首次加载约数秒到一分钟。
      </p>
    </section>
  )
}
