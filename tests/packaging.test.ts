import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  build?: { files?: string[] }
}

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson
const dependencies = Object.keys(pkg.dependencies ?? {})
const buildFiles = pkg.build?.files ?? []

/**
 * 依赖安装后由 electron-builder 打进 app.asar，即使代码里已经通过 Vite 打包过一次。
 * 因此这里把「源码里实际引用到的生产依赖」与「打包排除规则」对齐：
 * - 渲染进程依赖会被 Vite 打进 renderer chunk，不应该再进 asar；
 * - 主进程/共享代码的依赖会在构建产物里保留 require()，必须留在 asar；
 * - 完全没被引用的生产依赖直接算失败，防止安装包和安装体积悄悄变大。
 */

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) files.push(full)
  }
  return files
}

function importedSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers: string[] = []
  const pattern =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

function packageName(specifier: string): string | null {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@shared') ||
    specifier.startsWith('@renderer') ||
    specifier.startsWith('node:') ||
    specifier === 'electron' ||
    specifier.startsWith('electron/')
  ) {
    return null
  }
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? parts.slice(0, 2).join('/') : null
  return parts[0] ?? null
}

const usedBy = new Map<string, Set<'renderer' | 'node'>>()
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  const location: 'renderer' | 'node' = rel.split(sep).includes('renderer') ? 'renderer' : 'node'
  for (const specifier of importedSpecifiers(file)) {
    const name = packageName(specifier)
    if (!name) continue
    const locations = usedBy.get(name) ?? new Set()
    locations.add(location)
    usedBy.set(name, locations)
  }
}

function directDependencies(name: string): string[] {
  try {
    const json = JSON.parse(
      readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> }
    return Object.keys(json.dependencies ?? {})
  } catch {
    return []
  }
}

function dependencyClosure(seeds: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    queue.push(...directDependencies(name))
  }
  return seen
}

function excludedPackages(): Set<string> {
  const excluded = new Set<string>()
  for (const pattern of buildFiles) {
    const match = pattern.match(/^!node_modules\/(.+?)(?:\/\*\*)?$/)
    if (match) excluded.add(match[1])
  }
  return excluded
}

const rendererOnly = dependencies.filter((name) => {
  const locations = usedBy.get(name)
  return locations !== undefined && locations.size === 1 && locations.has('renderer')
})
const nodeDependencies = dependencies.filter((name) => !rendererOnly.includes(name))
const rendererClosure = dependencyClosure(rendererOnly)
const runtimeClosure = dependencyClosure(nodeDependencies)
const excluded = excludedPackages()

describe('依赖与打包边界', () => {
  it('每个生产依赖都被源码实际引用', () => {
    for (const name of dependencies) {
      expect(
        usedBy.has(name),
        `生产依赖 ${name} 未被 src 引用，应从 dependencies 移除，避免被 electron-builder 打进安装包`
      ).toBe(true)
    }
  })

  it('只在渲染进程使用的依赖不会进入 app.asar', () => {
    const bundledOnly = [...rendererClosure].filter((name) => !runtimeClosure.has(name))
    expect(bundledOnly.length).toBeGreaterThan(0)
    for (const name of bundledOnly) {
      expect(
        excluded.has(name),
        `${name} 已被 Vite 打进 renderer chunk，应在 build.files 中排除（!node_modules/${name}/**）`
      ).toBe(true)
    }
  })

  it('主进程与共享代码的运行时依赖不会被排除', () => {
    for (const name of runtimeClosure) {
      expect(
        excluded.has(name),
        `${name} 在主进程/共享代码中 require，必须保留在 app.asar 中`
      ).toBe(false)
    }
  })

  it('electron-builder 仍会打包构建产物与 package.json', () => {
    expect(buildFiles).toContain('out/**/*')
    expect(buildFiles).toContain('package.json')
  })
})
