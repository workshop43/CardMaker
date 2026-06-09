# CardMaker 生成契约（喂给 LLM）

> 把本文件完整贴给 LLM，再描述主题，它就能产出一套**设计自由、风格统一、信息充实、读完即懂**的卡片 deck。放映与一键出图由运行时完成。

## 你的任务

生成**一个完整的 HTML 文件**（一个「deck」=一组卡片）。你对每页的**版式与视觉拥有完全的创作自由**——自己写 HTML 结构与 CSS，不受任何固定组件限制。专注内容与设计。

## 文件骨架

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>标题</title>
  <link rel="stylesheet" href="cardmaker.css" />
</head>
<body>
  <div data-cardmaker data-preset="ppt" data-title="标题">
    <!-- 可选：一个 <style> 作为你的设计系统（自定义 class / 布局 / 配色变量） -->
    <style> .lead{font-size:.9em;color:var(--cm-muted)} /* … */ </style>
    <section class="card" data-theme="THEME_KEY">…PAGE_1_CONTENT…</section>
    <section class="card" data-theme="THEME_KEY">…PAGE_2_CONTENT…</section>
  </div>
  <script type="module" src="app/main.js"></script>
</body>
</html>
```

## 硬规则（只有这几条）

1. 每页是一个 `<section class="card">`；卡片前可放**一个** `<style>` 作为你的设计系统。**禁止** `<html>/<head>/<body>`、代码围栏、解释文字（除非要求整份文件）。
2. 比例由 `data-preset` 决定：`xiaohongshu`(3:4) `square`(1:1) `ppt`(16:9)。画布固定，按尺寸设计。
3. **禁止** `<script>`、外链图片/字体/CSS。换字体用 `data-font`（运行时安全加载、导出嵌入）。
4. CSS 选择器随你写（`.card .x`、`.card > .x`、给元素直接加 class 都行）——内容就渲染在 `.card` 里，没有额外包裹层。

## ⚠ 画布是固定尺寸，没有任何运行时兜底

这是最重要的一条：**引擎不会替你缩放、不会自动改色、不会防溢出**。你写成什么样，导出就是什么样。

- 画布是**固定整页**：小红书 1080×1440 / 方形 1080×1080 / PPT 1280×720 / 竖屏 1080×1920。一个 `.card` 就是这么大一块。
- **内容超出画布会被直接裁掉**。所以你要**自己估准内容量**，放得下才放；放不下就精炼表达、改紧凑版式、或拆成更多页——绝不硬塞。
- **布局完全自由**：flex、grid、绝对定位、自己写固定页眉页脚都行。你最清楚这块画布该怎么排，自主决定。
- 引擎只负责：把卡片**一键导出**为 2x 高清 PNG、像 PPT 一样**放映**、按屏幕大小整体缩放显示。

## ⚠ 字号：只用令牌或相对 em，别写绝对 px（最常见翻车点）

画布是 **1080~1280px 宽的大图**，会被缩小观看 / 导出成图。模型最爱犯的错是套用网页小号（16/18/20px），在大画布上小得离谱。**根治办法：可读文字一律用令牌或相对 em 表达字号，不写绝对 px。**

- 正文 `var(--cm-text)`、小标题 `var(--cm-h3)`、标题 `var(--cm-h2)`/`var(--cm-h1)`、巨标题 `var(--cm-display)`；需要中间档就用相对 `em`（如 `1.3em`，**`1em` = 正确的正文尺寸**）。
- 这些令牌**已按各比例调到正确大小**，你只管按层级选档，绝对大小交给令牌。下表是各比例令牌的实际尺度，仅供建立直觉：

| 比例 | 正文 | 小标题 | 标题 | 巨标题 |
|---|---|---|---|---|
| 小红书 3:4 (1080×1440) | 38 | 46 | 60~84 | ~112 |
| 方形 1:1 (1080×1080) | 30 | 34 | 44~60 | ~88 |
| PPT 16:9 (1280×720) | 34 | 40 | 52~72 | ~110 |
| 竖屏 9:16 (1080×1920) | 32 | 40 | 56~82 | ~132 |

- **别重设 `.card`/`body` 的 `font-size`**——`1em` 的正确性全靠它。纯装饰性大数字/水印可以用 px（只会更大，不是问题）。

## ⚠ 内容要铺满整页，别缩在中间

这是**固定整页画布**（从上到下都要用上），不是网页里一小块组件。

- 根容器 `height:100%` 撑满整页 + flex 纵向布局，把内容**沿全高分布**：典型 `顶部标题区 → 中间主内容(flex:1 撑开) → 底部落款/金句`，首尾贴近上下边、主体填满中间。
- 或用 `justify-content:space-between` 把几块均匀铺开。
- 内容本就不多时，靠**加大字号 + 拉开间距 + 放大主视觉**填实整页。

## 固定页眉/页脚：想要就自己写

画布是固定尺寸，**直接用 `position:absolute` 把页眉/页脚钉在卡片上/下边缘即可，不会漂移**；每页放同样位置就能保持一致。

也有两个现成便捷类可直接用：`cm-header`（钉上边）、`cm-footer`（钉下边），默认是两端对齐的小字条，可在 `.card .cm-header` / `.card .cm-footer` 里改样式。

```html
<section class="card">
  <div class="cm-header">SERIES_LABEL · PAGE_TITLE</div>
  …MAIN_CONTENT（自己给页眉页脚留出上下空间，正文不会自动避让）…
  <div class="cm-footer"><span>AUTHOR_OR_SOURCE</span><span>PAGE_NUMBER</span></div>
</section>
```

> 注意：正文**不会**自动避开页眉页脚——给主内容区留出上下 padding，或用 flex 布局让出位置。

## 经典排版原则（设计参考，贯穿全套）

1. **模块化字阶**：全套只用 4~5 个字号档（正文/小标题/标题/巨标题），相邻档按固定比例（约 1.25~1.4）放大；别每处随手定新字号，字阶统一才专业。
2. **强层级对比**：标题与正文拉开明显差距（标题 ≥ 正文 1.6 倍），用「大小 + 字重 + 颜色/留白」三者共同制造层级，而非只调字号。
3. **行长适中**：正文每行约 15~30 个汉字最易读；过宽就用 `max-width` 限宽、分栏或留白，别让文字横贯整屏。
4. **行高字距**：正文行高 1.5~1.7、标题收紧到 1.1~1.3；大字标题可略收字距，正文保持默认。
5. **亲密性与留白**：相关元素靠拢成组、无关元素拉开；留白是设计的一部分，宁可少放也要透气，别塞满。
6. **对齐与网格**：同页文字尽量共享少数对齐基线（多用左对齐），间距用统一节奏（如 8 的倍数），整体才整齐。

## 自由设计，但选一种风格贯穿全套

做成「读完即懂的文档型」——每页是能独立读懂的小章节：清晰标题 + 结构化、有层级的内容，逐页变换版式。为整套选定**一种**视觉风格（配色/字体/间距/母题）并贯穿。

### ① 风格统一
整套用**同一个 `data-theme`**（封面/结尾可用更浓的同色系）。可选主题：
`light`(默认浅) `dark` `warm` `ink`(衬线) `mint` `gradient` `ocean` `sky` `sunset` `forest` `paper`(衬线) `bold`(高对比) `pastel` `tech` `cream` `night`。

想要专属配色，**优先直接选合适的 `data-theme`**，通常只需再改强调色：
```html
<section class="card" data-theme="THEME_KEY" style="--cm-accent:ACCENT_COLOR">
```
可改：`--cm-accent`(强调) `--cm-fg`(文字) `--cm-muted`(弱化) `--cm-card-bg`(背景)。
> ⚠ **切忌只改 `--cm-card-bg` 把背景改深、却不改 `--cm-fg`**——会「深底深字、看不见」。要深背景就用深色 `data-theme`，或自定义背景时同时设 `--cm-fg`（深底配浅字、浅底配深字）。

换字体（整套统一）在 deck 根或每个 section 上加 `data-font`：
`hei` 思源黑体 · `song` 思源宋体 · `kai` 霞鹜文楷 · `smiley` 得意黑 · `xiaowei` 文艺宋 · `kuaile` 活泼 · `mao` 毛笔。不写则用系统苹方。

### ② 版式多变（每页换一种结构）
按下面的**原型**组织每一页，参考片段见文末。

### ③ 信息充实，但放得下（卡片固定尺寸，超出会被裁切）
- 内容页做成能读懂的小文档：**页标题 + 2~3 个结构块**，每个要点带**小标题 + 一行说明**。密度靠结构数量，不靠长段落。
- 判断标准：内容要**实际放得下**。塞过头就精炼说明、改紧凑版式或拆页。

## 设计令牌（可引用/覆盖，已按比例调好）

`--cm-fg` 文字 · `--cm-bg`/`--cm-card-bg` 背景 · `--cm-accent` 强调(其上文字 `--cm-accent-fg`) · `--cm-muted` 次要 · `--cm-line` 描边；字阶 `--cm-h1`/`--cm-h2`/`--cm-h3`/`--cm-text`；间距 `--cm-pad`/`--cm-gap`。

**现成零件**（想用就用）：眉题 `cm-kicker` · 巨标题 `cm-display` · 导语 `cm-lead` · 强调条 `cm-bar` · 大序号 `cm-num` · 水印序号 `cm-watermark` · 标签 `cm-tag`/`cm-chip` · 清单 `cm-checklist` + `cm-list-icon` + `cm-list-body` · 分隔线 `cm-divider` · 署名行 `cm-footer` · `<strong>` 自动用强调色。
**布局类**：`cm-middle` 垂直居中 · `cm-top` 顶对齐 · `cm-text-center` · `cm-row` 横排 · `cm-col` 竖排 · `cm-items-center` · `cm-between` · `cm-fill` 占满剩余 · `cm-mt`/`cm-mt-lg` 间距。
**装饰层**（自动垫在内容之下，不挡字）：`<div class="cm-deco cm-deco-glow"></div>`，可选 `cm-deco-blob`/`cm-deco-grid`/`cm-deco-dots`/`cm-deco-ring`。

关键视觉对象必须是真实 DOM：icon、圆点、编号、分隔符、徽标不要用 `::before`、`::after` 或 `list-style` 承载。清单写成：
```html
<ul class="cm-checklist">
  <li><span class="cm-list-icon"></span><span class="cm-list-body"><strong>要点</strong><br />说明文字</span></li>
</ul>
```

## 版式原型（抽象模板，替换所有占位内容）

**封面页**
```html
<section class="card cm-middle" data-theme="THEME_KEY">
  <div class="cm-deco cm-deco-glow"></div>
  <div class="cm-kicker">KICKER_TEXT</div>
  <h1 class="cm-display">COVER_TITLE</h1>
  <p class="cm-lead cm-mt">COVER_SUBTITLE</p>
  <div class="cm-footer"><span>AUTHOR_OR_SOURCE</span><span>FOOTER_HINT</span></div>
</section>
```

**大序号内容页**
```html
<section class="card" data-theme="THEME_KEY">
  <div class="cm-watermark">SECTION_INDEX</div>
  <div class="cm-row cm-items-center" style="gap:32px"><div class="cm-num">DISPLAY_INDEX</div><h2 style="margin:0">PAGE_TITLE</h2></div>
  <div class="cm-divider"></div>
  <p>PRIMARY_STATEMENT <strong>KEY_PHRASE</strong> SUPPORTING_TEXT</p>
  <p class="cm-muted">SECONDARY_EXPLANATION</p>
  <div class="cm-footer"><span>AUTHOR_OR_SOURCE</span><span>PAGE_NUMBER</span></div>
</section>
```

**数据 / 网格页**
```html
<section class="card" data-theme="THEME_KEY">
  <div class="cm-bar"></div><h2>PAGE_TITLE</h2>
  <div class="cm-grid cm-fill cm-mt">
    <div class="cm-cell"><div class="cm-stat"><div class="cm-stat-num">METRIC_VALUE_A</div><div class="cm-stat-label">METRIC_LABEL_A</div></div></div>
    <div class="cm-cell"><div class="cm-stat"><div class="cm-stat-num">METRIC_VALUE_B</div><div class="cm-stat-label">METRIC_LABEL_B</div></div></div>
  </div>
  <div class="cm-footer"><span>AUTHOR_OR_SOURCE</span><span>PAGE_NUMBER</span></div>
</section>
```

**金句页**
```html
<section class="card cm-middle" data-theme="THEME_KEY">
  <div class="cm-quote-mark">"</div>
  <div class="cm-quote-text">QUOTE_TEXT</div>
  <div class="cm-footer cm-mt-lg"><span>AUTHOR_OR_SOURCE</span></div>
</section>
```

## 一套好 deck 的节奏

封面（冲击力）→ 分栏/拆解内容页（结构充实、层级分明）→ 数据或清单页（信息密度）→ 金句页（情绪）→ 结尾（行动召唤）。整套同一主题，配色一致，版式逐页变化。
