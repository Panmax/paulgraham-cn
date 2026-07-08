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
│  (本地 Node 脚本)│ ──▶ │  content/*.md    │ ──▶ │  (静态生成)      │
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
│   ├── earn.md                 # 每篇文章一个文件
│   ├── ...
│   └── manifest.json           # 全站文章索引 + 原文 hash
├── pipeline/                   # 翻译流水线（Node 脚本）
│   ├── scrape.js               # 抓取 + 解析 PG 原文
│   ├── translate.js            # 调 Vertex/Gemini 翻译
│   ├── glossary.json           # PG 术语中文对照表
│   └── index.js                # 编排：抓取→翻译→写盘
├── src/                        # Astro 站点
│   ├── content/config.ts       # Content Collections schema (Zod)
│   ├── pages/
│   │   ├── index.astro         # 首页文章列表
│   │   └── [slug].astro        # 文章页
│   ├── components/
│   └── layouts/
├── public/
│   └── _redirects              # /earn.html → /earn 路由
├── astro.config.mjs
├── .gitignore
└── package.json
```

---

## 3. 内容文件格式

每篇文章一个 `content/<slug>.md`：

```markdown
---
slug: earn
title_en: How to Earn a Billion Dollars
title_zh: 如何赚到十亿美元
date: June 2026
source_url: https://paulgraham.com/earn.html
source_hash: a3f5c9...        # 原文正文 SHA-256，用于更新检测
translated_at: 2026-07-08
model: gemini-3.5-flash
---

<!-- para -->
en: When I was young, I thought...
zh: 我年轻时以为……

<!-- para -->
en: The most successful founders...
zh: 最成功的创始人……
```

**设计要点：**

- **段落对照**：整篇原文带段落编号一次性喂给 Gemini，要求返回**同样段落数、同序号**的译文。脚本校验段落数一致，不一致则重试。兼得全篇上下文（翻译连贯）与段落级配对（用于对照）。
- **原文与译文并排存储**：站点渲染"纯中文 / 悬浮看原文 / 双语对照"都无需再抓原文；diff 时能看清原文改了哪段。
- **frontmatter 承载元数据**：`source_hash` 驱动更新检测；`source_url` 渲染原文链接；`title_en/zh` 支持标题双语。
- **人工可改**：直接编辑 `zh:` 行修正译文；只要原文不变（hash 不变）永不被重翻覆盖。
- **行内元素**：译文**保留超链接**（Markdown 格式），指向 paulgraham.com 原链接。斜体等行内格式一并保留。

### manifest.json

全站文章索引，记录每篇的 `slug`、`title_zh`、`date`、`source_hash`、`translated_at`，用于：
1. 更新检测时快速对比 hash；
2. 站点首页列表数据来源（也可由 Astro 直接扫描 content/ 生成）。

---

## 4. 翻译流水线

**触发**：本地 `npm run translate`。

**流程**（`pipeline/index.js` 编排）：

1. **抓取列表**：拉取 `articles.html`，解析出全部文章的 slug 与链接。
2. **抓取正文**：对每篇文章拉取 HTML。PG 页面为经典 table 布局 + `<font>` 标签，正文常用 `<br><br>` 分段，标题多为图片——需针对性解析，提取纯正文段落数组、标题、日期。
3. **更新检测**：对原文正文计算 SHA-256，与 `content/<slug>.md` 里的 `source_hash` 对比：
   - 新文章（无对应文件）→ 翻译。
   - hash 变化 → 重翻（覆盖，人工手改会被覆盖，属已知取舍）。
   - hash 未变 → 跳过（保留人工手改）。
4. **翻译**：整篇喂给 Gemini（见第 5 节），拿到段落对照译文。
5. **校验**：段落数与原文一致；不一致则重试。
6. **写盘**：生成/更新 `content/<slug>.md` 与 `manifest.json`。

**健壮性**：失败指数退避重试；并发上限（避免一次性 200+ 请求打爆配额）；单篇失败不阻断其余文章。

---

## 5. 翻译调用（Vertex AI）

- **模型**：`gemini-3.5-flash`
- **SDK**：`@google-cloud/vertexai`（Node.js）
- **凭证**：Service Account 证书 `credentials/gemini-vertex.json`，通过 `GOOGLE_APPLICATION_CREDENTIALS` 指向。
- **Project**：`live-card-491105`（读自证书）。
- **安全**：`credentials/` 已加入 `.gitignore`，证书永不入库。
- **调用形态**：每篇文章一次 API 调用（整篇翻译），结构化输出约束段落对照。

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

- **Content Collections** 管理 `content/*.md`，Zod 校验 frontmatter schema。
- **URL 一致**：`earn.html` → 生成 `/earn`，并通过 `public/_redirects` 让 `/earn.html` 命中同一页。

### 页面

- **首页 `/`**（对应 `articles.html`）：文章列表，按发表时间倒序，显示中文标题 + 英文原标题 + 日期。
- **文章页 `/<slug>`**：顶部显示中英标题、日期、**原文链接**（指向 `paulgraham.com/<slug>.html`）；正文默认纯中文。

### 阅读模式（核心交互）

默认纯中文，模式选择记在 localStorage：

- **纯中文模式**（默认）：只显示译文。每段可**悬浮/点击查看原文**——桌面端 hover 显示原文浮层，移动端点击展开。
- **双语对照模式**：每段中英并排（宽屏左右分栏 / 窄屏上下堆叠）。

原文和译文都已存在 Markdown 中，交互只需**少量客户端 JS**（Astro island），其余零 JS。

### 视觉风格

- **极简阅读风**：以阅读为中心的现代排版（大字号、宽行高、窄内容宽度、柔和背景色）。
- **亮/暗双主题**：跟随系统并可手动切换。
- **字体**：中文正文用优秀开源中文字体（思源宋体 / 系统字体栈），英文原文用衬线体呼应 PG 原味。

---

## 7. 部署

- **Cloudflare Pages** 连接 Git 仓库，构建命令 `astro build`，输出 `dist/`。
- 构建**不调用任何 API**（翻译已在本地完成入库），构建快速、免密钥。
- `public/_redirects` 处理 `.html` 后缀路由。
- 自定义域名 paulgraham-cn.com 绑定到 Pages。

---

## 8. 更新工作流

后续原文更新时：

1. 本地跑 `npm run translate`。
2. 脚本按 hash 对比：新文章翻译、改动文章重翻、未变跳过。
3. 检查 `git diff content/` 确认变更。
4. 提交推送 → Cloudflare Pages 自动构建部署。

---

## 9. 已知取舍

- **重翻覆盖手改**：hash 变化触发重翻会覆盖该篇的人工修改。取舍合理——原文变了本就该重译；未变的文章手改永久保留。
- **首次翻译成本**：一次性翻 200+ 篇有一定 API 成本，但因入库只跑一次、后续增量，长期成本极低。
- **PG 页面解析脆弱性**：PG 原站 HTML 古老且不规范，解析器需容错；个别特殊排版文章可能需人工微调。

---

## 10. 非目标（YAGNI）

- 不做用户账号、评论、搜索（首版）。
- 不做在线实时翻译 / 构建时翻译。
- 不做 CMS 后台——内容即 Markdown，编辑器即文本编辑器 + Git。
- 不做多语言（仅中文）。
