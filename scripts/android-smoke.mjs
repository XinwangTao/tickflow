#!/usr/bin/env node
// 真机稳定性冒烟：通过 Android WebView 远程调试执行增删改循环。
// 用法：npm run test:android -- [--cycles=10] [--offline=3] [--serial=<adb序列号>] [--port=9333]
import { execFileSync } from 'node:child_process'

const args = new Map(
  process.argv.slice(2).map((item) => {
    const [key, value = ''] = item.replace(/^--/, '').split('=')
    return [key, value]
  })
)
const cycles = Number(args.get('cycles') ?? 10)
const offlineCycles = Number(args.get('offline') ?? 3)
const port = Number(args.get('port') ?? 9333)
let selectedSerial = args.get('serial') ?? ''

function adb(adbArgs, options = {}) {
  const full = selectedSerial ? ['-s', selectedSerial, ...adbArgs] : adbArgs
  return execFileSync('adb', full, { encoding: 'utf8', timeout: 15_000, ...options })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deviceSerial() {
  if (selectedSerial) return selectedSerial
  const lines = adb(['devices'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices') && line.endsWith('device'))
  if (lines.length === 0) throw new Error('没有在线的 adb 设备')
  selectedSerial = lines[0].split(/\s+/)[0]
  return selectedSerial
}

async function ensureApp() {
  adb(['shell', 'am', 'start', '-n', 'com.tickflow.mobile/.MainActivity'])
  for (let index = 0; index < 20; index += 1) {
    const pid = adb(['shell', 'pidof com.tickflow.mobile']).trim()
    if (pid) return pid
    await sleep(250)
  }
  throw new Error('应用未能启动')
}

let ws = null
let nextId = 0
let pending = new Map()
let offlineMode = false
const exceptions = []

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error(`CDP 未连接：${method}`))
      return
    }
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP 超时：${method}`))
    }, 10_000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text)
  }
  return response.result?.result?.value
}

async function waitFor(expression, timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return
    await sleep(60)
  }
  throw new Error(`等待超时：${expression}`)
}

async function setOffline(offline) {
  offlineMode = offline
  await send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1
  })
}

async function initPage() {
  await evaluate(`(() => {
    const nav = [...document.querySelectorAll('.nav-item')].find((item) => item.textContent?.includes('今天'));
    nav?.click();
  })()`)
  await sleep(500)
  await evaluate(`(() => {
    const toggle = document.querySelector('.completed-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  })()`)
  await sleep(200)
}

async function connect() {
  if (ws) {
    try {
      ws.close()
    } catch {
      // ignore
    }
  }
  const pid = await ensureApp()
  try {
    adb(['forward', '--remove', `tcp:${port}`])
  } catch {
    // 没有旧转发时 adb 会返回非零，忽略
  }
  adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`])

  let page = null
  for (let index = 0; index < 20; index += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(3000)
        })
      ).json()
      page = targets.find((target) => target.type === 'page')
      if (page) break
    } catch {
      // devtools 尚未就绪
    }
    await sleep(250)
  }
  if (!page) throw new Error('无法连接 WebView 远程调试（检查无线调试与应用前台状态）')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  nextId = 0
  pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params?.exceptionDetails?.text ?? 'exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      exceptions.push(
        (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
      )
    }
  }
  await Promise.race([
    new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    }),
    sleep(8000).then(() => {
      ws?.close()
      throw new Error('WebView 调试连接超时')
    })
  ])
  await send('Runtime.enable')
  await send('Network.enable')
  if (offlineMode) await setOffline(true)
  await initPage()
}

const theSerial = deviceSerial()
console.log('device', theSerial)

const prefix = `smoke-${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6) || 'ab'}`

async function openCompleted() {
  await evaluate(`(() => {
    const toggle = document.querySelector('.completed-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  })()`)
  await sleep(150)
}

async function cleanupTitle(title) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await openCompleted()
    if (await evaluate(`Boolean(${rowExpr('.content', title)})`)) {
      await evaluate(`(${rowExpr('.content', title)})?.querySelector('.task-check')?.click()`)
      await sleep(400)
      continue
    }
    if (await evaluate(`Boolean(${rowExpr('.completed-list', title)})`)) {
      await evaluate(`(${rowExpr('.completed-list', title)})?.click()`)
      await waitFor(`document.querySelector('.sheet-actions .icon-btn.danger')`)
      await evaluate(`document.querySelector('.sheet-actions .icon-btn.danger')?.click()`)
      await sleep(400)
      continue
    }
    return
  }
}

function ensureForeground() {
  const focus =
    adb(['shell', 'dumpsys', 'window'])
      .split('\n')
      .find((line) => line.includes('mCurrentFocus')) ?? ''
  if (!focus.includes('com.tickflow.mobile')) {
    adb(['shell', 'am', 'start', '-n', 'com.tickflow.mobile/.MainActivity'])
  }
}

function rowExpr(scope, title) {
  return `[...document.querySelectorAll('${scope} .task-row')].find((row) => row.querySelector('.task-title')?.textContent === ${JSON.stringify(
    title
  )})`
}

async function runCycle(index) {
  ensureForeground()
  const title = `${prefix}-${String.fromCharCode(96 + index)}`
  await cleanupTitle(title)
  await evaluate(`document.querySelector('.fab')?.click()`)
  await waitFor(`document.querySelector('.quick-input')`)
  await evaluate(`(() => {
    const input = document.querySelector('.quick-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`)
  await waitFor(rowExpr('.content', title))
  await evaluate(`(${rowExpr('.content', title)})?.querySelector('.task-check')?.click()`)
  await evaluate(`(() => {
    const toggle = document.querySelector('.completed-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  })()`)
  await waitFor(rowExpr('.completed-list', title))
  await evaluate(`(${rowExpr('.completed-list', title)})?.click()`)
  await waitFor(`document.querySelector('.sheet-actions .icon-btn.danger')`)
  await evaluate(`document.querySelector('.sheet-actions .icon-btn.danger')?.click()`)
  await waitFor(`!(${rowExpr('.completed-list', title)})`)
}

async function runWithRetry(index) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await runCycle(index)
      return
    } catch (error) {
      console.warn(`cycle ${index} attempt ${attempt} failed:`, error.message)
      await sleep(500)
      await connect()
    }
  }
  throw new Error(`cycle ${index} failed after retries`)
}

await connect()
adb(['logcat', '-c'])
for (let index = 1; index <= cycles; index += 1) {
  await runWithRetry(index)
  console.log('online', index, '/', cycles)
}

if (offlineCycles > 0) {
  await setOffline(true)
  for (let index = cycles + 1; index <= cycles + offlineCycles; index += 1) {
    await runWithRetry(index)
    console.log('offline', index)
  }
  await setOffline(false)
}

for (let index = 1; index <= cycles + offlineCycles; index += 1) {
  try {
    await cleanupTitle(`${prefix}-${String.fromCharCode(96 + index)}`)
  } catch {
    // 清理失败不阻断结果统计，结束时统一报告残留
  }
}

let stateJson = 'unavailable'
for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    stateJson = await evaluate(`JSON.stringify({
      title: document.querySelector('.topbar h1')?.textContent,
      leftovers: [...document.querySelectorAll('.task-title')].filter((node) => node.textContent?.startsWith(${JSON.stringify(
        prefix
      )})).length
    })`)
    break
  } catch (error) {
    console.warn(`state read attempt ${attempt} failed:`, error.message)
    await sleep(500)
    await connect()
  }
}
console.log('state', stateJson)

ws?.close()
await sleep(300)

const logcat = adb(['logcat', '-d', '-v', 'brief'])
const fatal = logcat
  .split('\n')
  .filter((line) => /FATAL EXCEPTION|AndroidRuntime.*(FATAL|crash)/i.test(line))

if (exceptions.length > 0) {
  console.error('JS exceptions:', exceptions.slice(0, 5))
  process.exit(1)
}
if (fatal.length > 0) {
  console.error('logcat fatal:', fatal.slice(0, 5))
  process.exit(1)
}
console.log('PASS', `${cycles} 轮在线 + ${offlineCycles} 轮离线，无 JS 异常、无 FATAL`)
