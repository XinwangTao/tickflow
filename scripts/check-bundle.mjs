#!/usr/bin/env node
// 构建产物体积与运行时依赖检查。先执行 `npm run build`，再执行 `npm run check:bundle`。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const buildFiles = pkg.build?.files ?? []
const dependencies = Object.keys(pkg.dependencies ?? {})

const KB = 1024
const budgets = {
  'out/main/index.js': 220 * KB,
  'out/preload/index.js': 16 * KB
}
const rendererBudget = {
  js: 1400 * KB,
  css: 90 * KB
}

function sizeOf(path) {
  try {
    return statSync(path).size
  } catch {
    console.error(`缺少构建产物 ${path}，请先运行 npm run build`)
    process.exit(1)
  }
}

const rows = []
const failures = []
for (const [file, budget] of Object.entries(budgets)) {
  const size = sizeOf(join(root, file))
  rows.push({ file, size, budget })
  if (size > budget) failures.push(`${file} ${(size / KB).toFixed(1)} KB 超过预算 ${(budget / KB).toFixed(0)} KB`)
}

const assetsDir = join(root, 'out/renderer/assets')
const assets = readdirSync(assetsDir)
const rendererSizes = { js: 0, css: 0 }
for (const name of assets) {
  const size = statSync(join(assetsDir, name)).size
  if (name.endsWith('.js')) rendererSizes.js += size
  else if (name.endsWith('.css')) rendererSizes.css += size
}
rows.push({ file: 'out/renderer/assets/*.js', size: rendererSizes.js, budget: rendererBudget.js })
rows.push({ file: 'out/renderer/assets/*.css', size: rendererSizes.css, budget: rendererBudget.css })
if (rendererSizes.js > rendererBudget.js) {
  failures.push(`renderer JS ${(rendererSizes.js / KB).toFixed(1)} KB 超过预算 ${(rendererBudget.js / KB).toFixed(0)} KB`)
}
if (rendererSizes.css > rendererBudget.css) {
  failures.push(`renderer CSS ${(rendererSizes.css / KB).toFixed(1)} KB 超过预算 ${(rendererBudget.css / KB).toFixed(0)} KB`)
}

// 主进程/预加载里保留的 require() 是运行期真实依赖，必须同时满足：
// 1) 在 package.json dependencies 中（electron-builder 才会收集）；
// 2) 没有被 build.files 排除（否则安装包里会缺模块）。
const excluded = new Set()
for (const pattern of buildFiles) {
  const match = pattern.match(/^!node_modules\/(.+?)(?:\/\*\*)?$/)
  if (match) excluded.add(match[1])
}
for (const file of ['out/main/index.js', 'out/preload/index.js']) {
  const source = readFileSync(join(root, file), 'utf8')
  for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier === 'electron') continue
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!dependencies.includes(name)) failures.push(`${file} require("${name}")，但 package.json dependencies 中没有它`)
    if (excluded.has(name)) failures.push(`${file} require("${name}")，但 build.files 排除了它`)
  }
}

console.log('构建产物体积：')
for (const row of rows) {
  const ratio = ((row.size / row.budget) * 100).toFixed(0)
  console.log(`  ${row.file.padEnd(28)} ${(row.size / KB).toFixed(1).padStart(8)} KB / ${(row.budget / KB).toFixed(0)} KB (${ratio}%)`)
}

if (failures.length > 0) {
  console.error('\n打包检查失败：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\n打包检查通过：体积在预算内，主进程运行时依赖完整。')
