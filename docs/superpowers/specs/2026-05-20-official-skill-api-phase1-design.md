# 微信读书官方 Skill API 接入第一阶段设计

> 状态：已按讨论确认，等待实现计划
> 日期：2026-05-20
> 分支：`feat/official-skill-integration`
> 基线：上游 `1.5.5`

## 背景

当前插件通过微信读书网页 Cookie 调用 `weread.qq.com` 的内部接口，同步书籍元数据、划线、想法、章节和阅读进度。官方现在提供 `weread-skills`，统一通过 Agent API Gateway 调用微信读书能力。第一阶段目标不是重写插件，而是在保留现有 Cookie 通路的前提下，新增官方 API Key 通路。

本设计参考：

- 官方 `weread-skills` 当前版本 `1.0.3`
- `zhaohongxuan/obsidian-weread-plugin` 现有 `1.5.5` 源码
- `ZhongJiaqi/weread-to-obsidian` 对 Agent API Gateway 的调用方式和已知参数差异

## 目标

1. 插件设置中允许用户选择数据源：现有 Cookie 或官方 API Key。
2. 官方 API 通路能完成现有核心同步：有笔记书籍列表、书籍详情、划线、想法、章节、阅读进度。
3. 尽量保持 `SyncNotebooks`、现有 parser、模板和输出 Markdown 不变。
4. 官方 API 失败时提供明确错误，不破坏旧 Cookie 登录状态。
5. 第一阶段实现后，用户可以在 dev 插件中切换数据源并对比两条通路的输出。

## 非目标

第一阶段不实现以下内容：

- 不迁移或复用旧插件 `data.json`、Cookie、API Key。
- 不接入 `/shelf/sync` 作为完整书架来源。
- 不实现热门划线、他人想法、读者画像、搜索和发现类接口。
- 不重构微信读书索引器。
- 不改变现有模板系统和已生成笔记格式。
- 不自动在官方 API 失败时回退 Cookie 通路。

## 用户设置

新增设置字段：

- `dataSource`: `'cookie' | 'official'`
- `wereadApiKey`: string
- `isOfficialApiValid`: boolean
- `officialSkillVersion`: string，默认 `1.0.3`

设置页新增“数据源”区域：

- 使用下拉或分段选择在 Cookie 和官方 API 之间切换。
- Cookie 选项显示现有扫码、CookieCloud、刷新 Cookie 状态。
- 官方 API 选项显示 API Key password 输入框、连接测试按钮和当前认证状态。
- API Key 保存到 dev 插件自己的 `data.json`。UI 全程遮蔽，不写日志，不提交。

默认数据源保持 `cookie`，避免影响现有用户。

## 架构

保留 `ApiManager` 作为同步流程依赖的入口。`ApiManager` 对外方法名尽量不变：

- `getNotebooksWithRetry()`
- `getBook(bookId)`
- `getNotebookHighlights(bookId)`
- `getNotebookReviews(bookId)`
- `getChapters(bookId)`
- `getProgress(bookId)`

内部新增 provider 边界：

- `CookieWereadProvider`：包装当前 Cookie 请求逻辑。
- `OfficialWereadProvider`：调用官方 Agent API Gateway。
- `ApiManager` 根据 `settings.dataSource` 委托给对应 provider。

这样 `SyncNotebooks` 仍然调用 `ApiManager`，不用知道底层数据来自 Cookie 还是官方 API。

## 官方 API 请求约定

官方通路统一调用：

```text
POST https://i.weread.qq.com/api/agent/gateway
Authorization: Bearer <wereadApiKey>
Content-Type: application/json
```

请求 body 必须平铺：

```json
{
  "api_name": "/user/notebooks",
  "count": 100,
  "skill_version": "1.0.3"
}
```

不允许把业务参数包进 `params`、`data`、`body`。如果响应包含 `upgrade_info`，同步流程立即停止并提示用户升级官方 skill。

## 第一阶段接口映射

| 现有方法 | 官方接口 | 关键参数 | 适配要求 |
| --- | --- | --- | --- |
| `getNotebooksWithRetry` | `/user/notebooks` | `count`, `lastSort` | 循环拉取直到 `hasMore !== 1`，返回 `books` 数组 |
| `getBook` | `/book/info` | `bookId` | 将 `wordCount` 映射为 `totalWords` |
| `getNotebookHighlights` | `/book/bookmarklist` | `bookId` | 返回结构基本兼容现有 `HighlightResponse` |
| `getNotebookReviews` | `/review/list/mine` | `bookid`, `count`, `synckey` | 注意参数名是小写 `bookid`；默认 `count=200, synckey=0` |
| `getChapters` | `/book/chapterinfo` | `bookId` | 包装成 `{ data: [{ bookId, chapterUpdateTime, updated: chapters }] }` |
| `getProgress` | `/book/getprogress` | `bookId` | 将 `recordReadingTime` 补齐为现有代码使用的 `readingTime` |

`/user/notebooks` 的总笔记数口径为 `reviewCount + noteCount + bookmarkCount`，但第一阶段仍保留现有 `noteCount` 和 `reviewCount` 字段行为，不主动改过滤逻辑，避免输出差异扩大。

## 数据适配

适配层应尽量让官方响应看起来像旧 Cookie 响应：

- `Metadata` 仍由 `parseMetadata` 生成。
- `HighlightResponse.updated`、`chapters`、`book` 保持现有字段名。
- `BookReviewResponse.reviews[].review` 保持现有 parser 需要的字段。
- `ChapterResponse` 统一使用旧接口的 `data[0].updated` 包裹结构。
- 阅读进度使用 0-100 整数；只有 `progress === 100` 且有 `finishTime` 时才表示读完。

如官方返回缺少旧字段，适配层补安全默认值，不让 parser 直接处理 `undefined` 异常。

## 错误处理

官方通路新增统一错误类型：

- 未填写 API Key：阻止同步，提示在设置中填写。
- HTTP 401/403：标记 `isOfficialApiValid=false`，提示 API Key 无效或权限不足。
- `errcode !== 0`：显示 `errmsg` 或接口名，不清空 Cookie。
- `upgrade_info`：停止当前同步，显示升级提示。
- 网络失败：提示网络或官方接口不可用，保留当前数据源设置。

Cookie 通路错误处理保持现状。官方通路不调用 `refreshCookie()`，也不修改 `cookies` 和 `isCookieValid`。

## 安全

- API Key 只保存在 dev 插件自己的配置里。
- 不打印 API Key，不生成包含 API Key 的 cURL。
- 不读取旧插件目录的 `data.json`。
- 不提交 `data.json`、`.bak`、Cookie、API Key。

## 测试与验证

实现阶段至少覆盖：

1. 单元级适配测试：官方 notebook、chapterinfo、book info、progress fixture 能转换成现有 parser 可消费形状。
2. 设置迁移测试：老配置缺少新字段时默认 `dataSource='cookie'`。
3. 类型检查：`npx svelte-check`。
4. 构建检查：需要构建时使用不带 `--fix` 的 webpack 检查，避免上游 `npm run build` 自动改源码。
5. 手动验证：在 dev 插件中填写 API Key，切换官方数据源，同步少量书籍，对比旧 Cookie 输出。

## 交付标准

第一阶段完成时应满足：

- 默认 Cookie 通路行为不变。
- 官方 API Key 通路可以同步核心笔记内容。
- 设置页能清楚显示当前数据源和认证状态。
- 同步失败不会清空或破坏另一条数据源的认证信息。
- `git status --short` 只包含本阶段预期改动。
- 不提交任何用户隐私数据或认证材料。
