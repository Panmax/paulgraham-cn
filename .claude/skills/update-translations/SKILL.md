---
name: update-translations
description: Use when paulgraham.com has published new essays or revised old ones and the Chinese site needs to catch up — "源站更新了", "PG 发新文章了", "同步源站", "更新翻译", "跑一下翻译", "sync the source site". Runs the full incremental translate, gates on failures, reports what changed, and stops before committing.
---

# 更新翻译

跑全量增量翻译，把住失败与校验关卡，报告本次产出，**停在待提交状态**。

不 commit、不 push、不触发部署。发布是外向动作，由人拍板。

## 步骤 1 — 前置检查

在花掉 227 次抓取之前先失败：

```bash
test -f credentials/gemini-vertex.json || echo "MISSING CREDENTIALS"
node -v   # 需 >= 22.12.0
```

缺凭证或 Node 版本过低就停下告诉用户，**不要**发起任何网络请求。

不必检查工作区是否干净。归因来自 pipeline 的输出而非文件状态。未提交的手工译文也是安全的：`assembleArticle` 先读盘上的旧文章，`sourceHash` 未变的 segment 会保留其 `zhMarkdown`，模型不会覆盖它。

## 步骤 2 — 全量增量翻译

**必须后台运行。** 227 篇抓取加上新文章的 Gemini 调用可能超过前台 10 分钟超时。

```bash
export GOOGLE_APPLICATION_CREDENTIALS=credentials/gemini-vertex.json
npm run translate 2>&1 | tee <scratchpad>/translate.log
```

用 `run_in_background: true`。**不要轮询。** 后台命令退出时 harness 会自动把你叫回来；中途唯一会出现的增量信息是 `✗ <slug>` 失败行，跑完从日志里一样读得到。

启动后告诉用户翻译已在后台跑起来，然后安静等它退出。

不要用 `--only=`。全量才能同时捕获新文章与 PG 对旧文章的静默修订；未变 segment 靠 `sourceHash` 对齐跳过，API 花费接近零。

## 步骤 3 — 门禁：失败即停

退出码非零意味着有文章翻译失败。此时：

1. 原样呈报日志里所有 `✗ <slug>: ...` 行。
2. **同时呈报日志里的 `⚠ rawUnsupported` 段落。** 这些告警是无条件打印的，日志里已经有了。此刻丢弃的话，后续 `--only=<失败 slug>` 重试只会输出那几篇的告警，其余文章的告警就永久丢失了。
3. 给出定向重试命令：`npm run translate -- --only=<失败的 slug,逗号分隔>`
4. **就此停止**，不跑校验。

无需回滚。即便部分失败，manifest 仍已从磁盘上的全部文章重建，工作区处于自洽状态。

## 步骤 4 — 识别本次产出

摘要里这一行**每次都有**，是权威计数：

```
articles  added:2 updated:1 unchanged:224
```

具体 slug 在下面两行。它们是条件打印的——列表为空时整行不输出，所以不要因为找不到就以为解析失败：

```
+ added: slug1, slug2
~ updated: slug3
```

新文章的中文标题从 `content/articles/<slug>.json` 的 `titleZh` 读出。

**不要**用 `git status` 相减来判断改了什么。`git status` 只描述相对 HEAD 的状态：一个本就 ` M` 的文件被 pipeline 再改一次仍是 ` M`，相减会漏报。pipeline 的 per-article 输出才是权威。

## 步骤 5 — 校验

```bash
npm run test    # vitest：确认解析/对齐逻辑未坏
npm run build   # Astro 用 ArticleSchema (Zod) 重新校验全部文章 JSON
```

`npm run build` 是唯一真正检查**本次产出内容**的关卡，且不调用任何 API。

任一失败就如实呈报失败输出，**不要宣称完成**。

## 步骤 6 — 汇报并停下

一次性给出：

- **新增文章**：slug + 中文标题
- **被修订的旧文章**：slug
- **`rawUnsupported` 段落**：slug + id，并提示人工确认这些不是被漏掉的正文
- 源站无变化时明确说「无变化，未产生任何改动」

改动留在工作区。提交与发布由用户决定。

### 关于「工作区干净」

`npm run translate` 是幂等的：源站无变化时它**不写任何文件**，`git status` 会是干净的。看到干净的工作区不代表没跑成——那正是无变化时的正确结果。

（历史上并非如此：`translatedAt` 曾被无条件写入，导致隔天跑一次就把 227 个文件全改脏。见 `articleContentEqual`。）
