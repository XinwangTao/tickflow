import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  AI_QUICK_ADD_SYSTEM,
  buildQuickAddPrompt,
  mergeQuickAddWithRule,
  normalizeAiQuickAdd,
  parseAiJson,
  ruleQuickAdd
} from '@shared/ai'
import type { QuickAddResult } from '@shared/quick-add'
import { getSetting, saveSettings } from './db'

/** 云端默认走 OpenAI 兼容接口（与雅思 App 的云端通道同格式）。 */
export const AI_CLOUD_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const AI_CLOUD_DEFAULT_MODEL = 'glm-4-flash'
/** 本地默认模型目录名（对应 /sdcard/Android/data/com.tickflow.mobile/files/models/mnn/<name>）。 */
export const AI_LOCAL_DEFAULT_MODEL = 'qwen35-2b'
export const AI_DEFAULT_TIMEOUT_MS = 120_000

export type AiChannel = 'local' | 'cloud' | 'auto'

export interface MobileAiConfig {
  enabled: boolean
  channel: AiChannel
  cloudBaseUrl: string
  cloudApiKey: string
  cloudModel: string
  localModel: string
  timeoutMs: number
}

export interface LocalAiStatus {
  loaded: boolean
  model: string | null
  externalModels: string[]
  internalModels: string[]
}

interface LocalAiPlugin {
  status(): Promise<LocalAiStatus>
  load(options: { model: string; maxTokens?: number }): Promise<{ loaded: boolean; model: string; ms: number }>
  generate(options: { prompt: string }): Promise<{ text: string; ms: number }>
  cancel(): Promise<void>
  unload(): Promise<void>
}

const LocalAi = registerPlugin<LocalAiPlugin>('LocalAi')

export function isLocalAiSupported(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export async function getAiConfig(): Promise<MobileAiConfig> {
  const [enabled, channel, cloudBaseUrl, cloudApiKey, cloudModel, localModel, timeoutMs] =
    await Promise.all([
      getSetting('aiEnabled'),
      getSetting('aiChannel'),
      getSetting('aiCloudBaseUrl'),
      getSetting('aiCloudApiKey'),
      getSetting('aiCloudModel'),
      getSetting('aiLocalModel'),
      getSetting('aiTimeoutMs')
    ])
  return {
    enabled: enabled !== '0',
    channel: (channel as AiChannel) || 'local',
    cloudBaseUrl: cloudBaseUrl || AI_CLOUD_DEFAULT_BASE_URL,
    cloudApiKey: cloudApiKey || '',
    cloudModel: cloudModel || AI_CLOUD_DEFAULT_MODEL,
    localModel: localModel || AI_LOCAL_DEFAULT_MODEL,
    timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : AI_DEFAULT_TIMEOUT_MS
  }
}

export async function saveAiConfig(config: Partial<MobileAiConfig>): Promise<void> {
  const patch: Record<string, string> = {}
  if (config.enabled !== undefined) patch.aiEnabled = config.enabled ? '1' : '0'
  if (config.channel !== undefined) patch.aiChannel = config.channel
  if (config.cloudBaseUrl !== undefined) patch.aiCloudBaseUrl = config.cloudBaseUrl.trim()
  if (config.cloudApiKey !== undefined) patch.aiCloudApiKey = config.cloudApiKey.trim()
  if (config.cloudModel !== undefined) patch.aiCloudModel = config.cloudModel.trim()
  if (config.localModel !== undefined) patch.aiLocalModel = config.localModel.trim()
  if (config.timeoutMs !== undefined) patch.aiTimeoutMs = String(config.timeoutMs)
  await saveSettings(patch)
}

/** 云端 OpenAI 兼容 chat/completions 地址；允许用户直接填完整地址。 */
export function cloudChatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  return `${base}/chat/completions`
}

async function generateCloud(
  config: MobileAiConfig,
  system: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  if (!config.cloudApiKey) throw new Error('未填写云端 API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(cloudChatUrl(config.cloudBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.cloudApiKey}`
      },
      body: JSON.stringify({
        model: config.cloudModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`云端返回 ${response.status}${raw ? `：${raw.slice(0, 160)}` : ''}`)
    }
    const parsed = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = parsed.choices?.[0]?.message?.content
    if (!text) throw new Error('云端返回内容为空')
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function generateLocal(prompt: string, model: string): Promise<string> {
  if (!isLocalAiSupported()) throw new Error('当前环境不支持端侧模型')
  await LocalAi.load({ model })
  const result = await LocalAi.generate({ prompt })
  return result.text
}

export interface AiGenerateResult {
  text: string
  source: 'local' | 'cloud'
}

/** 按通道生成：local 仅本地、cloud 仅云端、auto 先云端失败回退本地。 */
export async function generateAi(
  config: MobileAiConfig,
  system: string,
  prompt: string,
  maxTokens: number
): Promise<AiGenerateResult> {
  const channel = config.channel
  if (channel === 'local') {
    return { text: await generateLocal(`${system}\n\n${prompt}`, config.localModel), source: 'local' }
  }
  if (channel === 'cloud') {
    return { text: await generateCloud(config, system, prompt, maxTokens), source: 'cloud' }
  }
  try {
    return { text: await generateCloud(config, system, prompt, maxTokens), source: 'cloud' }
  } catch (error) {
    console.warn('云端失败，回退本地模型', error)
    return { text: await generateLocal(`${system}\n\n${prompt}`, config.localModel), source: 'local' }
  }
}

export interface AiQuickAddOutcome {
  ok: boolean
  result: QuickAddResult
  source: 'ai' | 'rule'
  channel: AiChannel
  warning: string | null
}

/**
 * 快速添加 AI 解析：失败时回落到本地规则解析（不在创建任务前阻塞用户）。
 */
export async function aiParseQuickAdd(
  input: string,
  lists: string[],
  now: Date = new Date()
): Promise<AiQuickAddOutcome> {
  const config = await getAiConfig()
  const rule = ruleQuickAdd(input, now)
  if (!config.enabled) {
    return { ok: false, result: rule, source: 'rule', channel: config.channel, warning: 'AI 已关闭' }
  }
  try {
    const prompt = buildQuickAddPrompt(input, { now, lists })
    const generated = await generateAi(config, AI_QUICK_ADD_SYSTEM, prompt, 900)
    const raw = parseAiJson(generated.text)
    const normalized = normalizeAiQuickAdd(raw, now)
    if (!normalized) throw new Error('AI 返回不是有效的任务 JSON')
    return {
      ok: true,
      result: mergeQuickAddWithRule(normalized, rule, now),
      source: 'ai',
      channel: config.channel,
      warning: null
    }
  } catch (error) {
    return {
      ok: false,
      result: rule,
      source: 'rule',
      channel: config.channel,
      warning: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function localAiStatus(): Promise<LocalAiStatus | null> {
  if (!isLocalAiSupported()) return null
  try {
    return await LocalAi.status()
  } catch {
    return null
  }
}

export async function unloadLocalAi(): Promise<void> {
  if (!isLocalAiSupported()) return
  try {
    await LocalAi.unload()
  } catch {
    // 忽略：未加载时无需释放
  }
}
