# 例行复盘（TickFlow 固定流程）

> 用户消息「这是第 N 轮之后的例行复盘」即按本文件执行。历史消息从未附带步骤清单，故以本文件为准。

## 六步（按顺序，不跳）

1. **归零**
   - `git status --short`：并行会话的改动先标明归属，不擅自提交或还原。
   - `git log --oneline <上次复盘点>..HEAD` 数出区间提交；无上次复盘点时用最近一次复盘文档所在提交。

2. **全量回归**
   ```bash
   npm run typecheck
   npx vitest run
   npm run test:e2e
   npm run check:bundle
   cd mobile && npm run build && cd ..
   npm run check:mobile-web
   sha256sum -c release/SHA256SUMS.txt
   ```
   - 失败先判断是产品缺陷还是环境波动；产品缺陷当轮修，波动记录并调整重试/超时预算。

3. **区间盘点**
   - 按主题归并（桌面体验 / 性能 / 同步 / Android / 工程化），不逐条抄 commit。
   - 标注「用户可感知」与「内部重构」。

4. **沉淀规则**
   - 新坑优先变成测试期约束（E2E、单测、`check:*` 脚本），能自动化的当轮落地。
   - 不能自动化的写进项目 `CLAUDE.md`，并同步 Obsidian `inbox/`。

5. **更新计划**
   - `docs/iteration-plan.md`：已完成 / 可离线队列 / 长尾离线池 / 阻塞。
   - 阻塞项写清「等什么」与解除条件（等 L1 确认、等真机接入、等外部依赖）。
   - 可离线队列为空时明确写「本轮不新增低价值改动」，不凑数。

6. **归档与汇报**
   - 复盘写 `docs/retro-YYYY-MM-DD.md`（同日多次追加小节）。
   - Obsidian 追加一条（≤5 行，密度优先，不写密钥）。
   - 用三行总结：做了什么 / 怎么验证的 / 下一步。

## 判定口径

- 「已完成」= 有命令输出或测试证据；只有代码没有验证的写「已实现，待真机」。
- 「阻塞」≠「待办」：必须写解除条件，避免下轮重复讨论。
- 真机项一律进 `docs/TODO-device.md`；本机无设备时不停等。
- 同步/流程类改动先遵守 `docs/archify/` 图与 Archify-First 门禁。
