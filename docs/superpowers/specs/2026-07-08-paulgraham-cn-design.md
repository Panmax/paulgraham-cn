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

三部分，通过 Git 仓库里的**中间产物（结构化 JSON）**解耦：

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  翻译流水线      │     │  内容仓库         │     │  Astro 站点      │
│  (本地 Node 脚本)│ ──▶ │ articles/*.json  │ ──▶ │  (静态生成)      │
│  抓取→翻译→写盘  │     │  + manifest.json │     │  部署到 CF Pages │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**关键原则：翻译流水线与站点完全解耦。**

- 流水线只负责往 `content/articles/` 写结构化 JSON。
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
│   └── manifest.json           # 由 articles/*.json 派生的索引（由 translate 生成并提交，勿手改）
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
  "dateText": "June 2026",
  "publishedAt": "2026-06-01",
  "sourceOrder": 214,
  "sourceUrl": "https://paulgraham.com/earn.html",
  "translatedAt": "2026-07-08",
  "model": "gemini-3.5-flash",
  "segments": [
    {
      "id": 1,
      "type": "paragraph",
      "sourceHash": "a3f5c9...",
      "enMarkdown": "When I was young, I thought...",
      "zhMarkdown": "我年轻时以为……"
    },
    {
      "id": 2,
      "type": "paragraph",
      "sourceHash": "b71e04...",
      "enMarkdown": "The most successful [founders](https://paulgraham.com/founders.html)...",
      "zhMarkdown": "最成功的[创始人](https://paulgraham.com/founders.html)……"
    },
    { "id": 3, "type": "hr", "sourceHash": "…" }
  ]
}
```

**字段说明：**

- **`type`**：segment 类型，`paragraph | heading | hr | list | quote | footnote | rawUnsupported`。保真范围里的非段落块（分隔线、脚注、列表、引用等）不再硬塞进"段落"，各有类型，渲染与更新 diff 都更稳。`hr` 等无正文的块可省略 `enMarkdown/zhMarkdown`；`rawUnsupported` 用于解析器无法归类的块，保留原始文本、渲染时按纯文本处理不翻译——但这有把真实正文误判、导致中文站静默露出大段英文的风险，故 translate 结束时须在 summary 里列出所有 `rawUnsupported` 的文件与 segment id，数量非零时人工确认（见第 4 节）。
- **`dateText` / `publishedAt` / `sourceOrder`**：`dateText` 是原文日期字符串（如 "June 2026"）仅供展示；`publishedAt` 是解析出的 ISO 日期；`sourceOrder` 是原文 `articles.html` 列表中的出现次序。首页排序固定为 **`publishedAt` 降序、`sourceOrder` 升序 tie-break**（PG 多为月份级日期，同月多篇会同一天，靠 `sourceOrder` 保证稳定确定的顺序）；`publishedAt` 解析失败的文章按其 `sourceOrder` 就位。
- **`id`**：段落稳定标识，更新时不重排（见第 8 节对齐算法）。

**设计要点：**

- **段落对照**：整篇原文带段落编号一次性喂给 Gemini，要求返回**同样段落数、同序号**的译文（结构化输出，见第 5 节）。脚本校验段落数一致，不一致则重试。兼得全篇上下文（翻译连贯）与段落级配对（用于对照）。
- **段落级 sourceHash**：每个 segment 单独记录原文段落的 SHA-256。这是更新检测的最小粒度（见第 8 节），使 PG 改一处错字不会毁掉整篇人工润色。
- **原文与译文并排存储**：`enMarkdown` / `zhMarkdown` 并存。站点渲染"纯中文 / 悬浮看原文 / 双语对照"都无需再抓原文；diff 时能看清哪段变了。
- **行内内容为 Markdown**：段落正文以 Markdown 存储，译文**保留超链接**指向 paulgraham.com 原链接，斜体等行内格式一并保留。渲染安全边界见第 6 节。
- **人工可改**：直接编辑 `zhMarkdown` 修正译文；只要对应段落的 `sourceHash` 不变，该段永不被重翻覆盖。

### manifest.json（派生索引）

**由翻译流水线生成并提交入库**（不是 Astro build 时生成）。记录每篇的 `slug`、`titleZh`、`dateText`、`publishedAt`、`sourceOrder`、`translatedAt`，供更新检测快速枚举、以及首页列表读取。

- **归属明确**：`npm run translate` 结束时重建并写盘 `content/manifest.json`，随文章 JSON 一起 `git commit`。Astro build **只读不写**它。
- **单一事实来源仍是 `content/articles/*.json`**；manifest 是它们的派生缓存，永不手改，可随时由 content 重新生成。首页排序/标题一律可回溯到 content，不存在两处漂移。

---

## 4. 翻译流水线

**触发**：本地 `npm run translate`。

**流程**（`pipeline/index.js` 编排）：

1. **抓取列表**：拉取 `articles.html`，解析出全部文章的 slug 与链接。
2. **抓取正文**：对每篇文章拉取 HTML，按下述**保真范围**解析为有序段落数组、标题、日期。
3. **更新检测**（段落级对齐，见第 8 节）：新段落序列与已存 segments 做 LCS + 相似度对齐，判定未变/已改/新增/删除，只重翻已改和新增段落。
4. **翻译**：变更段落连同全篇上下文一起喂给 Gemini（见第 5 节），拿到段落对照译文。
5. **校验**：结构化输出 schema + 段落数一致 + 链接/数字/专名校验（见第 5 节质量门禁）；不通过则重试。
6. **写盘**：写回 `content/articles/<slug>.json`；`manifest.json` 由 content 派生重建。

**抓取保真范围**（PG 原站 HTML 古老不规范，需先明确保留什么）：

- **必须保留**：正文段落文本、段落顺序、行内超链接（`<a href>`，指向原站）、行内强调（斜体/粗体）、脚注引用及脚注内容、`<hr>` 等语义分隔。
- **允许丢弃**：纯装饰图片、导航图片、`<font>` 等样式标签、间距用的空 `<br>`。
- **标题为图片时**：标题多为图片，取自页面 `<title>` 或图片 `alt`/文件名回退，必要时人工补 `titleEn`。

**健壮性**：失败指数退避重试；并发上限（避免一次性 200+ 请求打爆配额）；单篇失败不阻断其余文章。

**运行 summary**：translate 结束时输出汇总报告——本次新增/更新/跳过/失败的文章数，以及**所有 `rawUnsupported` 块的文件与 segment id**。`rawUnsupported` 数量非零时提示人工确认，防止真实正文被误判后静默露出英文。

---

## 5. 翻译调用（Vertex AI）

- **模型**：`gemini-3.5-flash`
- **SDK**：`@google/genai`（Node.js）——Google 现行统一 SDK，旧的 `@google-cloud/vertexai` 已被其取代，新项目直接用 `@google/genai`（以 Vertex AI 模式初始化）。
- **凭证**：Service Account 证书 `credentials/gemini-vertex.json`，通过 `GOOGLE_APPLICATION_CREDENTIALS` 指向。
- **Project**：`live-card-491105`（读自证书）。
- **安全**：`credentials/` 已加入 `.gitignore`，证书永不入库。
- **调用形态**：每篇文章一次 API 调用。请求里**始终附上全篇所有可翻译 segment 作为上下文**（保证连贯与术语统一），但**要求模型只返回待翻译 segment 的译文**——首次翻译是全部待翻译 segment，增量更新时是已改/新增段（第 8 节）。

**可翻译 segment**：`paragraph | heading | list | quote | footnote`。`hr` 与 `rawUnsupported` 无 `zhMarkdown` 字段，**不进入翻译请求，也不参与译文校验**。

### 质量门禁

拒绝机械翻译的同时也要挡住漏译/误译/链接丢失。校验分层：

- **结构化输出 schema**：要求模型只返回**待翻译 segment** 的 `{ segments: [{ id, zhMarkdown }] }`，返回的 id 集合须与请求的待翻译 id 集合**完全一致**（不多不少、序号对应）。
- **机械校验**（可自动执行，失败即重试，仅对可翻译 segment）：id 集合一致；每段行内链接的 URL 集合与原文一致（不新增、不丢失）；数字与专有名词（人名、公司名）不缺失。
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

- **首页 `/`**（对应 `articles.html`）：文章列表，排序为 `publishedAt` 降序、`sourceOrder` 升序 tie-break，显示中文标题 + 英文原标题 + 日期。
- **文章页 `/<slug>.html`**：顶部显示中英标题、日期、**原文链接**（指向 `paulgraham.com/<slug>.html`）；正文默认纯中文。

### 阅读模式（核心交互）

默认纯中文，模式选择记在 localStorage：

- **纯中文模式**（默认）：只显示译文。每段可**悬浮/点击查看原文**——桌面端 hover 显示原文浮层，移动端点击展开。
- **双语对照模式**：每段中英并排（宽屏左右分栏 / 窄屏上下堆叠）。

原文和译文都已存在 JSON segment 中，交互只需**少量客户端 JS**（Astro island），其余零 JS。

### Markdown 渲染安全边界

段落正文（原文与译文）都是 Markdown，且译文来自模型输出——即便源站可信，模型仍可能吐出 raw HTML、`javascript:` 链接或异常属性。渲染前强制约束：

- **禁用 raw HTML**：Markdown 渲染器（remark/rehype）配置为不透传原始 HTML，或经 `rehype-sanitize` 白名单过滤，只放行 `a / em / strong / code / ul / ol / li / blockquote / hr / p` 等安全标签与属性。
- **链接协议白名单**：`<a href>` 只允许 `http` / `https` / `mailto`，其余（`javascript:`、`data:` 等）一律剥离。
- **URL 校验与规范化**：入库前（质量门禁，第 5 节）就校验并规范化链接集合，渲染层是第二道防线。
- 该处理对原文和译文两侧同等生效。

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
2. 脚本抓取原文并解析为新段落序列，与已存 JSON 的 old segments 做**段落对齐**（算法见下），得到每个新段落的处置：命中未变 / 命中已改 / 新增 / 删除。
3. 按处置执行：
   - **命中未变**（`sourceHash` 相同）→ 沿用旧 segment 的 `id` 与 `zhMarkdown`，人工手改不受影响。
   - **命中已改**（对齐到某旧段但文本变了）→ 沿用其 `id`，仅重翻该段（带全篇上下文），覆盖 `zhMarkdown`，更新 `sourceHash`。
   - **新增**（未对齐到任何旧段）→ 分配**新 id**（取当前最大 id + 1，不复用），翻译并按位置插入。
   - **删除**（旧段未被任何新段命中）→ 移除该 segment。
   - 全新文章 → 整篇翻译。
4. 检查 `git diff content/` 确认变更（段落级 diff，清晰可审）。
5. 提交推送 → Cloudflare Pages 自动构建部署。

### 段落对齐算法

只按数组下标或数字 `id` 匹配会在"中间插一段"时让后续全部错位、在"拆段/合段"时丢掉人工润色。因此分两步匹配：

1. **精确锚定**：先用 `sourceHash` 在 old / new 段落间求 **LCS（最长公共子序列）**，把 hash 完全相同的段落两两锚定为"未变"。稳定段落的 `id` 保持不变、不重排。
2. **相似度匹配**：对 LCS 未覆盖的段落，在相邻锚点之间的区间内做**文本相似度匹配**（如归一化 Levenshtein / token Jaccard，设阈值）。超过阈值 → 判为"命中已改"，继承旧 `id`；低于阈值 → 判为"新增"。区间内旧段若始终无人认领 → "删除"。
3. **id 分配**：新增段落一律取新 id，绝不复用被删段落的 id，保证 id 语义稳定、diff 可读。

拆段（1→2）会自然表现为：一段命中已改 + 一段新增；合段（2→1）表现为：一段命中已改 + 一段删除。人工润色只在真正对应的原文段落变化时才被覆盖。

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
