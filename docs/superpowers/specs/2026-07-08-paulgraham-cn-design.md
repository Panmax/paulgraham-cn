# paulgraham-cn.com 设计文档

**日期**：2026-07-08
**目标**：把 Paul Graham 官网（https://paulgraham.com/articles.html）的全部文章翻译成中文，部署为一个现代化的中文阅读站点 paulgraham-cn.com。

---

## 1. 概述与核心目标

- 将 PG 官网 200+ 篇文章**一次性全部翻译**成中文并上线。
- **URL 路径与原文保持一致**：`paulgraham.com/earn.html` ↔ `paulgraham-cn.com/earn.html` 是同一篇。
- 阅读体验以**纯中文为主**，支持**段落级对照原文**（悬浮/点击看原文、双语对照模式）。
- 翻译追求**信达雅**，拒绝机械翻译。
- 部署在 **Cloudflare Pages**。
- 支持**后续文章更新**（原文新增或修订时增量重翻）。

---

## 2. 整体架构

三部分，通过 Git 仓库里的**中间产物（Markdown + 元数据）**解耦：

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  翻译流水线      │     │  内容仓库         │     │  Astro 站点      │
│  (本地 Node 脚本)│ ──▶ │ articles/*.json  │ ──▶ │  (静态生成)      │
│  抓取→翻译→写盘  │     │  + manifest.json │     │  部署到 CF Pages │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**关键原则：翻译流水线与站点完全解耦。**

- 流水线只负责往 `content/` 写 Markdown。
- 站点只负责读 `content/` 生成静态页面，**构建时不调用任何 API**——零成本、可离线、可即时预览。
- 中间产物是人工可读、可手改、可进 Git diff 的核心资产。

### 目录结构（规划）

```
paulgraham-cn/
├── credentials/
│   └── gemini-vertex.json      # Service Account 证书（.gitignore，永不入库）
├── content/
│   ├── articles/
│   │   ├── earn.json           # 每篇文章一个结构化 JSON
│   │   └── ...
│   └── manifest.json           # 由 articles/*.json 派生的索引（构建时生成，勿手改）
├── pipeline/                   # 翻译流水线（Node 脚本）
│   ├── scrape.js               # 抓取 + 解析 PG 原文
│   ├── translate.js            # 调 Gemini 翻译（@google/genai）
│   ├── glossary.json           # PG 术语中文对照表
│   └── index.js                # 编排：抓取→翻译→写盘
├── src/                        # Astro 站点
│   ├── content.config.ts       # Content Collections：glob() loader + Zod schema
│   ├── pages/
│   │   ├── index.astro         # 首页文章列表
│   │   └── [slug].html.astro   # 文章页（直接生成 /earn.html）
│   ├── components/
│   └── layouts/
├── astro.config.mjs
├── .gitignore
└── package.json
```

---

## 3. 内容文件格式

每篇文章一个 **JSON 文件** `content/articles/<slug>.json`。用 JSON 而非 Markdown body 里的自定义 `en:`/`zh:` 协议——后者遇到多行段落、列表、引用、冒号、空行、行内 HTML 等会被打穿，无法可靠解析。结构化 JSON 是机器可靠、Astro Content Collections（`glob()` loader + Zod schema）可直接加载的数据格式。

```json
{
  "slug": "earn",
  "titleEn": "How to Earn a Billion Dollars",
  "titleZh": "如何赚到十亿美元",
  "date": "June 2026",
  "sourceUrl": "https://paulgraham.com/earn.html",
  "translatedAt": "2026-07-08",
  "model": "gemini-3.5-flash",
  "segments": [
    {
      "id": 1,
      "sourceHash": "a3f5c9...",
      "enMarkdown": "When I was young, I thought...",
      "zhMarkdown": "我年轻时以为……"
    },
    {
      "id": 2,
      "sourceHash": "b71e04...",
      "enMarkdown": "The most successful [founders](https://paulgraham.com/founders.html)...",
      "zhMarkdown": "最成功的[创始人](https://paulgraham.com/founders.html)……"
    }
  ]
}
```

**设计要点：**

- **段落对照**：整篇原文带段落编号一次性喂给 Gemini，要求返回**同样段落数、同序号**的译文（结构化输出，见第 5 节）。脚本校验段落数一致，不一致则重试。兼得全篇上下文（翻译连贯）与段落级配对（用于对照）。
- **段落级 sourceHash**：每个 segment 单独记录原文段落的 SHA-256。这是更新检测的最小粒度（见第 8 节），使 PG 改一处错字不会毁掉整篇人工润色。
- **原文与译文并排存储**：`enMarkdown` / `zhMarkdown` 并存。站点渲染"纯中文 / 悬浮看原文 / 双语对照"都无需再抓原文；diff 时能看清哪段变了。
- **行内内容为 Markdown**：段落正文以 Markdown 存储，译文**保留超链接**指向 paulgraham.com 原链接，斜体等行内格式一并保留。
- **人工可改**：直接编辑 `zhMarkdown` 修正译文；只要对应段落的 `sourceHash` 不变，该段永不被重翻覆盖。

### manifest.json（派生索引）

由 `content/articles/*.json` **构建时自动生成**的派生产物，记录每篇的 `slug`、`titleZh`、`date`、`translatedAt`，供首页列表与更新检测快速读取。

**单一事实来源是 `content/articles/*.json`**；manifest 只是缓存，永不手改。首页排序/标题一律以 content 为准，不存在两处漂移。

---

## 4. 翻译流水线

**触发**：本地 `npm run translate`。

**流程**（`pipeline/index.js` 编排）：

1. **抓取列表**：拉取 `articles.html`，解析出全部文章的 slug 与链接。
2. **抓取正文**：对每篇文章拉取 HTML，按下述**保真范围**解析为有序段落数组、标题、日期。
3. **更新检测**（段落级，见第 8 节）：对每个原文段落计算 SHA-256，与已存 JSON 中各 segment 的 `sourceHash` 对比，只重翻变更/新增段落。
4. **翻译**：变更段落连同全篇上下文一起喂给 Gemini（见第 5 节），拿到段落对照译文。
5. **校验**：结构化输出 schema + 段落数一致 + 链接/数字/专名校验（见第 5 节质量门禁）；不通过则重试。
6. **写盘**：写回 `content/articles/<slug>.json`；`manifest.json` 由 content 派生重建。

**抓取保真范围**（PG 原站 HTML 古老不规范，需先明确保留什么）：

- **必须保留**：正文段落文本、段落顺序、行内超链接（`<a href>`，指向原站）、行内强调（斜体/粗体）、脚注引用及脚注内容、`<hr>` 等语义分隔。
- **允许丢弃**：纯装饰图片、导航图片、`<font>` 等样式标签、间距用的空 `<br>`。
- **标题为图片时**：标题多为图片，取自页面 `<title>` 或图片 `alt`/文件名回退，必要时人工补 `titleEn`。

**健壮性**：失败指数退避重试；并发上限（避免一次性 200+ 请求打爆配额）；单篇失败不阻断其余文章。

---

## 5. 翻译调用（Vertex AI）

- **模型**：`gemini-3.5-flash`
- **SDK**：`@google/genai`（Node.js）——Google 现行统一 SDK，旧的 `@google-cloud/vertexai` 已被其取代，新项目直接用 `@google/genai`（以 Vertex AI 模式初始化）。
- **凭证**：Service Account 证书 `credentials/gemini-vertex.json`，通过 `GOOGLE_APPLICATION_CREDENTIALS` 指向。
- **Project**：`live-card-491105`（读自证书）。
- **安全**：`credentials/` 已加入 `.gitignore`，证书永不入库。
- **调用形态**：每篇文章一次 API 调用（整篇上下文），结构化输出约束段落对照。

### 质量门禁

拒绝机械翻译的同时也要挡住漏译/误译/链接丢失。校验分层：

- **结构化输出 schema**：要求模型返回 `{ segments: [{ id, zhMarkdown }] }`，段落数、序号与输入严格对应。
- **机械校验**（可自动执行，失败即重试）：段落数一致；每段行内链接的 URL 集合与原文一致（不新增、不丢失）；数字与专有名词（人名、公司名）不缺失。
- 译文质量本身依赖信达雅 prompt（下文）+ 事后人工手改（第 8 节）。**不设 draft/待审队列**——与"直接发布，事后手改"的产品决策一致，段落级 hash 已保证手改不被误覆盖。

### 翻译质量：信达雅（核心要求）

拒绝机械翻译。通过 prompt 工程达成：

- **译者人设**：深谙中英双语、熟悉 Paul Graham 思想与创业/技术语境的资深译者，目标是让中文读者读起来像 PG 本人用中文写作。
- **信达雅三层要求**：
  - **信**：准确传达原意与逻辑，不漏译、不曲解、不自行发挥。
  - **达**：符合中文表达习惯，破除英文长句从句嵌套，重组为地道流畅的中文，而非逐词硬译。
  - **雅**：保留 PG 简洁、平实、犀利又不失幽默的文风。
- **整篇上下文翻译**：全篇一起翻译，把握整体论证与语气，前后术语统一。
- **术语表**（`pipeline/glossary.json`）：PG 高频术语中文对照（hacker→黑客、startup→创业公司 等），随 prompt 传入，保证全站译法一致。
- **few-shot 示例**：prompt 中放 1-2 段高质量 PG 中译范例，锚定风格。

---

## 6. 站点前端与阅读体验

**技术栈**：Astro 静态站，部署 Cloudflare Pages。

- **Content Collections** 用 `glob()` loader 加载 `content/articles/*.json`，Zod 校验 schema。
- **URL 一致（直接生成 `.html`）**：文章页路由为 `src/pages/[slug].html.astro`（或 `getStaticPaths` 产出 `earn.html` 这样的路径），**直接生成 `/earn.html`** 静态文件，与原文一一对应。不走 `_redirects` 302 跳转——那会让 canonical URL、分享链接和 SEO 偏离目标。canonical 标签指向自身 `paulgraham-cn.com/<slug>.html`。

### 页面

- **首页 `/`**（对应 `articles.html`）：文章列表，按发表时间倒序，显示中文标题 + 英文原标题 + 日期。
- **文章页 `/<slug>.html`**：顶部显示中英标题、日期、**原文链接**（指向 `paulgraham.com/<slug>.html`）；正文默认纯中文。

### 阅读模式（核心交互）

默认纯中文，模式选择记在 localStorage：

- **纯中文模式**（默认）：只显示译文。每段可**悬浮/点击查看原文**——桌面端 hover 显示原文浮层，移动端点击展开。
- **双语对照模式**：每段中英并排（宽屏左右分栏 / 窄屏上下堆叠）。

原文和译文都已存在 JSON segment 中，交互只需**少量客户端 JS**（Astro island），其余零 JS。

### 视觉风格

- **极简阅读风**：以阅读为中心的现代排版（大字号、宽行高、窄内容宽度、柔和背景色）。
- **亮/暗双主题**：跟随系统并可手动切换。
- **字体**：中文正文用优秀开源中文字体（思源宋体 / 系统字体栈），英文原文用衬线体呼应 PG 原味。

---

## 7. 部署

- **Cloudflare Pages** 连接 Git 仓库，构建命令 `astro build`，输出 `dist/`。
- 构建**不调用任何 API**（翻译已在本地完成入库），构建快速、免密钥。
- 文章页在构建时**直接生成 `/<slug>.html`** 静态文件，与原文路径一一对应；无需 `_redirects` 跳转。
- 自定义域名 paulgraham-cn.com 绑定到 Pages。

---

## 8. 更新工作流

**段落级增量更新**——PG 改一处错字不会毁掉整篇人工润色：

1. 本地跑 `npm run translate`。
2. 脚本抓取原文，逐段计算 `sourceHash`，与已存 JSON 各 segment 对比：
   - **新增段落** → 翻译并插入。
   - **`sourceHash` 变化的段落** → 仅重翻该段（带全篇上下文），只覆盖这一段的 `zhMarkdown`。
   - **`sourceHash` 未变的段落** → 原样保留，人工手改不受影响。
   - **原文删除的段落** → 移除对应 segment。
   - 全新文章 → 整篇翻译。
3. 检查 `git diff content/` 确认变更（段落级 diff，清晰可审）。
4. 提交推送 → Cloudflare Pages 自动构建部署。

---

## 9. 已知取舍

- **段落级重翻覆盖该段手改**：某段原文变化会重翻并覆盖该段的人工修改，但仅限该段；未变段落的手改永久保留。合理——原文那段变了本就该重译。
- **首次翻译成本**：一次性翻 200+ 篇有一定 API 成本，但因入库只跑一次、后续段落级增量，长期成本极低。
- **PG 页面解析脆弱性**：PG 原站 HTML 古老且不规范，解析器需容错；个别特殊排版文章可能需人工微调（尤其标题图片的 `titleEn`）。

---

## 10. 非目标（YAGNI）

- 不做用户账号、评论、搜索（首版）。
- 不做在线实时翻译 / 构建时翻译。
- 不做 CMS 后台——内容即 JSON，编辑器即文本编辑器 + Git。
- 不做 draft/待审队列与人工审校流程——直接发布，段落级 hash 保证手改不被误覆盖。
- 不做多语言（仅中文）。
