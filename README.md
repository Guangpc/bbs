# video-bookmark-demo

最小可行性 Demo：验证「分享保存 → 列表可见 → 点击打开原链接」。

## 目标

- Safari / 任意 App 分享 HTTPS 链接到本 App
- Share Extension 原子写入 App Group `inbox/<uuid>.json`
- 主 App 启动/回前台消费 inbox，SQLite 按 `ingest_id` 幂等落库
- 首页列表展示；点击用系统打开原链接
- 粘贴保存作为分享失败时的 fallback

不做：标签、搜索、提醒、元数据抓取、短链展开、四平台全量矩阵（可后补手测）。

## 标识

| 项 | 值 |
|---|---|
| Bundle ID | `com.playproject.videobookmarkdemo` |
| App Group | `group.com.playproject.videobookmarkdemo` |
| Share Extension | `com.playproject.videobookmarkdemo.ShareExtension` |

## 开发

```bash
cd /Volumes/T7Ssk/AI/cursor/video-bookmark-demo
npm install
# 若尚未生成 ios/：
npm run prebuild:ios
# 日常：
npx expo start
```

另开 Xcode：

```bash
open ios/videobookmarkdemo.xcworkspace
```

1. 主 App 与 `ShareExtension` 都选同一 Team  
2. Apple Developer / Xcode Capabilities 里启用 App Group：`group.com.playproject.videobookmarkdemo`  
3. 运行 `videobookmarkdemo`（不要用 Expo Go；模拟器已验证可编译）  
4. 先用「粘贴保存」验证列表与打开链接  
5. 再从 Safari 分享一条链接到「收藏夹」，回到主 App 应出现新记录  

> Xcode 26 下 `expo-modules-jsi` 需 `patches/expo-modules-jsi+57.0.3.patch`（`postinstall` 自动应用）。

## 验证清单

1. 粘贴一条 `https://…` → 列表出现 → 点击能打开  
2. Safari 分享同一类链接 → Extension 完成 → 打开主 App → 列表出现  
3. 不删 inbox 文件时再次同步 → 不产生第二条（`ingest_id` 幂等）

## 项目结构

- `src/` — 解析、inbox schema、SQLite、消费逻辑  
- `modules/app-group-inbox/` — 读取 App Group inbox 的本地 Expo Module  
- `native/ShareExtension/` — 纯 Swift Share Extension 源码  
- `plugins/withShareExtension.js` — 主 App entitlements / Info.plist  
- `scripts/ensure-share-extension.js` — 把 Extension target 挂进 Xcode 工程  
