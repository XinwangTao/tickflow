# Cloudflare R2 同步

桌面与 Android 之间通过 R2 对象存储同步，不使用自建服务端。

## 数据布局

- 每台设备上传一份全量快照：`tickflow/snapshots/<deviceId>.json`
- 同步时列出所有快照 → 逐份下载 → 按实体 `updated_at` 做 last-write-wins 合并 → 上传自己的快照
- 删除使用 `deleted_at` tombstone 参与比较，不会把已删除任务复活
- 同步范围：清单、任务（标签名随任务同步）；习惯、习惯提醒、番茄、模板、过滤器暂不跨端
- 附件只保存在本机 `%APPDATA%\tickflow\attachments`，不参与 R2 快照同步
- 冲突策略：同一实体后写入者覆盖先写入者；建议避免两端同时编辑同一任务

## 创建 R2

1. Cloudflare Dashboard → R2 → 创建桶（例如 `tickflow`）
2. R2 → Manage R2 API Tokens → 创建 Token，权限 **Object Read & Write**，限定该桶
3. 记录 **Access Key ID** / **Secret Access Key**
4. Endpoint：`https://<account_id>.r2.cloudflarestorage.com`

## CORS（Android 必需）

Android WebView 的来源是 `https://localhost`（Capacitor `androidScheme: 'https'`）。在桶的 Settings → CORS 粘贴：

```json
[
  {
    "AllowedOrigins": ["https://localhost", "http://localhost", "capacitor://localhost"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

桌面端同步在主进程使用 Node `fetch`，不受 CORS 限制；Android 必须配置。

## 配置

桌面：设置 → 同步（Cloudflare R2）→ Endpoint / Bucket / Access Key / Secret / 前缀 → 保存 → 测试连接 → 立即同步；可开启动时自动同步。

Android：底部「设置」→ 同步（Cloudflare R2）→ 同上。

两端前缀必须一致，默认 `tickflow/snapshots/`。

## 免费额度与用量模型

Cloudflare R2 免费额度（截至 2026-11，具体以控制台为准）：10 GB-month 存储、100 万 Class A/月、1000 万 Class B/月，出网免费。

本项目按“单对象覆盖写”设计，确保落在免费额度内：

- 每台设备只保留一个快照对象 `<prefix><deviceId>.json`，每次同步覆盖，不产生历史版本
- 快照只含清单与任务（标签名随任务），不含附件、习惯、番茄、模板、过滤器
- 单份快照硬上限 5 MiB（`assertSnapshotSize`），超限中止上传并提示检查是否误把附件写入
- 同步完成提示会显示本次上传的 KB，便于核对免费额度消耗
- 2 台设备每天各同步 10 次：存储约 2 份快照（通常 <1 MB），Class A 约 20 次/天、Class B 约 20 次/天，远低于免费额度
- 2026-11-06 真实桶实测：设置页「查看用量」显示 3 份快照共 93.3 KB，远低于 10 GB 免费存储；桌面与安卓设置页均可点击「查看用量」核对，2026-11-06 两端实测均为 3 份 / 93.3 KB
- 不要给桶开启版本控制或保留历史对象的生命周期规则；附件保持在手机/电脑本地

## 本地协议验证

`tests/r2-mock.test.ts` 会在本机启动一个兼容 S3 的 mock，实际走 `list-type=2`、GET、PUT 请求，验证两台设备快照合并、同 ID 后写覆盖与 tombstone 不复活。该测试不替代真实 R2 的凭据、CORS 与跨网络验收。

## 安全

- 桌面端 Secret 使用 Electron `safeStorage` 加密后存入 SQLite（`enc:v1:` 前缀），启动时自动迁移旧明文；Android 仍存 IndexedDB，请使用**仅限该桶**的 R2 API Token
- JSON 数据导出会剔除 `r2AccessKeyId` / `r2SecretAccessKey` / `aiToken`，不会把凭据写进备份文件
- 升级到加密存储前生成的 `backups/*.db` 可能仍含明文密钥；确认新版本同步正常后可在「设置 → 数据 → 打开备份目录」清理旧文件
- 不要把密钥写进仓库或截图
- 发现泄露立即在 Cloudflare 撤销 Token

## 凭据轮换与泄露处置

适用于 Token 曾写入笔记/聊天/日志或怀疑外泄：

1. Cloudflare Dashboard → R2 → Manage API Tokens：**先撤销旧 Token**（避免继续可用），再创建仅限目标桶 Object Read & Write 的新 Token。
2. 桌面：设置 → 同步 → 更新 Endpoint/Bucket/Access Key/Secret → 保存 → 测试连接 → 立即同步；确认 `r2LastSync` 更新。
3. Android：设置 → 同步 → 更新四项 → 测试连接 → 立即同步；确认另一端测试任务可见（B5/B6）。
4. 检查两端前缀一致；跑 `scripts/check-r2.sh`（不打印密钥）确认 PUT/GET/CORS/DELETE。
5. 新 Token 存密码管理器；旧笔记/日志中的密钥字段改为 `<已轮换，见密码管理器>`，不要保留可用的旧值。
6. 若旧值曾进入云同步（Remotely Save/网盘/git），视为已泄露；撤销是必须的，不能只删本地文件。

## 故障排查

| 现象 | 检查 |
|---|---|
| 403 | Token 权限、桶名、Endpoint、账号 ID |
| CORS 报错（Android） | 桶 CORS 是否允许 `https://localhost` |
| 上传成功但另一端看不到 | 两端前缀是否一致 |
| 数据被覆盖 | LWW：后同步者覆盖；避免同时改同一实体 |
| 列表为空 | Bucket/Endpoint 填错，或 Token 没有 List 权限 |

## 本机验收脚本

```bash
cp scripts/r2.env.example scripts/r2.env   # 填 Endpoint/Bucket/Access Key/Secret
set -a; . scripts/r2.env; set +a
bash scripts/check-r2.sh
```

脚本依次执行 PUT → GET 校验 → Android CORS 预检（Origin `https://localhost`）→ DELETE；不打印密钥。2026-11-06 已在真实桶 `tickflow` 完成 B1–B11：双端双向、软删除、LWW 冲突、1000 任务快照、错 Secret 403；B8/B9 用构造快照走真实 R2 + 桌面同步（见 `docs/device-r2-acceptance.md`）。

## 本地 mock 验收（无凭据）

`npm test -- tests/r2-mock.test.ts` 用本地 S3 兼容 mock 跑通 shared `syncWithR2` 与桌面 `syncNow`：双设备双向合并、`updatedAt` LWW、标签、tombstone 均通过（3 条）。`e2e/r2-mock.spec.ts` 额外验证设置页测试连接、立即同步、上传含本地任务、远端快照合并进收集箱。

## 已知限制

- 永久删除（垃圾箱再清除 / `purge`）不会生成 tombstone；如果远端快照仍有该任务，下次同步会把它合并回来。桌面端永久删除前会二次确认并提示该风险，取消不删除；跨端删除仍建议使用「移入垃圾箱」软删除，彻底清理请在两端同步完成后再永久删除。
- 同步范围仅清单、任务与任务标签；习惯、习惯提醒、番茄、模板、过滤器、附件仍在本地。
