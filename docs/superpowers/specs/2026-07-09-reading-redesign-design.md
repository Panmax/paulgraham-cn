# 阅读体验重设计 — 设计文档

**日期:** 2026-07-09
**范围:** `src/` 站点前端 + 一个构建时字体子集步骤。**不改动** `pipeline/` 翻译逻辑与 `content/*.json` 数据结构。

## 目标

把站点从「命名了 Noto Serif SC 却从未加载」的朴素排版，升级为**精致文学杂志风**的中文阅读体验。四个既定痛点全部处理：中文字体/排版、双语切换、首页/导航、整体视觉气质。

## 设计决策（已与用户确认）

- 气质方向：**精致文学杂志风**（克制、以文字为主角）。
- 阅读页版式：**静谧古典**（居中标题、英文栏眉、发丝分隔线、中文段落首行缩进、舒展行距，无首字下沉）。
- 首页：**年鉴编年**（居中报头、即时搜索、按年份分组、边栏大年号）。
- 双语：**默认纯中文 + 全局「双语对照」开关**；彻底移除 hover 揭示。
- 字体交付：**构建时按篇子集内嵌**，自托管开源中文衬线。

## 1. 排版与配色系统

在 `src/styles/global.css` 的 `:root` 建立 token。

**字体**
- 中文正文/标题：**Source Han Serif SC / 思源宋体**（SIL OFL 开源），自托管、构建时子集化。
- 英文：自托管文本衬线（**Source Serif 4** 或 **Newsreader**，含 italic），Latin 全量即可（体积小，约 30–80KB/weight）。对照原文用 italic。
- fallback 栈保留系统衬线：`"Source Han Serif SC","Noto Serif SC","Songti SC",serif`。

**配色（浅色/纸张）**
| token | 值 | 用途 |
|---|---|---|
| `--paper` | `#f7f4ec` | 背景 |
| `--ink` | `#26221b` | 正文 |
| `--muted` | `#928a7c` | 次要文字、英文原文 |
| `--rule` | `#e0d9ca` | 发丝线 |
| `--accent` | `#a1552f` | 链接、年号、小标记（克制使用） |

**排版节奏**
- 正文栏宽 `--measure: 36rem`；字号 19px；行距 ~2.0；字距 `.005em`。
- 中文段落 `text-indent: 2em`；段间距约 `1.35em`。

## 2. 阅读页（`src/pages/[slug].astro` + `src/components/ArticleBody.astro`）

- 报头：居中英文栏眉（`dateText · Paul Graham`）→ 居中中文大标题（serif, ~2.35rem, `max-width` 约 20ch）→ 居中 56px 发丝线。
- 元信息行：`原文` 链接 + `双语对照` 开关按钮（沿用现有 `.article-meta` 结构，重新配色）。
- 正文：`ArticleBody` 渲染逻辑基本不变（仍走 `renderMarkdown` + `rehypeSanitize`）；调整为静谧古典样式。`hr` 段落渲染为居中发丝线/小标记；`rawUnsupported` 保持原样输出。
- 段落 DOM 结构保持 `.seg > .seg-zh + .seg-en`，以便对照开关纯 CSS 控制。

## 3. 双语「对照」机制

- **移除** `global.css` 中所有 `:hover`/`:focus-within` 揭示原文的规则。
- 保留 `body[data-read]` 机制与 `localStorage` 持久化（`[slug].astro` 内联脚本已有，微调）。
- 默认 `data-read` 未设或为 `zh` → `.seg-en { display:none }`。
- `data-read="bilingual"` → `.seg-en` 显示于中文段落下方，muted italic 英文衬线。
- 开关按钮文案在「双语对照 / 纯中文」间切换，`aria-pressed` 反映状态。

## 4. 首页（`src/pages/index.astro`）

- 居中报头：站点名（中文 serif）+ 副标题（`共 N 篇 · 中文翻译`，italic 英文衬线）。
- **即时搜索框**：纯前端。内联脚本对已渲染的条目按 `titleZh` + `titleEn` 子串过滤（大小写不敏感），无匹配显示空态提示。无需索引/依赖。
- **按年份分组**：用 `publishedAt`（回退 `dateText`）取年份，逆序；每组左侧大号 sienna 年号（`grid-template-columns: 5rem 1fr`），右侧条目列表（中文标题 + muted 英文标题·日期），发丝线分隔。
- 排序沿用 `src/lib/sort.ts`（逆时间序）；分组在模板层做。搜索过滤时隐藏空年份组。

## 5. 构建时字体子集步骤（关键使能项）

**新增脚本** `scripts/subset-fonts.ts`（tsx 运行）：

1. 读取所有 `content/articles/*.json`，逐篇收集正文 + 标题用到的**中文字符并集**。
2. 另收集「共享子集」字符集：首页所有标题 + UI 文案（站点名、按钮、静态标签）。
3. 用基于 harfbuzz 的 JS 子集器 **`subset-font`**（npm，wasm，纯 JS，契合现有 Node 构建）从整份 Source Han Serif SC 生成：
   - 每篇一个 `public/fonts/zh/<slug>.woff2`（仅该篇字形）。
   - 一个 `public/fonts/zh/_shared.woff2`（首页/UI/标题）。
4. 每个文章页 `@font-face` 只加载自己那份子集（`font-display: swap`），`local()` 优先命中系统字体。首页/布局加载 `_shared`。
5. 英文 Latin 衬线整份自托管（体积小）。

**接线**：`package.json` 改 `"build": "tsx scripts/subset-fonts.ts && astro build"`。子集产物写入 `public/fonts/`（gitignore 之，构建时生成，不入库）。

**原始字体来源**：完整 Source Han Serif SC（.otf，数十 MB）**不提交 git**（体积过大），放 gitignored 的 `assets/fonts/SourceHanSerifSC.otf`；脚本从该固定路径读取，缺失时报清晰错误并提示下载来源（GitHub `adobe-fonts/source-han-serif` release）。CI/部署环境需先取得该文件或改为脚本按需下载缓存 —— 二选一在实现计划中定。

**体积预期**：单篇中文字形数量级在数百到一两千字，woff2 后每页低百 KB 级；首屏只下这一份，读者读一篇不会拉多 MB。

**边界情况**：某篇字符为空/极少时仍生成有效子集；字符集变更（重新翻译）后重跑脚本即可，产物随内容再生。

## 6. 深色模式

- 保留 `Base.astro` 现有 `data-theme` 切换与 `localStorage`。
- 重调 `:root[data-theme="dark"]` 为暖调墨纸（非当前冷灰）：如 `--paper:#1c1a16 / --ink:#e7e1d4 / --muted:#9a9284 / --rule:#332f27 / --accent:#c9794e`。
- 两个主题都要覆盖，`prefers-color-scheme` 作为首选信号（已有内联脚本处理）。

## 7. 明确不做（范围外）

- **主题/话题浏览**：内容无分类元数据，需人工标注 227 篇，本次不做。
- **编辑推荐头条**：用户选了纯年鉴，无人工精选位。
- **翻译 pipeline / 数据结构**：完全不动。
- **左右分栏对照 / 段落级点击展开**：已否决，不实现。

## 涉及文件

- 改：`src/styles/global.css`、`src/layouts/Base.astro`、`src/pages/index.astro`、`src/pages/[slug].astro`、`src/components/ArticleBody.astro`、`package.json`、`.gitignore`。
- 新增：`scripts/subset-fonts.ts`、`public/fonts/`（生成物）、自托管字体源文件。
- 测试：首页搜索过滤、年份分组逻辑若抽为 `src/lib/` 纯函数，加 vitest 单测；子集脚本对字符收集逻辑加单测。

## 验收标准

- 中文正文在任意系统（含 Windows/Android）都显示自托管思源宋体，而非系统回退。
- 阅读页呈现静谧古典版式；对照开关在桌面与触屏都可用，无 hover 依赖。
- 首页按年份分组、可即时搜索 227 篇。
- 单篇页字体下载为该篇子集（低百 KB 级），非多 MB 全量。
- 深色模式为暖调，两主题都协调。
- `npm run build` 全程无 API 调用，产出 `dist/`。
