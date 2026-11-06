import { useEffect, useRef, useState } from 'react'
import type { AppInfo } from '@shared/types'
import {
  AI_CANCELED_MODELS_HINT,
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS,
  type AiModelInfo
} from '@shared/ai'
import { R2_CORS_POLICY } from '@shared/r2-cors'
import { LIST_COLORS } from '../lib/colors'
import { formatDateTime } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Modal } from './Modal'

const THEMES: Array<{ value: 'dark' | 'light' | 'system'; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' }
]

const FONT_SCALES: Array<{ value: number; label: string }> = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.1, label: '大' }
]

export function SettingsDialog(): React.ReactNode {
  const settings = useAppStore((state) => state.settings)
  const lists = useAppStore((state) => state.lists)
  const setSettings = useAppStore((state) => state.setSettings)
  const close = useAppStore((state) => state.setSettingsOpen)
  const showToast = useAppStore((state) => state.showToast)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [r2, setR2] = useState({
    endpoint: settings.r2Endpoint,
    bucket: settings.r2Bucket,
    accessKeyId: settings.r2AccessKeyId,
    secretAccessKey: settings.r2SecretAccessKey,
    prefix: settings.r2Prefix,
    autoSync: settings.r2AutoSync
  })
  const [ai, setAi] = useState({
    enabled: settings.aiEnabled,
    baseUrl: settings.aiBaseUrl,
    model: settings.aiModel,
    token: settings.aiToken,
    timeoutMs: String(settings.aiTimeoutMs)
  })
  const [aiTesting, setAiTesting] = useState(false)
  const [asr, setAsr] = useState({
    python: settings.asrPython ?? '',
    model: settings.asrModel ?? ''
  })
  const [asrChecking, setAsrChecking] = useState(false)
  const [usage, setUsage] = useState<{ objects: number; bytes: number } | null>(null)
  const [usageBusy, setUsageBusy] = useState(false)
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([])
  const [aiModelsBusy, setAiModelsBusy] = useState(false)
  const [aiModelsElapsed, setAiModelsElapsed] = useState(0)
  // 模型目录请求与快速添加共用 ai:cancel 注册表：设置页关闭时也要中止，别在后台跑满超时。
  const modelsRequestSeq = useRef(0)
  const activeModelsRequest = useRef<string | null>(null)

  useEffect(() => {
    void window.api.app.info().then(setInfo)
  }, [])

  // 请求期间显示已等待秒数，和快速添加/今日总结保持一致。
  useEffect(() => {
    if (!aiModelsBusy) {
      setAiModelsElapsed(0)
      return
    }
    const timer = setInterval(() => setAiModelsElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [aiModelsBusy])

  // 关闭设置页（组件卸载）时中止模型目录请求，避免摘下界面后还在后台等超时。
  useEffect(() => {
    return () => {
      const active = activeModelsRequest.current
      if (!active) return
      activeModelsRequest.current = null
      try {
        void window.api.ai.cancel(active).catch(() => undefined)
      } catch {
        // 旧 preload 或测试桩没有 cancel 时忽略，不影响关闭设置页。
      }
    }
  }, [])

  const saveSync = async (): Promise<void> => {
    await setSettings({
      r2Endpoint: r2.endpoint.trim(),
      r2Bucket: r2.bucket.trim(),
      r2AccessKeyId: r2.accessKeyId.trim(),
      r2SecretAccessKey: r2.secretAccessKey.trim(),
      r2Prefix: r2.prefix.trim() || 'tickflow/snapshots/',
      r2AutoSync: r2.autoSync
    })
  }

  const testConnection = async (): Promise<void> => {
    await saveSync()
    const result = await window.api.sync.test()
    showToast(result.message, result.ok ? 'success' : 'error', { duration: 5000 })
  }

  const runSync = async (): Promise<void> => {
    await saveSync()
    const result = await window.api.sync.now()
    showToast(result.message, result.ok ? 'success' : 'error', { duration: 6000 })
    if (result.ok) await setSettings({})
  }

  const checkUsage = async (): Promise<void> => {
    await saveSync()
    setUsageBusy(true)
    try {
      setUsage(await window.api.sync.usage())
    } catch (error) {
      showToast(String(error), 'error', { duration: 6000 })
    } finally {
      setUsageBusy(false)
    }
  }

  const saveAi = async (): Promise<void> => {
    const timeout = Number(ai.timeoutMs)
    await setSettings({
      aiEnabled: ai.enabled,
      aiBaseUrl: ai.baseUrl.trim() || AI_DEFAULT_BASE_URL,
      aiModel: ai.model.trim() || AI_DEFAULT_MODEL,
      aiToken: ai.token.trim(),
      asrPython: asr.python.trim(),
      asrModel: asr.model.trim(),
      aiTimeoutMs:
        Number.isFinite(timeout) && timeout >= 1000
          ? Math.min(timeout, 120000)
          : AI_DEFAULT_TIMEOUT_MS
    })
  }

  const testAi = async (): Promise<void> => {
    await saveAi()
    setAiTesting(true)
    try {
      const result = await window.api.ai.test()
      showToast(result.message, result.ok ? 'success' : 'error', { duration: 6000 })
    } catch (error) {
      showToast(`AI 连接测试失败：${String(error)}`, 'error', { duration: 6000 })
    } finally {
      setAiTesting(false)
    }
  }

  const checkAsr = async (): Promise<void> => {
    await saveAi()
    setAsrChecking(true)
    try {
      const environment = await window.api.ai.asrStatus()
      showToast(
        environment.ready
          ? `离线语音识别可用${environment.model ? `：${environment.model}` : ''}`
          : environment.message,
        environment.ready ? 'success' : 'error',
        { duration: 7000 }
      )
    } catch (error) {
      showToast(`检查语音环境失败：${String(error)}`, 'error', { duration: 7000 })
    } finally {
      setAsrChecking(false)
    }
  }

  const loadAiModels = async (): Promise<void> => {
    if (activeModelsRequest.current) return
    await saveAi()
    const requestId = `models-${(modelsRequestSeq.current += 1)}`
    activeModelsRequest.current = requestId
    setAiModelsBusy(true)
    try {
      const result = await window.api.ai.models(requestId)
      // 已取消（或已被新请求取代）：迟到的目录不再展示，也不弹失败提示。
      if (activeModelsRequest.current !== requestId) return
      if (result.ok) {
        setAiModels(result.models)
        showToast(result.message, 'success', { duration: 6000 })
        return
      }
      if (result.message === AI_CANCELED_MODELS_HINT) return
      showToast(result.message, 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: () => loadAiModels()
      })
    } catch (error) {
      if (activeModelsRequest.current !== requestId) return
      showToast(`获取模型列表失败：${String(error)}`, 'error', {
        duration: 7000,
        actionLabel: '重试',
        action: () => loadAiModels()
      })
    } finally {
      if (activeModelsRequest.current === requestId) {
        activeModelsRequest.current = null
        setAiModelsBusy(false)
      }
    }
  }

  /** 取消进行中的目录请求：与失败不同，不弹重试入口，当前已选模型保持不变。 */
  const cancelLoadAiModels = (): void => {
    const active = activeModelsRequest.current
    if (!active) return
    activeModelsRequest.current = null
    setAiModelsBusy(false)
    setAiModelsElapsed(0)
    try {
      void window.api.ai.cancel(active).catch(() => undefined)
    } catch {
      // 与卸载清理一致：没有 cancel 能力时不影响按钮复位。
    }
    showToast(`${AI_CANCELED_MODELS_HINT}，当前模型配置未改变`, 'info')
  }

  const copyCors = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(R2_CORS_POLICY)
      showToast('CORS 配置已复制', 'success')
    } catch {
      showToast('复制失败，请手动查看文档 docs/sync-r2.md', 'error')
    }
  }

  const handleExport = async (format: 'json' | 'csv' | 'ics'): Promise<void> => {
    try {
      const result = await window.api.data.export(format)
      if (!result.canceled) {
        showToast(`已导出到 ${result.path ?? ''}`, 'success', { duration: 5000 })
      }
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const result = await window.api.data.importJson()
      if (!result.canceled && result.counts) {
        showToast(
          `导入完成：${result.counts.tasks} 个任务、${result.counts.habits} 个习惯`,
          'success',
          { duration: 5000 }
        )
      }
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleBackup = async (): Promise<void> => {
    try {
      const path = await window.api.data.backup()
      showToast(`已备份到 ${path}`, 'success', { duration: 6000 })
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleOpenDataDir = async (): Promise<void> => {
    try {
      await window.api.data.openDir()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleOpenBackupDir = async (): Promise<void> => {
    try {
      await window.api.data.openBackupDir()
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleRestoreBackup = async (): Promise<void> => {
    try {
      await window.api.data.restoreBackup()
    } catch (error) {
      showToast(String(error), 'error', { duration: 6000 })
    }
  }

  const handleVerifyAllBackups = async (): Promise<void> => {
    try {
      const results = await window.api.data.verifyAllBackups()
      const failed = results.filter((item) => !item.ok)
      showToast(
        failed.length === 0
          ? `全部 ${results.length} 份备份校验通过`
          : `${results.length - failed.length}/${results.length} 份通过，失败：${failed
              .map((item) => item.path ?? item.message)
              .join('、')}`,
        failed.length === 0 ? 'success' : 'error',
        { duration: 7000 }
      )
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  const handleVerifyBackup = async (): Promise<void> => {
    try {
      const result = await window.api.data.verifyBackup()
      showToast(
        result.ok
          ? `备份校验通过：${result.path ?? ''}`
          : `备份校验失败：${result.message}`,
        result.ok ? 'success' : 'error',
        { duration: 6000 }
      )
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  return (
    <Modal title="设置" onClose={() => close(false)} width={560}>
      <section className="settings-section">
        <h3>外观</h3>
        <div className="settings-row">
          <span className="settings-label">主题</span>
          <div className="segmented">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                className={settings.theme === theme.value ? 'selected' : ''}
                onClick={() => void setSettings({ theme: theme.value })}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">强调色</span>
          <div className="color-swatches">
            {LIST_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${settings.accent === color ? 'selected' : ''}`}
                style={{ background: color }}
                aria-label={`强调色 ${color}`}
                onClick={() => void setSettings({ accent: color })}
              />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">字号</span>
          <div className="segmented">
            {FONT_SCALES.map((scale) => (
              <button
                key={scale.value}
                type="button"
                className={settings.fontScale === scale.value ? 'selected' : ''}
                onClick={() => void setSettings({ fontScale: scale.value })}
              >
                {scale.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>行为</h3>
        <div className="settings-row">
          <span className="settings-label">显示已完成任务</span>
          <button
            type="button"
            className={`switch ${settings.showCompleted ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.showCompleted}
            onClick={() => void setSettings({ showCompleted: !settings.showCompleted })}
          >
            <span />
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-label">开机自启</span>
          <button
            type="button"
            className={`switch ${settings.autoLaunch ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.autoLaunch}
            onClick={() => void setSettings({ autoLaunch: !settings.autoLaunch })}
          >
            <span />
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-label">启动时最小化</span>
          <button
            type="button"
            className={`switch ${settings.startMinimized ? 'on' : ''}`}
            role="switch"
            aria-checked={settings.startMinimized}
            onClick={() => void setSettings({ startMinimized: !settings.startMinimized })}
          >
            <span />
          </button>
        </div>
        <p className="settings-note">仅安装版生效；开发模式不会写入系统启动项。</p>
        <div className="settings-row">
          <span className="settings-label">每周起始日</span>
          <div className="segmented">
            <button
              type="button"
              className={settings.weekStart === 1 ? 'selected' : ''}
              onClick={() => void setSettings({ weekStart: 1 })}
            >
              周一
            </button>
            <button
              type="button"
              className={settings.weekStart === 0 ? 'selected' : ''}
              onClick={() => void setSettings({ weekStart: 0 })}
            >
              周日
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">默认清单</span>
          <select
            className="input settings-select"
            value={settings.defaultListId ?? ''}
            onChange={(event) =>
              void setSettings({ defaultListId: event.target.value || null })
            }
          >
            <option value="">跟随当前视图</option>
            {lists.map((list) => (
              <option value={list.id} key={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>AI 助手（CC Switch）</h3>
        <div className="settings-row">
          <span className="settings-label">启用 AI</span>
          <button
            type="button"
            className={`switch ${ai.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={ai.enabled}
            onClick={() => setAi({ ...ai, enabled: !ai.enabled })}
          >
            <span />
          </button>
        </div>
        <div className="sync-grid">
          <label className="field sync-grid-wide">
            <span className="field-label">Base URL</span>
            <input
              className="input"
              value={ai.baseUrl}
              placeholder={AI_DEFAULT_BASE_URL}
              onChange={(event) => setAi({ ...ai, baseUrl: event.target.value })}
            />
          </label>
          <label className="field sync-grid-wide">
            <span className="field-label">模型 ID</span>
            <input
              className="input"
              value={ai.model}
              placeholder={AI_DEFAULT_MODEL}
              onChange={(event) => setAi({ ...ai, model: event.target.value })}
            />
          </label>
          {aiModels.length > 0 ? (
            <label className="field sync-grid-wide">
              <span className="field-label">本机模型（{aiModels.length}）</span>
              <select
                className="input"
                value={aiModels.some((model) => model.id === ai.model) ? ai.model : ''}
                onChange={(event) => {
                  if (event.target.value) setAi({ ...ai, model: event.target.value })
                }}
              >
                <option value="">从 /v1/models 选择模型…</option>
                {aiModels.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.id}
                    {model.displayName ? ` · ${model.displayName}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">Token（可选）</span>
            <input
              className="input"
              type="password"
              value={ai.token}
              placeholder="本机服务通常留空"
              onChange={(event) => setAi({ ...ai, token: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">超时（毫秒）</span>
            <input
              className="input"
              type="number"
              min={1000}
              max={120000}
              value={ai.timeoutMs}
              onChange={(event) => setAi({ ...ai, timeoutMs: event.target.value })}
            />
          </label>
        </div>
        <p className="field-hint">
          超时只作用于单次请求（1000–120000 毫秒）。连接被拒、限流或 5xx 会自动重试 1 次；
          超时不重试，因为已经用满了这里的等待时间，界面会立即回落到本地规则。
        </p>
        {aiModels.length > 0 &&
        !aiModels.some((model) => model.id === ai.model) ? (
          <p className="field-hint">
            当前模型不在本机 /v1/models 列表里，请从上方选择或核对大小写与分隔符。
          </p>
        ) : null}
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => void saveAi()}>
            保存 AI 配置
          </button>
          <button
            type="button"
            className="btn"
            disabled={aiTesting}
            onClick={() => void testAi()}
          >
            {aiTesting ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={aiModelsBusy}
            title={`从本机 ${AI_DEFAULT_BASE_URL} 读取 /v1/models；超时会自动回落，不必等待`}
            onClick={() => void loadAiModels()}
          >
            {aiModelsBusy
              ? aiModelsElapsed > 0
                ? `获取中 ${aiModelsElapsed}s`
                : '获取中…'
              : '获取模型列表'}
          </button>
          {aiModelsBusy ? (
            <button
              type="button"
              className="btn"
              title="取消本次模型目录请求"
              aria-label="取消获取模型列表"
              onClick={cancelLoadAiModels}
            >
              取消
            </button>
          ) : null}
        </div>
        <p className="settings-note">
          默认连接本机 CC Switch（{AI_DEFAULT_BASE_URL}）。模型名需与 /v1/models 返回的 id
          完全一致，可点「获取模型列表」直接从本机目录选择；AI 超时或不可用时会自动回落到本地规则解析，不影响任务创建。
        </p>

        <h4 className="settings-subhead">语音输入（离线）</h4>
        <div className="sync-grid">
          <label className="field sync-grid-wide">
            <span className="field-label">Python 路径（可选）</span>
            <input
              className="input"
              value={asr.python}
              placeholder="留空自动探测，例如 F:/asr/venv/Scripts/python.exe"
              onChange={(event) => setAsr({ ...asr, python: event.target.value })}
            />
          </label>
          <label className="field sync-grid-wide">
            <span className="field-label">vosk 模型目录（可选）</span>
            <input
              className="input"
              value={asr.model}
              placeholder="留空自动探测，例如 F:/asr/models/vosk-model-small-cn-0.22"
              onChange={(event) => setAsr({ ...asr, model: event.target.value })}
            />
          </label>
        </div>
        <p className="field-hint">
          快速添加栏的麦克风按钮使用本机离线识别，不联网。留空时按环境变量
          （TICKFLOW_ASR_PYTHON / TICKFLOW_ASR_MODEL）与常见安装路径自动查找；
          缺少 ffmpeg、Python、vosk 或模型时，识别失败会给出具体原因，不影响键盘输入。
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="btn"
            disabled={asrChecking}
            onClick={() => void checkAsr()}
          >
            {asrChecking ? '检查中…' : '检查语音环境'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>数据</h3>
        <div className="settings-row settings-row-vertical">
          <span className="settings-label">数据目录</span>
          <code className="settings-path">{info?.dataDir ?? '加载中…'}</code>
        </div>
        <p className="settings-note">
          每次启动自动备份，保留最近 5 份。当前版本 {info?.version ?? '—'}。
        </p>
        <div className="settings-row">
          <span className="settings-label">维护</span>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => void handleOpenDataDir()}>
              打开数据目录
            </button>
            <button type="button" className="btn" onClick={() => void handleOpenBackupDir()}>
              打开备份目录
            </button>
            <button type="button" className="btn" onClick={() => void handleVerifyBackup()}>
              校验最近备份
            </button>
            <button type="button" className="btn" onClick={() => void handleVerifyAllBackups()}>
              校验全部备份
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handleRestoreBackup()}
            >
              恢复最近备份
            </button>
            <button type="button" className="btn" onClick={() => void handleBackup()}>
              立即备份
            </button>
          </div>
        </div>
        <p className="settings-note">
          升级加密存储前的旧备份可能含明文密钥；确认新版本同步正常后，可清理备份目录里的旧文件。
          恢复最近备份会先校验、保存当前库安全副本，再替换并重启应用。
        </p>
        <div className="settings-row">
          <span className="settings-label">导出</span>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => void handleExport('json')}>
              JSON
            </button>
            <button type="button" className="btn" onClick={() => void handleExport('csv')}>
              CSV
            </button>
            <button type="button" className="btn" onClick={() => void handleExport('ics')}>
              ICS
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">导入</span>
          <button type="button" className="btn" onClick={() => void handleImport()}>
            导入 JSON
          </button>
        </div>
        <p className="settings-note">导入按 ID 合并，已存在的记录会跳过，不会删除现有数据。</p>
      </section>

      <section className="settings-section">
        <h3>同步（Cloudflare R2）</h3>
        <div className="sync-grid">
          <label className="field sync-grid-wide">
            <span className="field-label">Endpoint</span>
            <input
              className="input"
              value={r2.endpoint}
              placeholder="https://<account>.r2.cloudflarestorage.com"
              onChange={(event) => setR2({ ...r2, endpoint: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Bucket</span>
            <input
              className="input"
              value={r2.bucket}
              placeholder="tickflow"
              onChange={(event) => setR2({ ...r2, bucket: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">前缀</span>
            <input
              className="input"
              value={r2.prefix}
              placeholder="tickflow/snapshots/"
              onChange={(event) => setR2({ ...r2, prefix: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Access Key ID</span>
            <input
              className="input"
              value={r2.accessKeyId}
              onChange={(event) => setR2({ ...r2, accessKeyId: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Secret Access Key</span>
            <input
              className="input"
              type="password"
              value={r2.secretAccessKey}
              onChange={(event) =>
                setR2({ ...r2, secretAccessKey: event.target.value })
              }
            />
          </label>
        </div>
        <div className="settings-row">
          <span className="settings-label">启动时自动同步</span>
          <button
            type="button"
            className={`switch ${r2.autoSync ? 'on' : ''}`}
            role="switch"
            aria-checked={r2.autoSync}
            onClick={() => setR2({ ...r2, autoSync: !r2.autoSync })}
          >
            <span />
          </button>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => void saveSync()}>
            保存配置
          </button>
          <button type="button" className="btn" onClick={() => void testConnection()}>
            测试连接
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void runSync()}>
            立即同步
          </button>
          <button
            type="button"
            className="btn"
            disabled={usageBusy}
            onClick={() => void checkUsage()}
          >
            {usageBusy ? '查询中…' : '查看用量'}
          </button>
        </div>
        <p className="settings-note">
          上次同步：
          {settings.r2LastSync ? formatDateTime(settings.r2LastSync) : '从未'}。
          R2 密钥保存在本机数据库，建议使用仅限该桶的 API Token。
        </p>
        <p className="settings-note">
          仅同步清单与任务；每台设备覆盖写一份快照，单份上限 5 MiB，正常使用远低于 R2 免费额度。
        </p>
        {usage ? (
          <p className="settings-note">
            云端 {usage.objects} 份快照 · {(usage.bytes / 1024).toFixed(1)} KB（R2 免费额度 10GB、每月 100 万 Class A / 1000 万 Class B）
          </p>
        ) : null}
        <p className="settings-note">
          Android 端需要给 R2 桶配置 CORS（允许 https://localhost）。
          <button type="button" className="btn sync-copy" onClick={() => void copyCors()}>
            复制 CORS 配置
          </button>
        </p>
      </section>

      <section className="settings-section">
        <h3>快捷键</h3>
        <div className="shortcut-list">
          <div>
            <span>快速添加</span>
            <kbd>Ctrl</kbd>
            <kbd>N</kbd>
          </div>
          <div>
            <span>搜索</span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </div>
          <div>
            <span>全局快速添加</span>
            <kbd>Ctrl</kbd>
            <kbd>Shift</kbd>
            <kbd>N</kbd>
          </div>
          <div>
            <span>关闭面板</span>
            <kbd>Esc</kbd>
          </div>
        </div>
      </section>

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => close(false)}>
          完成
        </button>
      </div>
    </Modal>
  )
}
