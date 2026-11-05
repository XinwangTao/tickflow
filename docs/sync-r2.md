# Cloudflare R2 同步

桌面与 Android 之间通过 R2 对象存储同步，不使用自建服务端。

## 数据布局

- 每台设备上传一份全量快照：`tickflow/snapshots/<deviceId>.json`
- 同步时列出所有快照 → 逐份下载 → 按实体 `updated_at` 做 last-write-wins 合并 → 上传自己的快照
- 删除使用 `deleted_at` tombstone 参与比较，不会把已删除任务复活
- 同步范围：清单、任务（标签名随任务同步）；习惯、番茄、模板、过滤器暂不跨端
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

## 安全

- Secret 保存在桌面 SQLite 设置表和 Android IndexedDB 中，使用**仅限该桶**的 R2 API Token
- 不要把密钥写进仓库或截图
- 发现泄露立即在 Cloudflare 撤销 Token

## 故障排查

| 现象 | 检查 |
|---|---|
| 403 | Token 权限、桶名、Endpoint、账号 ID |
| CORS 报错（Android） | 桶 CORS 是否允许 `https://localhost` |
| 上传成功但另一端看不到 | 两端前缀是否一致 |
| 数据被覆盖 | LWW：后同步者覆盖；避免同时改同一实体 |
| 列表为空 | Bucket/Endpoint 填错，或 Token 没有 List 权限 |
