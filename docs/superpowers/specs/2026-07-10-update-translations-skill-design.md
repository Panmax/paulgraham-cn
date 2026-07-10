# update-translations skill — 设计文档

**日期:** 2026-07-10
**范围:** 新增项目级 skill `.claude/skills/update-translations/`，外加 `pipeline/index.ts` 的一行退出码修复。**不改动** 翻译逻辑、对齐算法、schema 或站点前端。

## 目标

把「源站发布新内容后更新站点」这个多步、易漏的手工流程固化成一个可复用的 skill：跑全量增量翻译，替人把住失败与校验关卡，报告本次到底产出了什么，然后停在待提交状态。

发布是外向动作，由人拍板。skill 不 commit、不 push。

## 背景：三个非显然的事实

设计围绕以下三点展开，它们都来自对现有代码的核对：

1. **失败不会让进程退出非零。** `pipeline/index.ts` 的 per-article `catch` 把异常吞进 `totals.failed`，只 `console.error` 一行 `✗ <slug>`，随后照常重建 manifest 并正常退出。`npm run translate` 返回 0 **不代表全部成功**。

2. **pipeline 不告诉你「哪几篇是新的」。** 运行摘要只有聚合的 segment 计数（new/changed/unchanged/deleted）。要拿到文章粒度的名单，唯一来源是 `git status --short content/articles/`：untracked 即新文章，modified 即 PG 修订过的旧文章。

3. **脏工作区不危险，只是妨碍归因。** `assembleArticle` 先读盘上的旧文章，`sourceHash` 未变的 segment 直接保留其 `zhMarkdown`。因此未提交的手工译文改动，只要对应英文原文没变，就不会被模型覆盖。

## 设计决策（已与用户确认）

- **终点：** 翻译 + 校验，停在待提交状态。不自动 commit / push。
- **跑法：** 总是 `npm run translate` 全量增量，不做 `--only=` 定向。全量才能同时捕获新文章与 PG 对旧文章的静默修订；未变 segment 靠 `sourceHash` 对齐跳过，API 花费接近零，代价只是重新抓取 227 个页面。
- **校验：** 解析失败计数（非零即停）+ `npm run test` + `npm run build`。
- **rawUnsupported：** 仅转述 pipeline 摘要给出的 slug + id，不额外拉取 segment 原文展开。
- **归因：** 运行前后各取一次 `git status --short content/articles/` 快照，相减得到本次产出。**不**硬性要求工作区干净。
- **进度：** 后台运行，跑完一次性汇报，不中途轮询。

## 1. pipeline 退出码修复

`pipeline/index.ts` 在打印摘要之后追加：

```ts
if (totals.failed > 0) process.exitCode = 1;
```

用 `process.exitCode` 而非 `process.exit()`，以免截断 stdout 的缓冲写入。

**不为此写单测。** 该仓库的测试范式是纯函数 + 依赖注入（如 `translateSegments({ generate }, ...)` 把 Vertex 客户端当参数传入），全仓库没有任何一处使用 `vi.mock`，也不存在 `index.test.ts`。`main()` 直接 import 了 `fetchHtml`、`createVertexTranslator` 和 store 层，不可注入。为这一行引入一套仓库中不存在的模块 mock 脚手架去挡住网络与 Vertex，成本远超收益。现状是 `main()` 整体未被单测覆盖，这一行与之保持一致。

修在源头而非 skill 里，是因为失败静默退 0 是 pipeline 自身的缺陷：修在这里，任何人手动跑 `npm run translate` 都受益；修进 skill，则只有走 skill 的路径受保护。

## 2. Skill 结构

单文件 `.claude/skills/update-translations/SKILL.md`，随仓库提交（项目级，非个人级）。

frontmatter 的 `description` 需覆盖以下说法以保证触发：源站更新了、PG 发新文章了、同步源站、更新翻译、跑一下翻译。

## 3. 执行流程

### 步骤 1 — 前置检查

在花掉 227 次抓取之前先失败：

- `credentials/gemini-vertex.json` 存在；导出 `GOOGLE_APPLICATION_CREDENTIALS` 指向它。
- Node ≥ 22.12.0。
- 取快照 A：`git status --short content/articles/`。若非空，记下这些路径，并在最终报告中声明「content/ 本来就有未提交改动」，但**不阻断**。

### 步骤 2 — 全量增量翻译

后台运行 `npm run translate`，输出 tee 到 scratchpad 日志。

后台是必需的：227 篇抓取加上新文章的 Gemini 调用可能超过前台 10 分钟的超时上限。不轮询——后台命令退出时 harness 会自动重新唤起，而中途唯一会出现的增量信息就是 `✗ <slug>` 失败行，跑完从日志里一样读得到，提前十分钟看到并不能让人多做什么。

### 步骤 3 — 门禁：失败即停

若退出码非零：

- 从日志中原样提取所有 `✗ <slug>` 行呈报。
- 给出定向重试命令：`npm run translate -- --only=<失败的 slug,逗号分隔>`。
- **就此停止。** 不跑校验，不汇报产出。

注意：即便有文章失败，manifest 仍已被重建（这是 pipeline 的既定行为，见 `index.ts` 的注释——`--only`/`--limit` 或含失败的运行都不应把其他文章从首页索引里挤掉）。工作区因此仍处于一个自洽状态，无需回滚。

### 步骤 4 — 识别本次产出

取快照 B：`git status --short content/articles/`。B 减去 A 即本次运行引入的改动。

- untracked（`??`）→ 新文章。从各自的 JSON 里读出 `titleZh` 一并呈报。
- modified（` M`）→ PG 修订过的旧文章。

快照刻意只覆盖 `content/articles/`，不含 `content/manifest.json`。后者每次运行都会被重写（`generatedAt` 是当前时间戳），即便源站毫无变化也必然显示为 modified——把它纳入快照只会制造噪声。报告中应说明这一点，以免使用者误以为它代表真实变更。

### 步骤 5 — 校验

- `npm run test` — vitest 跑 pipeline 单测，确认解析/对齐逻辑未坏。
- `npm run build` — Astro 的 content collection 用 `ArticleSchema` (Zod) 重新校验 `content/articles/` 下的全部 JSON。这是唯一真正检查**本次产出内容**的关卡，且不调用任何 API，很便宜。

任一失败即如实呈报失败输出，不宣称完成。

### 步骤 6 — 汇报并停下

一次性给出：

- 新增文章：slug + 中文标题。
- 被修订的旧文章：slug。
- `rawUnsupported` 段落：slug + id（转述 pipeline 摘要即可）。提示人工确认这些不是被漏掉的正文。
- 若步骤 1 记录到预先存在的未提交改动，在此声明。

改动留在工作区。提交与发布由使用者决定。

## 4. 错误处理小结

| 情形 | 行为 |
|---|---|
| 缺凭证 / Node 版本过低 | 步骤 1 即停，不发起任何网络请求 |
| 部分文章翻译失败 | 步骤 3 停止，给出失败 slug 与定向重试命令 |
| 全部成功但 `npm run build` 失败 | 如实呈报构建输出，不宣称完成 |
| 无任何新增/修订 | 正常走完校验，汇报「源站无变化」 |
| content/ 预先存在未提交改动 | 不阻断；快照相减隔离本次产出，并在报告中声明 |

## 5. 明确不做的事（YAGNI）

- 不 commit、不 push、不触发部署。
- 不做 `--only=` 定向翻译的自动路径（失败重试时作为建议命令给出，由人执行）。
- 不拉取 `rawUnsupported` 段落原文。
- 不做翻译质量评估或人工润色。
- 不新增 `scripts/` 包装脚本——那会把 pipeline 的摘要格式复制一份出去，摘要一改脚本就静默失灵。
