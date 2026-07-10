# update-translations skill — 设计文档

**日期:** 2026-07-10
**范围:** 新增项目级 skill `.claude/skills/update-translations/`，外加一组让 `npm run translate` 幂等且诚实的 pipeline 修复。**不改动** 翻译逻辑、对齐算法、schema 或站点前端。

## 目标

把「源站发布新内容后更新站点」这个多步、易漏的手工流程固化成一个可复用的 skill：跑全量增量翻译，替人把住失败与校验关卡，报告本次到底产出了什么，然后停在待提交状态。

发布是外向动作，由人拍板。skill 不 commit、不 push。

## 背景：三个非显然的事实

设计围绕以下三点展开，均经代码核对：

1. **失败不会让进程退出非零。** `main()` 的 per-article `catch` 把异常吞进 `totals.failed`，只 `console.error` 一行 `✗ <slug>`，随后照常重建 manifest 并正常退出。`npm run translate` 返回 0 **不代表全部成功**。

2. **全量运行原本不是幂等的。** `assemble.ts` 无条件把当天日期写入 `article.translatedAt`，`store.ts` 的 `writeArticle` 又无条件写盘。盘上 224 篇的 `translatedAt` 是 `2026-07-08`、3 篇是 `2026-07-09`，所以**在此之后的任何一天跑一次全量，227 个文件全部会被改写**，尽管源站一个字都没变。manifest 的每个条目也带 `translatedAt`，因此 manifest 的 `articles` 数组同样会 227 条全变——不只是 `generatedAt` 脏。

3. **pipeline 知道每篇的处置结果，却把它扔掉了。** `assembleArticle` 返回的 `stats` 里有 per-article 的 `new/changed/deleted`，但 `main()` 只把它们加总打印。文章粒度的「哪几篇动了」信息本来就在手上。

事实 2 是根因：不修它，任何基于文件状态的归因手段（`git status`、内容哈希）都会把 227 篇伪变更报成源站修订。事实 3 提供了正解——归因不该在 pipeline 外面重建，而该由 pipeline 直接输出。

## 设计决策（已与用户确认）

- **终点：** 翻译 + 校验，停在待提交状态。不自动 commit / push。
- **跑法：** 总是 `npm run translate` 全量增量，不做 `--only=` 定向。全量才能同时捕获新文章与 PG 对旧文章的静默修订；未变 segment 靠 `sourceHash` 对齐跳过，API 花费接近零。
- **校验：** 退出码门禁 + `npm run test` + `npm run build`。
- **归因：** 读 pipeline 输出的 per-article `added`/`updated` 名单。**不**做 git 状态快照，**不**做文件内容哈希。
- **rawUnsupported：** 仅转述 pipeline 摘要给出的 slug + id，不额外拉取 segment 原文展开。
- **进度：** 后台运行，跑完一次性汇报，不中途轮询。

## 1. Pipeline 修复

这些修在源头而非 skill 里：缺陷属于 pipeline 自身，修在这里，任何人手动跑 `npm run translate` 都受益；修进 skill，则只有走 skill 的路径受保护。

### 1.1 文章写入幂等化（`index.ts` + `store.ts`）

新增纯函数 `articleContentEqual(a, b)`，比较除 `translatedAt` 之外的全部字段（`translatedAt` 是运行时间戳，不是内容）。`main()` 据此三分：

- `existing === null` → 写盘，计入 `added`
- 内容不等 → 写盘（`translatedAt` 顺理成章更新为今天），计入 `updated`
- 内容相等 → **不写盘**，磁盘上的原 `translatedAt` 得以保留

字段逐一显式比较，不用 `JSON.stringify`：`existing` 来自 Zod parse，`article` 是对象字面量，键序不保证一致，序列化比较会产生假阴性。

### 1.2 manifest 条件写入（`manifest.ts` + `store.ts`）

新增纯函数 `manifestArticlesEqual(a, b)`，只比较 `articles` 数组，忽略 `generatedAt`（每次运行都是 `now()`）。新增 `readManifest()`。仅当索引内容真的变化时才写 `manifest.json`。

manifest 仍从**磁盘**（`readAllArticles`）重建，而非从内存中的 `results`。这一点现在比以前更关键：被跳过写盘的文章，其内存对象的 `translatedAt` 是今天，磁盘上却是旧日期，manifest 必须反映磁盘。

### 1.3 退出码（`index.ts`）

提取纯函数 `exitCodeFor(failed: number): 0 | 1`，摘要打印后 `process.exitCode = exitCodeFor(totals.failed)`。

用 `process.exitCode` 而非 `process.exit()`：后者会截断刚刚缓冲写入的摘要，而摘要里恰好是最需要看到的失败信息。

该函数有单测。它无需网络或 Vertex mock——本仓库的测试范式是纯函数 + 依赖注入，全仓库无一处 `vi.mock`。这个判定是整个 skill 门禁所系，单测虽小但守住了「有人删掉这一行」的回归。

### 1.4 每请求超时（`fetch.ts`）

`fetchHtml` 新增 `timeoutMs = 30_000`，通过 `AbortSignal.timeout()` 传入 `fetch`。

不是为了防「永久挂起」——Node 的 fetch 基于 undici，默认 `headersTimeout`/`bodyTimeout` 均为 300s，挂起请求终会抛错、重试耗尽后被计入 `failed`。真正的问题是最坏情况太难看：单个坏 URL 是 4 次尝试 × 300s ≈ 20 分钟，期间还占着 4 个并发槽之一。30s 超时让这个问题消失，代价是三行代码。

**不引入全任务看门狗。** 在既有的重试 + 失败计数 + 退出码之上再叠一层超时状态机，属于过度设计。

### 1.5 per-article 输出（`index.ts`）

摘要新增：

```
articles  added:N updated:M unchanged:K

+ added: slug1, slug2
~ updated: slug3
```

这是 skill 归因的唯一数据源。

## 2. Skill 结构

单文件 `.claude/skills/update-translations/SKILL.md`，随仓库提交（项目级，非个人级）。

frontmatter 的 `description` 需覆盖以下说法以保证触发：源站更新了、PG 发新文章了、同步源站、更新翻译、跑一下翻译。

## 3. 执行流程

### 步骤 1 — 前置检查

在花掉 227 次抓取之前先失败：

- `credentials/gemini-vertex.json` 存在；导出 `GOOGLE_APPLICATION_CREDENTIALS` 指向它。
- Node ≥ 22.12.0。

不检查工作区是否干净。归因来自 pipeline 输出而非文件状态，脏工作区无碍。而且未提交的手工译文改动本身是安全的：`assembleArticle` 先读盘上的旧文章，`sourceHash` 未变的 segment 直接保留其 `zhMarkdown`，模型不会覆盖它。

### 步骤 2 — 全量增量翻译

后台运行 `npm run translate`，输出 tee 到 scratchpad 日志。

后台是必需的：227 篇抓取加上新文章的 Gemini 调用可能超过前台 10 分钟的超时上限。不轮询——后台命令退出时 harness 会自动重新唤起，而中途唯一会出现的增量信息就是 `✗ <slug>` 失败行，跑完从日志里一样读得到。

### 步骤 3 — 门禁：失败即停

退出码非零时：

- 原样呈报日志中所有 `✗ <slug>` 行。
- **同时呈报本次日志里的 `rawUnsupported` 告警。** 这些告警是无条件打印的，日志里已经有了；若此刻丢弃，后续 `--only=<失败 slug>` 重试只会输出那几篇的告警，其余文章的告警就此永久丢失。
- 给出定向重试命令：`npm run translate -- --only=<失败的 slug,逗号分隔>`。
- **就此停止**，不跑校验。

无需回滚：即便部分失败，manifest 仍已从磁盘上的全部文章重建（`index.ts` 的既定行为，防止 `--only`/`--limit` 或含失败的运行把其他文章挤出首页索引），工作区处于自洽状态。

### 步骤 4 — 识别本次产出

直接读摘要里的 `+ added:` 与 `~ updated:` 两行。新文章的中文标题从对应 JSON 的 `titleZh` 读出。

不做 git 快照相减：`git status` 只描述相对 HEAD 的状态，一个本就 ` M` 的文件被 pipeline 再改一次仍是 ` M`，相减会漏报。

### 步骤 5 — 校验

- `npm run test` — vitest 跑 pipeline 单测，确认解析/对齐逻辑未坏。
- `npm run build` — Astro 的 content collection 用 `ArticleSchema` (Zod) 重新校验 `content/articles/` 下的全部 JSON。这是唯一真正检查**本次产出内容**的关卡，且不调用任何 API。

任一失败即如实呈报失败输出，不宣称完成。

### 步骤 6 — 汇报并停下

一次性给出：

- 新增文章：slug + 中文标题。
- 被修订的旧文章：slug。
- `rawUnsupported` 段落：slug + id。提示人工确认这些不是被漏掉的正文。
- 源站无变化时明确说「无变化，未产生任何改动」——修复 1.1/1.2 之后，这种情况下 `git status` 确实是干净的。

改动留在工作区。提交与发布由使用者决定。

## 4. 错误处理小结

| 情形 | 行为 |
|---|---|
| 缺凭证 / Node 版本过低 | 步骤 1 即停，不发起任何网络请求 |
| 部分文章翻译失败 | 步骤 3 停止，呈报失败 slug + rawUnsupported + 定向重试命令 |
| 全部成功但 `npm run build` 失败 | 如实呈报构建输出，不宣称完成 |
| 无任何新增/修订 | 正常走完校验，汇报「源站无变化」，工作区干净 |
| content/ 预先存在未提交改动 | 无影响；归因来自 pipeline 输出，且既有手工译文不会被覆盖 |

## 5. 明确不做的事（YAGNI）

- 不 commit、不 push、不触发部署。
- 不做 `--only=` 定向翻译的自动路径（失败重试时作为建议命令给出，由人执行）。
- 不拉取 `rawUnsupported` 段落原文。
- 不做 git 状态快照或文件内容哈希——pipeline 的 per-article 输出更准也更简单。
- 不做全任务看门狗（见 1.4）。
- 不新增 `scripts/` 包装脚本——那会把 pipeline 的摘要格式复制一份出去，摘要一改脚本就静默失灵。
