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
  "max_tokens": 600,
  "temperature": 0.1,
  "system": "你是任务管理应用 TickFlow 的解析器。你只输出严格 JSON。",
  "messages": [{ "role": "user", "content": "<提示词>" }]
}
```

响应解析兼容 `content: [{ type: "text", text: "..." }]`，会忽略 thinking 块；
也兼容 OpenAI 风格的 `choices[0].message.content` 与纯字符串 `content`。
模型返回的 Markdown 代码块或前后解释文字会被容忍，客户端只提取第一个 JSON 值。

非 2xx 响应会抛出 `AI 接口返回 <status>：<前 200 字符>`；超时抛出 `AI 请求超时`。
错误信息最终只用于 toast 与降级原因展示，不会中断操作。

### 模型目录

`GET {baseUrl}/v1/models`，请求头同上。客户端兼容 `{ "data": [...] }` 与纯数组，
只读取 `id`（逐字保留）与可选的 `display_name`，去重后最多返回 200 个。
非 2xx 返回 `AI 模型列表返回 <status>：<前 200 字符>`，超时返回
`AI 模型列表请求超时`；设置页会把这些信息直接展示在 toast 中。

「测试连接」会发送一条 `max_tokens: 256` 的最小请求。推理模型会先输出 thinking
块，预算过小（例如 16）时可能只有 thinking 没有正文，从而误报失败；256 能覆盖
thinking + 简短回复。

## 3. 三个首批功能

### 3.1 AI 自然语言快速添加

入口：今天 / 最近 7 天 / 收集箱 / 清单视图顶部的快速添加框。

- 普通 `Enter`：始终使用本地 `parseQuickAdd` 规则，零延迟。
- `Ctrl/Cmd + Enter` 或点击输入框右侧 **AI** 按钮：把整句话交给 AI 解析。
- AI 输出字段：`title`、`dueDate`（YYYY-MM-DD）、`dueTime`（HH:mm）、`allDay`、
  `priority`（0–3）、`tags`、`listName`、`recurrence`（RFC5545 RRULE）。
- 结果会再次经过 `normalizeAiQuickAdd` 校验：非法日期/时间被丢弃，优先级夹到 0–3，
  标签去重，清单名必须能在现有清单中匹配（匹配不到时回落到当前默认清单并提示）。
- 请求期间按钮显示「解析中」，输入框仍可编辑，不会锁住界面。

提示词会带上当前时间、星期与全部可用清单名，尽量让 AI 输出可直接落库的结构。

### 3.2 AI 拆解子任务

入口：任务详情抽屉 →「子任务」标题右侧的 ✨ 按钮。

- 输入：主任务标题、备注、所属清单。
- AI 输出：`{"subtasks":[{"title":"...","priority":0}]}`，最多 10 条。
- 客户端去重、去空、限制长度，并逐条创建为当前任务的子任务。
- 规则降级：按标题/备注中的换行、分号、逗号/顿号拆分，去掉 `-`、`*`、`1.` 等列表符号；
  不会生成与主任务同名的子任务；没有可拆内容时提示手动添加。

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

## 4. 降级策略

| 场景 | 行为 |
| --- | --- |
| `aiEnabled=false` | 不发请求。快速添加走 `parseQuickAdd`；AI 总结卡片与拆解按钮隐藏 |
| 服务未启动 / 连接被拒 | 快速添加用规则解析；拆解用标点/换行规则；总结用本地统计；toast 说明原因 |
| 请求超时 | 同上，超时时间由 `aiTimeoutMs` 控制，默认 15 秒 |
| 非 2xx / 模型不存在 | 同上；错误摘要进入 toast 与 `warning` 字段 |
| 返回非 JSON 或字段缺失 | `parseAiJson` / `normalize*` 返回 null，按失败降级 |
| 返回日期非法、优先级越界 | 只丢弃非法字段，保留其余合法结果，不整体失败 |
| 快速添加的清单名不存在 | 放入当前默认清单，并提示「未找到清单 X，已放入 Y」 |

所有 IPC 调用均在 `try/catch` 中执行，main 进程不会因 AI 异常崩溃；renderer 的
`try/finally` 会复位 loading 状态，保证按钮可再次点击。

## 5. 代码与测试

| 文件 | 职责 |
| --- | --- |
| `src/shared/ai.ts` | 类型、默认值、提示词、JSON 提取、归一化、规则降级 |
| `src/main/ai-client.ts` | `/v1/messages` 与 `/v1/models` 请求、鉴权头、超时、响应文本提取 |
| `src/main/ai.ts` | 三个功能的编排与降级、模型列表、连接测试 |
| `src/main/ipc.ts` | `ai:quick-add` / `ai:subtasks` / `ai:summary` / `ai:models` / `ai:test` |
| `src/renderer/src/components/QuickAdd.tsx` | AI 快速添加入口 |
| `src/renderer/src/components/DetailDrawer.tsx` | AI 拆解子任务入口 |
| `src/renderer/src/components/AiDailySummary.tsx` | 今日总结卡片 |
| `src/renderer/src/components/SettingsDialog.tsx` | AI 配置与连接测试 |

验证命令：

```bash
npm run typecheck
npm test                 # tests/ai.test.ts 覆盖成功、超时/连接失败、非法 JSON、模型目录、开关关闭、
                         # 今日总结的本地日期归日与“今日完成”统计等路径
```

手工验证 AI 连通性：设置页点击「测试连接」，或执行：

```bash
curl -s http://127.0.0.1:15721/v1/messages \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"ccs-claude-openai--ccs-claude-openai-2--glm-5.3-flash","max_tokens":256,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}'
```

## 6. 隐私与边界

- 只有用户主动触发 AI 按钮/总结时才发送任务内容；普通快速添加与启动流程不联网。
- 发送内容限于当前输入句、主任务标题/备注、今日任务摘要，不包含数据库全量数据。
- Token 仅存本机数据库，请求只发往配置的 `aiBaseUrl`；不会自动切换第三方地址。
- AI 生成的时间、清单和子任务都会经过本地校验后再写库，AI 不能直接修改数据库。
