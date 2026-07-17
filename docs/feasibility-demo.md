# 可行性 Demo 范围（已确认）

- 成功标准：分享保存 + 列表展示 + 点击打开原链接
- 平台：先用 Safari / 任意 URL 分享打通；四平台手测为加分
- 数据：薄 SQLite + `ingest_id` 幂等；复用解析/消费逻辑
- 架构：Swift Share Extension → App Group inbox 文件 → 主 App 消费

明确不做：标签、搜索、提醒、元数据、短链展开、Drizzle、完整 UI。
