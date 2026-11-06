#!/usr/bin/env node
// A11/A12 真机稳定性：在页面内一次跑完增删改循环，减少 CDP 往返。
// 用法：node scripts/android-smoke-inpage.mjs --serial=<adb> --cycles=20 --offline=3
import { execFileSync } from 'node:child_process'

const args = new Map(
  process.argv.slice(2).map((item) => {
    const [key, value = ''] = item.replace(/^--/, '').split('=')
    return [key, value]
  })
)
const serial = args.get('serial') ?? ''
const cycles = Number(args.get('cycles') ?? 20)
const offlineCycles = Number(args.get('offline') ?? 3)
const port = Number(args.get('port') ?? 9444)

function adb(argv, options = {}) {
  return execFileSync('adb', serial ? ['-s', serial, ...argv] : argv, {
    encoding: 'utf8',
    ...options
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function ensureApp() {
  adb(['shell', 'input', 'keyevent', '224'])
  adb(['shell', 'am', 'start', '-n', 'com.tickflow.mobile/.MainActivity'])
  for (let index = 0; index < 20; index += 1) {
    const pid = adb(['shell', 'pidof', 'com.tickflow.mobile']).trim()
    if (pid) return pid
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
  throw new Error('应用未能启动')
}

const pid = ensureApp()
try { adb(['forward', '--remove', `tcp:${port}`]) } catch {}
adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`])

let target = null
for (let index = 0; index < 20; index += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((item) => item.type === 'page')
    if (target) break
  } catch {}
  await sleep(250)
}
if (!target) throw new Error('无法连接 WebView 远程调试')

const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const exceptions = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve(message)
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
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

function send(method, params = {}, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP 超时：${method}`))
    }, timeout)
    pending.set(id, { resolve, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, timeout = 180_000) {
  const response = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    timeout
  )
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text ?? '页面内异常')
  }
  return response.result?.result?.value
}

function cycleExpression(prefix, startIndex, count) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const q = (selector) => document.querySelector(selector);
    const clickText = (selector, text) => {
      const nodes = [...document.querySelectorAll(selector)];
      const target = nodes.find((node) => (node.textContent || '').includes(text));
      if (!target) return false;
      target.click();
      return true;
    };
    const titleOf = (row) => row?.querySelector('.task-title')?.textContent?.trim();
    const findRow = (scope, title) => [...document.querySelectorAll(scope + ' .task-row')].find((row) => titleOf(row) === title);
    async function waitFor(fn, ms = 6000) {
      const started = Date.now();
      while (Date.now() - started < ms) {
        const value = fn();
        if (value) return value;
        await sleep(50);
      }
      throw new Error('等待超时：' + prefix + ' #' + startIndex);
    }
    clickText('.nav-item', '今天');
    await sleep(300);
    for (let index = ${startIndex}; index < ${startIndex + count}; index += 1) {
      const title = ${JSON.stringify(prefix)} + '-' + String.fromCharCode(96 + index);
      document.querySelectorAll('.sheet-overlay').forEach((el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
      await sleep(80);
      q('.fab')?.click();
      await waitFor(() => q('.quick-input'));
      const input = q('.quick-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => findRow('.content', title));
      findRow('.content', title).querySelector('.task-check')?.click();
      await sleep(200);
      const toggle = q('.completed-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
      await waitFor(() => findRow('.completed-list', title));
      findRow('.completed-list', title).click();
      await waitFor(() => q('.sheet-actions .icon-btn.danger'));
      q('.sheet-actions .icon-btn.danger').click();
      await waitFor(() => !findRow('.completed-list', title));
      await sleep(100);
    }
    await sleep(300);
    const leftovers = [...document.querySelectorAll('.task-title')].filter((node) => (node.textContent || '').startsWith(${JSON.stringify(prefix)})).length;
    return { ok: true, prefix: ${JSON.stringify(prefix)}, done: ${startIndex + count - 1}, leftovers };
  })()`
}

adb(['logcat', '-c'])
await send('Runtime.enable')
await send('Network.enable')

const prefix = `smoke-${Math.random().toString(36).replace(/[0-9]/g, '').slice(0, 6) || 'ab'}`
console.log('device', serial || '(default)', 'pid', pid, 'prefix', prefix)

const online = await evaluate(cycleExpression(prefix, 1, cycles))
console.log('online', JSON.stringify(online))

let offline = null
if (offlineCycles > 0) {
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  })
  offline = await evaluate(cycleExpression(`${prefix}off`, 1, offlineCycles))
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  })
  console.log('offline', JSON.stringify(offline))
}

ws.close()
await sleep(300)
const logcat = adb(['logcat', '-d', '-v', 'brief'])
const fatal = logcat
  .split('\n')
  .filter((line) => /FATAL EXCEPTION|AndroidRuntime.*(FATAL|crash)/i.test(line))

console.log('exceptions', exceptions.length, 'fatal', fatal.length)
if (exceptions.length) console.error(exceptions.slice(0, 5))
if (fatal.length) console.error(fatal.slice(0, 5))
if (!online?.ok || (offlineCycles > 0 && !offline?.ok) || exceptions.length || fatal.length) {
  process.exit(1)
}
console.log('PASS', `${cycles} 轮在线 + ${offlineCycles} 轮离线，无 JS 异常、无 FATAL`)
