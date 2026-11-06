# 打包与产物体积

Electron 桌面端由 electron-vite 一次性打包 main / preload / renderer 三份产物，
electron-builder 再按 `package.json` 的 `dependencies` 把生产依赖复制进 `app.asar`。
如果渲染进程依赖已经被 Vite 打进 JS chunk，再复制一份 `node_modules` 就是纯浪费；
反过来，主进程产物里保留的 `require()` 又必须能在 asar 里找到。这份文档记录两边的边界与检查方式。

## 1. 依赖分类

判断依据是源码里的引用位置，而不是“看起来像前端库”：

| 类别 | 当前依赖 | 处理方式 |
| --- | --- | --- |
| 主进程/共享代码运行时依赖（构建产物保留 `require()`） | `rrule`（`src/main/db/tasks.ts`）、`aws4fetch`（`src/shared/sync.ts`）、`tslib`（`rrule` 的传递依赖） | 保留在 `dependencies`，正常进入 `app.asar` |
| 只在渲染进程使用（Vite 已打进 renderer chunk） | `react`、`react-dom`、`scheduler`、`framer-motion`、`motion-dom`、`motion-utils`、`zustand` | 仍在 `dependencies` 中声明，但通过 `build.files` 的否定规则排除出安装包 |
| 完全没有被引用 | 已移除：`chrono-node`、`date-fns` | 直接从 `dependencies` 删除 |

`build.files` 片段：

```json
"files": [
  "out/**/*",
  "package.json",
  "!node_modules/react/**",
  "!node_modules/react-dom/**",
  "!node_modules/scheduler/**",
  "!node_modules/framer-motion/**",
  "!node_modules/motion-dom/**",
  "!node_modules/motion-utils/**",
  "!node_modules/zustand/**"
]
```

`tslib` 同时被 `framer-motion` 和 `rrule` 依赖，因此**不能**排除：主进程运行 `rrule` 时需要它。
新增依赖时按同样规则判断：只在 `src/renderer` 引用 → 加排除规则；在 `src/main`、`src/preload`
或 `src/shared` 引用 → 必须留在 asar 中。

## 2. 体积变化

在同一台机器、同一版 Electron 45.2.3 下测量：

| 指标 | 调整前 | 调整后 | 变化 |
| --- | --- | --- | --- |
| `resources/app.asar` | 36 MB | 2.2 MB | -33.8 MB |
| asar 内 `node_modules` | 45 MB | 0.93 MB | 只保留 `rrule`、`tslib`、`aws4fetch` |
| 安装后占用（`win-unpacked`） | 393 MB | 360 MB | -33 MB |
| NSIS 安装包 | 125.2 MB | 121.7 MB | -3.6 MB |

安装包压缩率较高，所以安装包只减少约 3.6 MB；但安装到本地后的磁盘占用减少约 33 MB，
并且启动时不再解压/映射二十多 MB 永远用不到的包。

## 3. 自动检查

### 3.1 Vitest 依赖边界用例

`tests/packaging.test.ts` 不依赖构建产物，`npm test` 每次都会跑：

1. **没有僵尸依赖**：`dependencies` 里每个包都必须在 `src/**/*.ts(x)` 中被 import/require，
   否则提示删除（曾经的 `chrono-node`、`date-fns` 会被这条用例拦下）。
2. **渲染进程依赖不进 asar**：计算“只在 `src/renderer` 使用”的依赖及其传递依赖，
   要求 `build.files` 中存在对应的 `!node_modules/<pkg>/**`。
3. **主进程依赖不被排除**：`src/main`、`src/preload`、`src/shared` 用到的依赖及其传递依赖
   （如 `tslib`）不能出现在排除列表里。
4. **基础打包规则仍在**：`out/**/*` 与 `package.json` 必须保留。

### 3.2 构建产物体积预算

```bash
npm run build
npm run check:bundle
```

`scripts/check-bundle.mjs` 会打印体积并检查预算，超出即失败退出：

| 产物 | 预算 |
| --- | --- |
| `out/main/index.js` | 220 KB |
| `out/preload/index.js` | 16 KB |
| `out/renderer/assets/*.js` | 1400 KB |
| `out/renderer/assets/*.css` | 90 KB |

它还会扫描 main / preload 产物里的 `require("...")`：每个裸包名都必须出现在
`dependencies` 中，且没有被 `build.files` 排除，避免“代码能构建、安装后缺模块”。
`npm run dist` 已改为 `build → check:bundle → electron-builder`，打包前自动拦截。

## 4. 验证命令

```bash
npm run typecheck
npm test                                   # 含 tests/packaging.test.ts
npm run build && npm run check:bundle
npx electron-builder --dir --config.directories.output=.tmp-release
npx electron-builder --win --config.directories.output=.tmp-release
npm run test:e2e
```

打包产物冒烟（使用临时用户目录，不读写真实数据库）：

```js
// Playwright，_electron.launch({ executablePath: '.tmp-release/win-unpacked/刻度清单.exe',
//   env: { ...process.env, TICKFLOW_USER_DATA: 临时目录 } })
// 断言 .main-title 为「今天」、日历视图出现 .calendar-grid、快速添加框出现 .quick-add-input。
```

本轮已用上述方式启动打包后的 `刻度清单.exe`，确认精简 asar 后主进程仍能加载
`rrule` / `aws4fetch`，今天、日历与快速添加均正常。
