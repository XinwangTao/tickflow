# TickFlow AI 能力

TickFlow 的 AI 能力全部在 **Electron main 进程**发起请求，renderer 只通过 IPC 调用。
默认对接本机 [CC Switch](http://127.0.0.1:15721) 的 Anthropic 兼容网关，不依赖任何云端密钥。
AI 只提供增强：超时、服务未启动、模型报错或返回结构非法时，立即回落到本地规则，
不会阻塞任务创建或界面操作。

## 1. 默认配置与开关

设置入口：右上角「设置」→「AI 助手（CC Switch）」。

| 设置键 | 默认值 | 说明 |
| --- | --- | --- |
| `aiEnabled` | `true` | AI 总开关。关闭后不发起任何请求，快速添加走规则解析，AI 入口隐藏 |
| `aiBaseUrl` | `http://127.0.0.1:15721` | 网关地址；也兼容填到 `/v1`，客户端会自动补全 `/v1/messages` |
| `aiModel` | `ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash` | 必须与 `/v1/models` 返回的 `id` **逐字一致** |
| `aiToken` | 空 | 可选。非空时同时发送 `x-api-key` 与 `Authorization: Bearer` |
| `aiTimeoutMs` | `15000` | 单次请求超时；范围 1000–120000 毫秒 |

设置保存在本机 SQLite 的 `settings` 表，Token 不会上传或写入日志。

设置页「模型 ID」右侧提供 **获取模型列表**：点击后请求本机 `GET /v1/models`，
把返回的 `id` 原样放进下拉框，避免手工抄写出大小写或分隔符错误。若当前填写的
模型不在目录中，设置页会给出提示。

### 查看本机可用模型

```bash
curl -s http://127.0.0.1:15721/v1/models \
  -H "anthropic-version: 2023-06-01"
```

也可以直接在设置页点「获取模型列表」，无需手动执行命令。

当前环境验证可用的示例 `id`（直接照抄，不要改大小写或分隔符）：

- `ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash`（默认，低延迟）
- `ccs-claude-openai--ccs-claude-openai-2--glm-5.3`
- `ccs-claude-openai--ccs-claude-openai-2--kimi-k2.7-code`
- `ccs-claude-openai--ccs-claude-openai-2--deepseek-v4.1-flash`
- `ccs-claude-openai--ccs-claude-openai-2--qwen3.8-max`

## 2. 接口约定

客户端实现：`src/main/ai-client.ts`。所有功能共用 `POST {baseUrl}/v1/messages`。

请求头：

```http
content-type: application/json
anthropic-version: 2023-06-01
x-api-key: <aiToken，可选>
authorization: Bearer <aiToken，可选>
```

请求体（Anthropic Messages 格式）：

```json
{
  "model": "ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash",
  "max_tokens": 1200,
  "temperature": 0.1,
  "system": "你是任务管理应用 TickFlow 的解析器。你只输出严格 JSON。",
  "messages": [{ "role": "user", "content": "<提示词>" }]
}
```

响应解析兼容 `content: [{ type: "text", text: "..." }]`，会忽略 thinking 块；
也兼容 OpenAI 风格的 `choices[0].message.content` 与纯字符串 `content`。
模型返回的 Markdown 代码块或前后解释文字会被容忍，客户端只提取第一个 JSON 值。

不同功能的 `max_tokens`：快速添加 1200、子任务拆解 1600、今日总结 1600、测试连接 768。
推理模型会先用掉一部分 token 输出 thinking，预算过小时可能只有 thinking、没有正文；
如果响应 `stop_reason` 为 `max_tokens`（或 OpenAI `finish_reason` 为 `length`）且没有
正文，客户端会提示「AI 只返回了推理过程，正文为空（输出预算不足）」，而不是笼统地报空。

非 2xx 响应会抛出 `AI 接口返回 <status>：<前 200 字符>`；超时抛出 `AI 请求超时`。
错误信息最终只用于 toast 与降级原因展示，不会中断操作。

### 模型目录

`GET {baseUrl}/v1/models`，请求头同上。客户端兼容 `{ "data": [...] }` 与纯数组，
只读取 `id`（逐字保留）与可选的 `display_name`，去重后最多返回 200 个。
非 2xx 返回 `AI 模型列表返回 <status>：<前 200 字符>`，超时返回
`AI 模型列表请求超时`；设置页会把这些信息直接展示在 toast 中。

「测试连接」会发送一条 `max_tokens: 768` 的最小请求。推理模型会先输出 thinking
块，预算过小时可能只有 thinking 没有正文，从而误报失败；768 能为 thinking + 简短回复
留出余量，且 `max_tokens` 只是上限，不会强制生成更多内容。

## 3. 三个首批功能

### 3.1 AI 自然语言快速添加

入口：今天 / 最近 7 天 / 收集箱 / 清单视图顶部的快速添加框。

- 普通 `Enter`：始终使用本地 `parseQuickAdd` 规则，零延迟。
- `Ctrl/Cmd + Enter` 或点击输入框右侧 **AI** 按钮：把整句话交给 AI 解析。
- AI 输出字段：`title`、`dueDate`（YYYY-MM-DD）、`dueTime`（HH:mm）、`allDay`、
  `priority`（0–3）、`tags`、`listName`、`recurrence`（RFC5545 RRULE）。
- AI 成功时**不会立即写库**，而是在快速添加框下方展开「AI 解析结果 · 可修改后添加」
  草稿卡：标题、截止日期、时间、优先级、清单、标签、重复、全天都可以改，
  点「添加」或标题框回车才创建任务；点「取消」/`Esc` 放弃本次结果，输入内容仍保留。
  草稿会经过 `draftToQuickAddResult` 再校验一次，非法日期/时间只丢弃该字段。
- 用户主动清空日期时，创建任务不会被当前视图的默认截止日期补回来
  （例如「今天」视图的 AI 草稿删掉日期，任务就是无日期）。
- 添加成功后 toast 显示「AI 已添加「标题」」并提供 **撤销**，点击后把刚创建的任务
  移入垃圾箱并刷新列表；AI 失败回落到规则创建时同样可以撤销，提示里会同时保留失败原因。
- 草稿未处理时按普通 `Enter` 会提示先添加或取消，不会绕过草稿重复建任务。
- 请求期间按钮显示「解析中」，输入框仍可编辑，不会锁住界面。
- 请求期间按钮右侧出现 **取消**，按 `Esc` 同样可以中止：renderer 通过 `ai:cancel` 让
  main 进程中止那次 `fetch`，不必等满 15 秒超时。取消后提示「已取消 AI 解析，输入内容已保留」，
  既不写库也不弹草稿；取消**不触发**自动重试。
- 迟到的结果一律丢弃：每次 AI 请求都带一个自增 `requestId`，取消或重新发起新请求后，
  旧请求的响应即使回来了也不会弹草稿；如果用户在等待期间改写了输入，结果同样被忽略并提示
  「输入已变化，已忽略上一次 AI 解析结果」，避免把上一条任务的解析结果套到新输入上。
- 解析进行中按普通 `Enter` 不再静默失败，而是提示「AI 正在解析，按 Esc 或点「取消」可中止」，
  不会绕过请求重复建任务；切换视图导致快速添加框卸载时，也会顺手中止进行中的请求。
- 结果会再次经过 `normalizeAiQuickAdd` 校验：非法日期/时间被丢弃，优先级夹到 0–3，
  标签去重。`listName` 只有在用户输入中明确出现该清单名（忽略大小写与空白）时才采纳，
  防止模型按任务内容猜一个清单；未采纳时任务留在当前清单。采纳但清单已不存在时，
  回落到当前默认清单并提示。
- AI 结果会与本地 `parseQuickAdd` 结果合并：输入里的 `#标签`、`!高/中/低`、`~清单`
  是用户显式写出的确定性信息，AI 漏掉或改写时以规则解析为准，标题中残留的显式标记
  会被清掉；日期、时间、重复等自然语言字段优先采用 AI 结果，但 AI 返回 null 漏掉时
  会用规则解析补齐。例如模型只返回标题「交周报」，用户输入中的「明天下午3点」仍会
  保留为截止日期与时间，不会被丢掉。
- 本地规则解析同时补强了这些高频写法（AI 不可用时同样生效）：
  `下个月15号` / `本月20号`、`2027年1月1日`、`下个星期天`、`10点到11点`
  （取开始时间）、`每周一三五` / `每周二、周四`（多日 RRULE）、`每月最后一天`、
  `3天后` / `2周后` / `3个月后`。`#工作，` 这类尾随标点、全角 `！高`，以及
  `#工作!高~工作` 连写都能正确拆分；非法日期（如 `2026-02-30`）保持为标题而不是写库。

提示词会带上当前时间、星期与全部可用清单名，并明确要求「只有输入中明确提到清单时才填写
`listName`，不要根据任务内容猜测」，同时要求原样保留 `#标签` / `!优先级` / `~清单`
显式语法，尽量让 AI 输出可直接落库的结构。

### 3.2 AI 拆解子任务

入口：任务详情抽屉 →「子任务」标题右侧的 ✨ 按钮。

- 输入：主任务标题、备注、所属清单，以及**已有子任务标题**；提示词明确要求模型不要重复或改写已有子任务。
- AI 输出：`{"subtasks":[{"title":"...","priority":0}]}`，最多 10 条。
- 客户端会过滤掉与主任务或已有子任务同名（忽略大小写与空白）的条目，去重、去空、限制长度，
  再逐条创建为当前任务的子任务；重复点击 AI 拆解不会重复写入相同子任务。
- 创建成功后 toast 显示本次新增数量并提供 **撤销**，一次移除本批次创建的子任务。
  若 AI 不可用而使用规则拆解，提示里保留失败原因，撤销同样可用。
- 若模型返回的条目全部已存在，提示「AI 返回的子任务均已存在，未重复添加」，不会创建空任务。
- 规则降级：按标题/备注中的换行、分号、逗号/顿号拆分，去掉 `-`、`*`、`1.` 等列表符号；
  同样跳过主任务与已有子任务同名条目；没有可拆内容时提示手动添加。

### 3.3 AI 今日计划总结

入口：「今天」视图快速添加框下方的「AI 今日总结」卡片，点击「生成 / 刷新」才发请求，
不会在启动时自动调用。

- 输入：今日未完成/逾期任务、今日完成任务的标题、状态、优先级、截止日期/时间、清单
  与 `overdue` 标记，以及总数、完成数、逾期数。
- “今日完成”按完成时间的**本地日期**判断（数据库存 UTC ISO，不会因时区偏移把凌晨
  完成的任务算到前一天）；已完成任务只按完成时间纳入，不会因为截止日期是今天而被
  误计为“今日完成”。逾期标记逐条随任务发给 AI，便于生成更准确的建议。
- AI 输出：`{"summary":"...","highlights":["..."],"suggestions":["..."]}`。
- 规则降级：使用本地统计生成确定性文案（完成/剩余/逾期数量、下一个时间点、
  高优先级任务、逾期任务处理建议）。

## 4. 失败重试与超时提示

只对**瞬时故障**自动重试一次（总共 2 次尝试，间隔 200ms），重试在 main 进程内完成，
renderer 只是多等这一小会儿，不会因此重复创建任务：

| 失败情况 | 判定依据 | 自动重试 | 用户看到的提示 |
| --- | --- | --- | --- |
| 连接被拒 / 网络中断 | `ECONNREFUSED`、`ECONNRESET`、`fetch failed` 等 | 是 | `连接不上 AI 服务（127.0.0.1:15721），请确认 CC Switch 已启动 · connect ECONNREFUSED（已自动重试 1 次）` |
| 服务限流 / 服务端错误 | HTTP 408、425、429、5xx | 是 | `AI 服务繁忙，请稍后再试 · AI 接口返回 500：…（已自动重试 1 次）` |
| 请求超时 | 超过 `aiTimeoutMs`，由 `AbortController` 中止 | 否 | `AI 请求超时（15 秒），可在设置里调大超时或换更快的模型` |
| 鉴权失败 | HTTP 401 / 403 | 否 | `AI 鉴权失败，请检查设置里的 Token（本机服务通常留空）` |
| 模型或参数错误 | HTTP 400 / 404 / 422 | 否 | `模型或请求不可用，请在设置页用「获取模型列表」逐字核对模型 ID` |
| 用户主动取消 | `ai:cancel` 中止 `fetch`，或 Esc / 取消按钮 | 否 | 提示「已取消 AI 解析，输入内容已保留」，不写库、不弹草稿 |
| 只有 thinking、没有正文 | `stop_reason=max_tokens` 且正文为空 | 否 | 保留「AI 只返回了推理过程，正文为空（输出预算不足）」 |
| 返回结构无法识别 | 取到 JSON 但字段不合规 | 否 | `AI 返回内容无法解析，已按本地规则处理` |

超时**不重试**是刻意设计：超时已经用满了用户配置的等待时间，再重试一次会让按钮多转一倍，
而连接被拒、5xx 这类错误通常毫秒级返回，重试成本可以忽略。总尝试次数上限 3，
实现见 `src/main/ai-client.ts` 的 `withAiRetry`。

取消与超时都表现为 `AbortError`，客户端用“外部 signal 是否已中止”区分：
外部 signal（`ai:cancel`）中止 → `AiCanceledError`（文案「AI 请求已取消」），
`withAiRetry` 直接结束、不重试、不追加「已自动重试 N 次」；只有内部超时计时器中止
才提示「AI 请求超时」。失败分类里取消是独立的 `canceled` 类型，提示不会引导用户去调大超时。

- 提示文案统一由 `src/shared/ai.ts` 的 `describeAiFailure` 生成：先说明原因（超时秒数、
  服务地址、HTTP 状态），再给出下一步（调大超时、启动 CC Switch、核对模型 ID、检查 Token），
  原始错误附在 `·` 之后便于排查；实际请求超过 1 次时追加「（已自动重试 N 次）」。
  原始错误已被提示覆盖时不会重复拼接。
- 快速添加的 AI 按钮在请求期间显示已等待秒数（`解析中 3s`），悬停提示当前超时上限，
  用户能分清「正在解析」和「界面卡住」。
- 今日总结、子任务拆解的失败 toast 带「重试」按钮，网络恢复后不用重新打开面板；
  快速添加失败时任务已按规则创建，因此只提示原因，不提供重试，避免重复建任务。
- 响应对象新增可选 `attempts` 字段：失败时为实际请求次数，`0` 表示因为关闭 AI 或空输入
  根本没发请求；请求成功（包括重试后成功）也能回报尝试次数，便于测试与后续埋点。
- 设置页「超时（毫秒）」下方写明：超时按单次请求计算、瞬时故障自动重试 1 次、超时不重试。

## 5. 降级策略

| 场景 | 行为 |
| --- | --- |
| `aiEnabled=false` | 不发请求。快速添加走 `parseQuickAdd`；AI 总结卡片与拆解按钮隐藏 |
| 服务未启动 / 连接被拒 | 快速添加用规则解析；拆解用标点/换行规则；总结用本地统计；toast 说明原因与提示地址，并自动重试 1 次 |
| 请求超时 | 同上，超时时间由 `aiTimeoutMs` 控制，默认 15 秒；提示里会写明超时秒数 |
| 非 2xx / 模型不存在 | 5xx 与 429 自动重试 1 次；4xx 不重试；错误摘要进入 toast 与 `warning` 字段 |
| 返回非 JSON 或字段缺失 | `parseAiJson` / `normalize*` 返回 null，按失败降级 |
| 只有 thinking、正文被 `max_tokens` 截断 | 同上；toast 提示「AI 只返回了推理过程，正文为空（输出预算不足）」 |
| 返回日期非法、优先级越界 | 只丢弃非法字段，保留其余合法结果，不整体失败 |
| 快速添加的清单名不存在 | 放入当前默认清单，并提示「未找到清单 X，已放入 Y」 |

所有 IPC 调用均在 `try/catch` 中执行，main 进程不会因 AI 异常崩溃；renderer 的
`try/finally` 会复位 loading 状态，保证按钮可再次点击。

## 6. 代码与测试

| 文件 | 职责 |
| --- | --- |
| `src/shared/ai.ts` | 类型、默认值、提示词、JSON 提取、归一化、规则降级、失败分类与提示文案 |
| `src/shared/quick-add-draft.ts` | AI 快速添加草稿：清单匹配、标签拆分、日期/时间校验、优先级收敛、落库前转换 |
| `src/main/ai-client.ts` | `/v1/messages` 与 `/v1/models` 请求、鉴权头、单次超时、外部取消信号、瞬时故障自动重试、响应文本提取 |
| `src/main/ai.ts` | 三个功能的编排与降级、失败提示与尝试次数、`requestId → AbortController` 注册表、模型列表、连接测试 |
| `src/main/ipc.ts` | `ai:quick-add` / `ai:cancel` / `ai:subtasks` / `ai:summary` / `ai:models` / `ai:test` |
| `src/renderer/src/components/QuickAdd.tsx` | AI 快速添加入口、可编辑结果草稿、取消与过期结果丢弃、添加后撤销 |
| `src/renderer/src/components/DetailDrawer.tsx` | AI 拆解子任务入口、批量添加后撤销 |
| `src/renderer/src/components/AiDailySummary.tsx` | 今日总结卡片 |
| `src/renderer/src/components/SettingsDialog.tsx` | AI 配置与连接测试 |
| `tests/quick-add-regression.test.ts` | 快速添加准确率回归集：50+ 条规则用例 + AI 解析/归一化/合并用例 + 失败与请求契约 |
| `tests/ai-cancel.test.ts` | 取消：取消与超时区分、不重试、已取消的 signal 不发请求、requestId 注册表与不泄漏、并行请求互不影响 |
| `e2e/ai-quick-add.spec.ts` | 桌面端 AI 结果 E2E：可编辑草稿→添加→撤销、5xx 重试→规则降级→撤销、今日总结、子任务拆解批量撤销 |

验证命令：

```bash
npm run typecheck
npm test                 # tests/ai.test.ts 覆盖成功、超时/连接失败、非法 JSON、模型目录、开关关闭、
                         # 清单猜测过滤、显式 #标签/!优先级/~清单 合并、AI 漏掉日期/时间/重复
                         # 时按规则补齐、各功能 max_tokens 预算、只有 thinking 时的降级提示、
                         # 今日总结的本地日期归日与“今日完成”统计、子任务拆解去重与已有
                         # 子任务过滤；失败分类与提示文案（超时秒数、服务地址、401/404/429/5xx）、
                         # 瞬时故障重试一次后成功、5xx 重试后仍失败、超时/404 不重试、
                         # maxAttempts=1 关闭重试、attempts 计数回报等路径；
                         # tests/quick-add-regression.test.ts 覆盖快速添加准确率回归集（见 6.1）；
                         # tests/quick-add-draft.test.ts 覆盖 AI 结果草稿：清单名匹配、默认日期、
                         # 清空日期不被补回、非法日期/时间局部丢弃、标签去重、优先级夹取、空标题保护；
                         # tests/quick-add-ui.test.ts 覆盖「先展示草稿不写库 → 编辑后确认 → 撤销」与取消流程，
                         # 以及解析中点取消/改输入后迟到结果被丢弃、Enter 提示与 Esc 中止；
                         # tests/ai-cancel.test.ts 覆盖取消与超时的区分、取消不重试、requestId 注册表不泄漏
npm run test:ai          # 只跑 AI 相关测试：ai、请求取消、快速添加回归集、规则解析、草稿与草稿 UI
npm run test:e2e         # 构建后跑 Playwright：AI 结果 E2E + 桌面端视图冒烟（见 6.2）
```

手工验证 AI 连通性：设置页点击「测试连接」，或执行：

```bash
curl -s http://127.0.0.1:15721/v1/messages \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash","max_tokens":768,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}'
```

### 6.1 快速添加准确率回归集

`tests/quick-add-regression.test.ts` 把“用户输入 → 最终落库字段”固化成可重复执行的回归集，
所有用例固定在同一时刻 `2026-11-05 周四 09:00`，避免相对日期随时钟漂移。

- **规则用例（50+ 条）**：覆盖相对日期、星期、跨年、月日、时间区间、重复、显式标签/
  优先级/清单、纯标题与非法日期。每条都精确断言 `title`、`priority`、`tags`、`listName`、
  `dueDate`、`dueTime`、`allDay`、`recurrence` 全部字段，未写出的字段按默认值比较，
  不会出现“只校验标题”的宽松通过。
- **AI 合并用例（16 条）**：用假 fetch 返回贴近真实模型的输出，覆盖 Markdown 代码块与
  前后解释、模型只返回标题、漏日期/时间/重复、没提清单却猜清单、显式提到清单、
  非法日期/时间/优先级、标题残留显式标记、字符串优先级、OpenAI `choices` 响应、
  AI 日期优先于规则等场景，断言合并后的最终结果。
- **失败与重试**：非法 JSON、JSON 缺 title、只有 thinking 被 `max_tokens` 截断、401 不重试、
  500 重试一次后成功、连接失败重试后仍失败、超时提示秒数且不重试、空输入与关闭 AI
  不发请求，同时校验 `attempts` 计数。
- **请求契约**：只请求 `http://127.0.0.1:15721/v1/messages`，请求体 `model` 必须与默认
  模型 ID 逐字一致，`max_tokens` 使用快速添加预算，Token 为空时不发送 `authorization`。

新增解析能力时先在 `RULE_CASES` / `AI_CASES` 补一条用例，再改实现；日常可用
`npm run test:ai` 只跑 AI 相关测试。

### 6.2 AI 结果桌面端 E2E

`e2e/ai-quick-add.spec.ts` 用 Playwright 启动真实 Electron 应用，验证 AI 结果从
「模型返回」到「界面可操作」的完整链路，全部用例只连**本机回环地址上的假网关**
（`127.0.0.1` 随机端口），不发往任何外部服务：

- **草稿可编辑→添加→撤销**：假网关返回带 Markdown 代码块的 JSON，断言草稿中的
  标题、日期、时间、优先级正确；草稿展示期间任务数为 0；修改标题与优先级后点「添加」，
  列表出现编辑后的标题；点 toast「撤销」后任务被移除。
- **5xx 自动重试→规则降级→撤销**：假网关始终返回 500，断言实际收到 2 次请求、
  toast 同时含「AI 未能解析，已按规则添加…」「AI 服务繁忙」「已自动重试 1 次」，
  且没有弹出草稿；规则任务仍可通过 toast 撤销。
- **取消解析**：假网关延迟 2.5 秒返回，请求途中点「取消」，断言 toast 提示已取消、输入内容保留、
  迟到的响应不会弹出草稿也不会建任务，且只发出过一次请求（取消不重试）。
- **今日总结**：断言 AI 的 `summary`、`highlights`、`suggestions` 渲染，且不显示
  「已回落到本地统计」说明。
- **子任务拆解**：从详情面板触发，断言子任务写入、toast 显示新增数量、批量撤销后清空。
- **请求契约**：每次请求都是 `POST /v1/messages`，`model` 与 `AI_DEFAULT_MODEL`
  逐字一致，`max_tokens` 分别等于快速添加 1200、今日总结 1600、子任务 1600 的预算，
  Token 为空时不带 `authorization`。

每个用例通过 `TICKFLOW_USER_DATA` 指向 `os.tmpdir()` 下的一次性目录，启动独立数据库，
结束后删除，**不会读写真实用户数据**。主进程在 `requestSingleInstanceLock` 与
`initDatabase` 之前应用该环境变量（见 `src/main/index.ts`），因此 E2E 也不会与
正在运行的正式实例抢单实例锁。

新增 AI 结果交互时，优先在 `e2e/ai-quick-add.spec.ts` 扩展假网关返回与断言；
若只想验证纯函数或组件行为，仍放在 `tests/` 下的 Vitest 用例，运行更快。

## 7. 隐私与边界

- 只有用户主动触发 AI 按钮/总结时才发送任务内容；普通快速添加与启动流程不联网。
- 发送内容限于当前输入句、主任务标题/备注、该任务已有子任务标题、今日任务摘要，
  不包含数据库全量数据。
- Token 仅存本机数据库，请求只发往配置的 `aiBaseUrl`；不会自动切换第三方地址。
- E2E 使用 `TICKFLOW_USER_DATA` 指向临时目录，并通过 `127.0.0.1` 随机端口假网关响应，
  不接触真实用户数据库、不访问外部网络（见 6.2）。
- AI 生成的时间、清单和子任务都会经过本地校验后再写库，AI 不能直接修改数据库。
- 取消只中止本机发起的那一次请求（按 renderer 生成的 `requestId` 定位），请求结束后注册表立即清空，
  不会残留 controller 或跨请求误取消。
