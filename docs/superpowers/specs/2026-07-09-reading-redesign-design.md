# 阅读体验重设计 — 设计文档

**日期:** 2026-07-09
**范围:** `src/` 站点前端 + 一个构建时字体子集步骤。**不改动** `pipeline/` 翻译逻辑与 `content/*.json` 数据结构。

## 目标

把站点从「命名了 Noto Serif SC 却从未加载」的朴素排版，升级为**精致文学杂志风**的中文阅读体验。四个既定痛点全部处理：中文字体/排版、双语切换、首页/导航、整体视觉气质。

## 设计决策（已与用户确认）

- 气质方向：**精致文学杂志风**（克制、以文字为主角）。
- 阅读页版式：**静谧古典**（居中标题、英文栏眉、发丝分隔线、中文段落首行缩进、舒展行距，无首字下沉）。
- 首页：**年鉴编年**（居中报头、即时搜索、按年份分组、边栏大年号）。
- 双语：**默认中文优先 + 全局「双语对照」开关**；彻底移除 hover 揭示。
- 字体交付：**构建时按篇子集内嵌**，自托管开源中文衬线。

## 1. 排版与配色系统

在 `src/styles/global.css` 的 `:root` 建立 token。

**字体**
- 中文正文/标题：**Source Han Serif SC / 思源宋体**（SIL OFL 开源），自托管、构建时子集化。
- 英文：自托管文本衬线 **Newsreader**（含 italic），Latin 全量即可（体积小，约 30–80KB/weight）。对照原文用 italic。
- fallback 栈保留系统衬线：`"Source Han Serif SC","Noto Serif SC","Songti SC",serif`。

**配色（浅色/纸张）**
| token | 值 | 用途 |
|---|---|---|
| `--paper` | `#f7f4ec` | 背景 |
| `--ink` | `#26221b` | 正文 |
| `--muted` | `#71695b`（暂定） | 次要文字、英文原文 |
| `--rule` | `#e0d9ca` | 发丝线 |
| `--accent` | `#a1552f` | 链接、年号、小标记（克制使用） |

> **对比度约束**：`--muted` 用于小字号日期/英文标题/原文，必须对 `--paper` ≥ 4.5:1（原 `#928a7c` 仅约 3.11:1，不合格）。`#71695b` 对 `#f7f4ec` 约 5.2:1，暂定为准；深色模式的 `--muted` 同样须对深色 `--paper` ≥ 4.5:1。`--accent` 作链接时亦须达标。实现时以工具实测为准。

**排版节奏**
- 正文栏宽 `--measure: 36rem`；字号 19px；行距 ~2.0；字距 `.005em`。
- 中文段落 `text-indent: 2em`；段间距约 `1.35em`。

## 2. 阅读页（`src/pages/[slug].astro` + `src/components/ArticleBody.astro`）

- 报头：居中英文栏眉（`dateText · Paul Graham`）→ 居中中文大标题（serif, ~2.35rem, `max-width` 约 20ch）→ 居中 56px 发丝线。
- 元信息行：`原文` 链接 + `双语对照` 开关按钮（沿用现有 `.article-meta` 结构，重新配色）。
- 正文：`ArticleBody` 渲染逻辑调整为静谧古典样式（仍走 `renderMarkdown` + `rehypeSanitize`）。`hr` 段落渲染为居中发丝线/小标记。
- 段落 DOM 结构保持 `.seg > .seg-zh + .seg-en`，以便对照开关纯 CSS 控制。

**内容定位：中文优先，而非「纯中文」**

数据实测（227 篇，判定用 `zhMarkdown?.trim()` 非空）：
- **17 个 `rawUnsupported` 段分布在 13 篇**（结构性内容，如代码、`airbnb` 里的一封长邮件），按既定范围不翻译、原样输出英文。
- **9 个可翻译段 `zhMarkdown` 为空串 `""`，分布在 4 篇**（`best`、`cities`、`re`、`relres`，多为脚注/尾注）——翻译真实缺口。注意：`?? enMarkdown` 的 `??` **不**捕获空串，故这些段当前渲染成**空白**中文段（内容黑洞）；且现有 pipeline 只对 `zhMarkdown===undefined` 重译（`assemble.ts`），空串不会被拾取，本次不改 pipeline，也不做数据回填。

因此默认视图是「**中文优先**」，`ArticleBody` 须统一按「有效中文 = `zhMarkdown?.trim()` 非空」分支：
- 有效中文缺失的可翻译段（空串）与 `rawUnsupported` 一视同仁：输出英文原文，并加一个不显眼的「未译原文」视觉标记（如左侧淡色竖线 + 小标签），让读者知道此段未译。
- 加固渲染：不再用 `?? enMarkdown` 把英文塞进 `.seg-zh` 冒充中文；对照模式下对这些「原文段」**不得**把同一段英文渲染两遍（只显示一次带标记的原文，不再另出 `.seg-en`）。
- `translated` 判定从 `!!s.zhMarkdown` 改为 `!!s.zhMarkdown?.trim()`（空串即视为未译）。

## 3. 双语「对照」机制

- **移除** `global.css` 中所有 `:hover`/`:focus-within` 揭示原文的规则。
- **移除** `ArticleBody.astro` 中每个 `.seg` 上的 `tabindex="0"`（旧 focus 揭示机制遗留；长文会留下上百个无意义键盘停靠点）。
- 保留 `body[data-read]` 机制与 `localStorage` 持久化（`[slug].astro` 内联脚本已有，微调）。
- 默认 `data-read` 未设或为 `zh` → `.seg-en { display:none }`。
- `data-read="bilingual"` → `.seg-en` 显示于中文段落下方，muted italic 英文衬线。
- 开关按钮文案固定为「双语对照」，用 `aria-pressed` + 视觉状态反映开/关（不再用「纯中文」这一会误导的措辞，因默认视图仍含未译原文段）。

## 4. 首页（`src/pages/index.astro`）

- 居中报头：站点名（中文 serif）+ 副标题（`共 N 篇 · 中文翻译`，italic 英文衬线）。
- **即时搜索框**：纯前端。内联脚本对已渲染的条目按 `titleZh` + `titleEn` 子串过滤（大小写不敏感）。可访问性：关联 `<label>`（可视隐藏）、`:focus-visible` 焦点样式、结果计数/空态用 `aria-live="polite"` 播报。无需索引/依赖。
- **按年份分组**：用 `publishedAt` 取年份，逆序；每组左侧大号 sienna 年号（宽屏 `grid-template-columns: 5rem 1fr`），右侧条目列表（中文标题 + muted 英文标题·日期），发丝线分隔。
- **「日期不详」分组（必须）**：实测 **31 篇** `publishedAt=null` 且 `dateText=""`，无年份可用。这些归入置于最末的「日期不详」组，组内按 `sourceOrder` 排序。年份组正常在其上、逆序。
- **窄屏布局**：≤ ~640px 时年号栏不再占固定 `5rem` 侧栏，改为年号作为块级小标题居于条目上方（单列堆叠），避免 320px 下正文被挤窄。
- 排序沿用 `src/lib/sort.ts`（逆时间序）；分组在模板层做。搜索过滤时隐藏空年份组。取年份/分组若抽成 `src/lib/` 纯函数则加 vitest 单测（含无日期条目）。

**文章页导航（补齐「导航」痛点）**：正文末尾加页脚导航——`← 返回目录`，以及按时间序的 `上一篇 / 下一篇`（无相邻篇时该向缺省）。相邻关系用与首页相同的排序在 `[slug].astro` 的 `getStaticPaths` 计算后经 props 传入。

## 5. 构建时字体子集步骤（关键使能项）

**新增脚本** `scripts/subset-fonts.ts`（tsx 运行），用基于 harfbuzz 的 JS 子集器 **`subset-font`**（npm，wasm，纯 JS，输出 woff2，契合现有 Node 构建）。

**覆盖模型（每页收全部可见 code point，不按「只中文」拆）**

每个文章页生成**一份**子集，其字符集 = 该页实际可见文本的**全部 Unicode code point**：
- 正文 `zhMarkdown`（对照模式的 `.seg-en` 用英文 Latin 字体，不进中文子集）+ 中文标题；
- 中文正文里夹带的 **Latin 字母、数字、中英文标点**（如「Y Combinator」「6500」「，：（）」）——一律并入，避免这些字符回退到别的字体导致混排跳字。
- **固定中文 UI/chrome 文案（每一页都并入，含文章页与首页）**：站点名里的「中文」、`原文`、`双语对照`、`中文优先`、`未译原文`、`返回目录`、`上一篇`、`下一篇`、`共 N 篇 · 中文翻译`、`日期不详`、`搜索标题…`、空态提示、页脚署名等。集中定义为一个常量字符串集，脚本对每页子集都并入，避免文章页 chrome 中文缺字。
- 首页另生成一份「站点子集」：所有 227 条中文标题 + 上述固定 UI 文案。

不再拆成「文章子集 + 描述符相同的共享子集」两个 `@font-face`（同 family/weight 会造成匹配歧义）。每个文章页 `@font-face` 只声明并加载自己那一份；首页加载站点子集。`font-display: swap`，`local()` 不用（避免命中用户机器上版本不一的同名字体）。

**字重策略**：需要 **Regular + 一个粗体**（标题/`<strong>` 用），分别从对应字重的源文件子集，禁止浏览器合成粗体（CJK 合成粗体很糟）。故每页产 2 个 woff2（regular/bold）。中文不需要 italic（对照原文的 italic 由英文 Latin 字体承担）。英文 Latin 衬线：整份自托管 Regular + Italic（+ 视需要 Bold），体积小。

**构建闭环（P0，此处定死，不留给实现计划）**

采用 **B 方案：提交生成的 woff2 产物，*生成* 步骤与 `astro build` 解耦，但 build 前加一道轻量*校验***：
- 子集脚本**本地/预提交**运行（`npm run fonts`），产物 `public/fonts/**.woff2` + 清单 **提交进 git**。
- `package.json` 的 `build` 改为 **`tsx scripts/verify-fonts.ts && astro build`**。`verify-fonts.ts` 是**只读校验**，不需原始字体、无网络：核对①清单存在且与 `content/` 当前字符集一致、②清单里每个 woff2 文件都存在、③文件内容哈希与清单记录一致、④抽查每页子集 cmap 覆盖该页所需 code point。任一不符则**构建失败**并提示「内容已变，请重跑 `npm run fonts` 并提交」。这样内容更新后忘记重生成字体会被 CI 挡下，而 CI 仍不需要原始字体、保持 hermetic。
- 完整 Source Han Serif SC 源文件（.otf，数十 MB）**不提交**，放 gitignored 的 `assets/fonts/`；仅本地跑 `npm run fonts` 时需要，缺失时脚本报清晰错误并提示来源（`adobe-fonts/source-han-serif` release）。脚本对源文件校验 **SHA-256**（版本钉死），保证任何人本地重跑得到一致产物。
- 体积权衡：单页正文字形约数百~一两千字，woff2 后每份低百 KB 级；227 篇 × 2 字重 + 站点子集，仓库新增大约数十 MB 二进制。对内容站可接受；换来的是完全 hermetic 的部署。若日后仓库体积成问题，退路是「CI 下载钉版源文件（SHA-256 校验）+ CI 内子集」——但当前**不**采用。

**文件名与缓存**：产物用**内容哈希**文件名（如 `earn.[hash].woff2`），`@font-face` 引用哈希名；字符集变更 → 哈希变 → 自动 cache-bust。脚本产出 slug→哈希名的映射清单供页面读取。

**许可证合规（Source Han Serif = SIL OFL，含保留字体名 "Source"）**
- 将 **OFL 全文**随站点分发（`public/` 下放一份 `OFL.txt`，页脚给出链接与字体署名）。
- 子集属修改版，**内部字体名重命名**为不含保留名的名称（如 family 命名 `PGCN Song`），避免占用 "Source" 保留名；`@font-face` 的 `font-family` 用该新名。若 `subset-font` 不支持改写 name table，加一步 `fonttools`/等价工具重命名并在实现中验证。
- 英文 Latin 字体 **Newsreader**（OFL）同样随附 OFL 并做署名；许可证处理一致。

**边界情况**：某篇字符极少仍生成有效子集；对照英文使 Latin 字体覆盖，中文子集不含之。

**开发体验（`npm run dev`）**：woff2 已提交在 `public/fonts/`，Astro dev 直接静态服务，故**新 clone 首次开发即有真实字体，无需先跑 `npm run fonts`**。只有在**改动了 `content/`**（新增/重译文章，字符集变化）后，才需重跑 `npm run fonts` 并提交更新的 woff2 与清单（否则 `build` 的 `verify-fonts` 会失败）。README 注明此约定。

## 6. 深色模式

- 保留 `Base.astro` 现有 `data-theme` 切换与 `localStorage`。
- 重调 `:root[data-theme="dark"]` 为暖调墨纸（非当前冷灰）：如 `--paper:#1c1a16 / --ink:#e7e1d4 / --muted:#9a9284 / --rule:#332f27 / --accent:#c9794e`（`--muted`/`--accent` 同样须对深色 `--paper` ≥ 4.5:1，实测为准）。
- 两个主题都要覆盖，`prefers-color-scheme` 作为首选信号（已有内联脚本处理）。

## 7. 明确不做（范围外）

- **主题/话题浏览**：内容无分类元数据，需人工标注 227 篇，本次不做。
- **编辑推荐头条**：用户选了纯年鉴，无人工精选位。
- **翻译 pipeline / 数据结构**：完全不动。
- **左右分栏对照 / 段落级点击展开**：已否决，不实现。

## 涉及文件

- 改：`src/styles/global.css`、`src/layouts/Base.astro`、`src/pages/index.astro`、`src/pages/[slug].astro`、`src/components/ArticleBody.astro`、`package.json`、`.gitignore`、`README.md`。
- 新增：`scripts/subset-fonts.ts`（`npm run fonts` 入口）、`scripts/verify-fonts.ts`（`build` 前只读校验）、共用的字符收集/固定 UI 文案常量模块、`public/fonts/**.woff2`（**提交**的子集产物）+ 哈希清单 JSON、`public/OFL.txt`、`src/lib/` 分组/年份纯函数。
- gitignore：忽略 `assets/fonts/`（原始 .otf 源，不提交）；`public/fonts/` 的 woff2 **提交入库**。
- 测试：首页搜索过滤、年份/分组（含无日期条目）纯函数 vitest 单测；字符收集逻辑（含空串未译段按原文段处理、固定 UI 文案并入）单测；`verify-fonts` 覆盖/哈希校验逻辑单测。

## 验收标准（尽量可客观核验）

- **字体覆盖**：随机抽若干篇，页面子集覆盖该页全部可见 code point（中/英/数字/标点），无缺字回退；实现一个覆盖校验（脚本对每页字符集 ⊆ 子集 cmap 做断言）。
- **字重**：标题/`<strong>` 用真实粗体子集，非合成粗体。
- **体积预算**：单个 woff2 ≤ ~250KB（超标则告警）；单文章页中文字体总下载（regular+bold）低百 KB 级，非多 MB。
- **构建闭环**：干净 clone（无 `assets/fonts/`、无网络）执行 `npm run build` 成功产出 `dist/`，全程无 API 调用；`verify-fonts` 通过。反向：故意改动某篇内容却不重跑 `npm run fonts`，`npm run build` 必须**失败**并提示重生成。
- **未译原文段**：`best/cities/re/relres` 的空串段不再渲染成空白，而是显示带「未译原文」标记的英文；对照模式下这些段英文只出现一次（不重复）。
- **对比度**：`--muted`、链接色对各自 `--paper` 实测 ≥ 4.5:1（浅/深两主题）。
- **可访问性/交互**：移除段落 `tabindex` 后长文无多余 Tab 停靠点；对照开关键盘可操作、`aria-pressed` 正确；搜索有 label、`:focus-visible`、`aria-live` 空态。
- **响应式**：320 / 768 / 桌面三档截图核对——首页年号栏窄屏堆叠、正文不被挤窄；阅读页版式成立。
- **导航**：首页按年份分组 + 「日期不详」组可即时搜索 227 篇；文章页有返回目录与上一篇/下一篇。
- **深色模式**：暖调，两主题协调。
- **许可证**：`dist/` 内含 OFL 文本；子集字体内部名不占用保留名 "Source"。
