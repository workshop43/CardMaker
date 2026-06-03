# CardMaker 生成契约（喂给 LLM）

> 把本文件完整贴给 LLM，再描述主题，它就能产出一套**设计自由、风格统一、信息充实、读完即懂**的卡片 deck。缩放兜底、文字对比度、放映与出图都由运行时自动完成。

## 你的任务

生成**一个完整的 HTML 文件**（一个「deck」=一组卡片）。你对每页的**版式与视觉拥有完全的创作自由**——自己写 HTML 结构与 CSS，不受任何固定组件限制。专注内容与设计，物理约束（放得下、能导出、字可读）交给运行时。

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
    <section class="card" data-theme="ocean">…第 1 页（内部布局随你设计）…</section>
    <section class="card" data-theme="ocean">…第 2 页…</section>
  </div>
  <script src="cardmaker.js"></script>
</body>
</html>
```

## 硬规则（只有这几条）

1. 每页是一个 `<section class="card">`；卡片前可放**一个** `<style>` 作为你的设计系统。**禁止** `<html>/<head>/<body>`、代码围栏、解释文字（除非要求整份文件）。
2. 比例由 `data-preset` 决定：`xiaohongshu`(3:4) `square`(1:1) `ppt`(16:9) `story`(9:16)。画布固定，按尺寸设计。
3. **禁止** `<script>`、外链图片/字体/CSS。换字体用 `data-font`（运行时安全加载、导出嵌入）。
4. 卡内内容会被运行时包进自适配层：CSS 用后代选择器 `.card .x`，别用 `.card > .x` 直接子选择器。

## 引擎为你兜底三件事（放心设计）

- **auto-fit**：内容略超自动等比缩小、绝不裁切——大胆设计、不必像素级较真（但别在矮画布疯狂堆，放不下就拆页）。
- **对比度护栏**：即便自定义背景，文字也会自动保持可读。
- **一键导出**高清图 / 放映。

## ⚠ 字号一定要够大（最常见翻车点）

画布是 **1080~1280px 宽的大图**，会被缩小观看 / 导出成图——**别用 14~22px 这种网页字号**，在这尺寸上小到看不清。各比例的合适字号：

| 比例 | 正文 | 小标题 | 标题 | 巨标题 |
|---|---|---|---|---|
| 小红书 3:4 (1080×1440) | 34~40 | ~46 | 60~84 | ~110 |
| 方形 1:1 (1080×1080) | ~30 | ~34 | 44~60 | ~88 |
| PPT 16:9 (1280×720) | ~34 | ~40 | 52~72 | ~110 |
| 竖屏 9:16 (1080×1920) | ~32 | ~40 | 56~82 | ~130 |

- 正文低于 **~28px** 一律算太小。
- 你在 `<style>` 里**重定义 `--cm-text`/`--cm-h1` 等令牌时，值也要落在上表尺度**，别照搬网页小号（如 `--cm-text: 16px`，必小到看不清）。
- 拿不准就直接用 `var(--cm-text)`/`var(--cm-h1)`…（已按比例调好，绝对安全）。

## ⚠ 内容要铺满整页，别缩在中间

这是**固定整页画布**（从上到下都要用上），不是网页里一小块组件。常见翻车：做一小团内容，被居中后**飘在中央、上下大片空白**。

- 根容器 `height:100%` 撑满整页 + flex 纵向布局，把内容**沿全高分布**：典型 `顶部标题区 → 中间主内容(flex:1 撑开) → 底部落款/金句`，首尾贴近上下边、主体填满中间。
- 或用 `justify-content:space-between` 把几块均匀铺开。
- 内容本就不多时，靠**加大字号 + 拉开间距 + 放大主视觉**填实整页，而不是缩在中央。

## 自由设计，但选一种风格贯穿全套

做成「读完即懂的文档型」——每页是能独立读懂的小章节：清晰标题 + 结构化、有层级的内容（不是一句话一页），逐页变换版式。为整套选定**一种**视觉风格（配色/字体/间距/母题）并贯穿。配色用现成 `data-theme`，或在你的 `<style>` 里用设计令牌（`--cm-fg/--cm-bg/--cm-card-bg/--cm-accent/--cm-muted/--cm-line`、字阶 `--cm-h1/--cm-h2/--cm-h3/--cm-text`、间距 `--cm-pad/--cm-gap`，已按比例调好）自定义。

> 下面的「主题 / 字体 / 可选零件」是**工具箱，不是约束**——想用就用，想全部自己写也行。

## 三条设计准则（决定成品质量）

### ① 风格统一
整套卡片用**同一个 `data-theme`**（封面/结尾可用更浓的同色系），不要每页换主题。可选主题：
`light`(默认浅) `dark` `warm` `ink`(衬线) `mint` `gradient` `ocean` `sky` `sunset` `forest` `paper`(衬线) `bold`(高对比) `pastel` `tech` `cream` `night`。

想要专属配色，**优先直接选合适的 `data-theme`**（要深色风就用现成深色主题，背景+文字对比已配好），通常只需再改强调色：
```html
<section class="card" data-theme="ocean" style="--cm-accent:#ff5a5f">
```
可改：`--cm-accent`(强调色) `--cm-fg`(文字) `--cm-muted`(弱化) `--cm-card-bg`(背景)。
> ⚠ **切忌只改 `--cm-card-bg` 把背景改深、却不改 `--cm-fg`**——会「深底深字、标题看不见」。要深背景就用深色 `data-theme`；若自定义背景，必须同时设 `--cm-fg`（深底配浅字、浅底配深字）。

想换字体（整套统一），在 deck 根或每个 section 上加 `data-font`：

```html
<div data-cardmaker data-preset="xiaohongshu" data-font="song">
```

可选：`hei` 思源黑体(现代) · `song` 思源宋体(编辑) · `kai` 霞鹜文楷(文学) · `smiley` 得意黑(潮流标题) · `xiaowei` 文艺宋 · `kuaile` 活泼 · `mao` 毛笔书法。不写则用系统苹方。

### ② 版式多变（每页换一种结构，别千篇一律）
按下面的**原型**组织每一页，参考片段见文末。

### ③ 信息充实，但全字号放得下（卡片固定尺寸，超出会被裁切）
- 内容页做成能读懂的小文档：**页标题 + 2~3 个结构块**，每个要点带**小标题 + 一行说明**，可配数据/标签/一句本页结论。密度靠结构数量，不靠长段落。
- 判断标准：内容要在**不缩小字号**下放得下。塞过头时优先精炼说明、改用更紧凑版式或拆页，而不是删掉整块结构。
- 编辑器里若某页标红「内容超出」，说明塞过头了，按上一条压缩表达。每页都用 `cm-footer` 署名行收尾。

## 零件速查

| 用途 | 写法 |
|---|---|
| 眉题 | `<div class="cm-kicker">每日精进</div>` |
| 巨标题 / 标题 | `<h1 class="cm-display">` / `<h1><h2><h3>` |
| 导语 | `<p class="cm-lead">副标题</p>` |
| 强调条 | `<div class="cm-bar"></div>` |
| 大序号 / 水印序号 | `<div class="cm-num">01</div>` / `<div class="cm-watermark">2</div>` |
| 标签 / 描边胶囊 | `<span class="cm-tag">收藏</span>` / `<span class="cm-chip">标签</span>` |
| 分隔线 / 引言 | `<div class="cm-divider"></div>` / `<blockquote>…</blockquote>` |
| 署名行 | `<div class="cm-footer"><span>@你</span><span>系列</span></div>` |
| 重点 | `<strong>重点</strong>`（自动用强调色） |

**布局**：`cm-middle`垂直居中 · `cm-text-center` · `cm-row`横排 · `cm-col`竖排 · `cm-items-center` · `cm-between` · `cm-fill`占满剩余 · `cm-muted` · `cm-accent` · `cm-mt`/`cm-mt-lg`间距。

**装饰层**（自动位于内容之下，绝不挡字）：在 section 内放
`<div class="cm-deco cm-deco-glow"></div>`，可选 `cm-deco-blob` / `cm-deco-grid` / `cm-deco-dots` / `cm-deco-ring`。

## 版式原型（片段，照着改内容）

**封面页**
```html
<section class="card cm-middle" data-theme="ocean">
  <div class="cm-deco cm-deco-glow"></div>
  <div class="cm-kicker">高效工作</div>
  <h1 class="cm-display">3 个<br>时间管理技巧</h1>
  <p class="cm-lead cm-mt">把时间花在刀刃上</p>
  <div class="cm-footer"><span>@CardMaker</span><span>← 滑动 →</span></div>
</section>
```

**大序号内容页**
```html
<section class="card" data-theme="ocean">
  <div class="cm-watermark">1</div>
  <div class="cm-row cm-items-center" style="gap:32px"><div class="cm-num">01</div><h2 style="margin:0">要事第一</h2></div>
  <div class="cm-divider"></div>
  <p>每天先做<strong>最重要的一件事</strong>，再处理琐碎。</p>
  <p class="cm-muted">忙不等于高效，方向比速度重要。</p>
  <div class="cm-footer"><span>@CardMaker</span><span>时间管理</span></div>
</section>
```

**数据 / 网格页**
```html
<section class="card" data-theme="ocean">
  <div class="cm-bar"></div><h2>为什么重要</h2>
  <div class="cm-grid cm-fill cm-mt">
    <div class="cm-cell"><div class="cm-stat"><div class="cm-stat-num">80%</div><div class="cm-stat-label">价值来自 20% 的事</div></div></div>
    <div class="cm-cell"><div class="cm-stat"><div class="cm-stat-num">2h</div><div class="cm-stat-label">每天的高效窗口</div></div></div>
  </div>
  <div class="cm-footer"><span>@CardMaker</span><span>时间管理</span></div>
</section>
```

**清单页**
```html
<section class="card" data-theme="ocean">
  <div class="cm-kicker">行动清单</div><h2>今天就试</h2>
  <ul class="cm-checklist cm-fill cm-mt">
    <li>睡前列好明天最重要的 3 件事</li>
    <li>上午只做需要专注的工作</li>
    <li>把会议集中在下午</li>
  </ul>
  <div class="cm-footer"><span>@CardMaker</span><span>时间管理</span></div>
</section>
```

**金句页**
```html
<section class="card cm-middle" data-theme="ocean">
  <div class="cm-quote-mark">"</div>
  <div class="cm-quote-text">你如何度过一天，<br>就如何度过一生。</div>
  <div class="cm-footer cm-mt-lg"><span>@CardMaker</span></div>
</section>
```

**结尾页**
```html
<section class="card cm-middle cm-text-center" data-theme="ocean">
  <div class="cm-deco cm-deco-glow"></div>
  <h1>从今天开始</h1>
  <p class="cm-lead cm-mt">挑一个技巧，坚持 7 天。</p>
  <div class="cm-mt-lg"><span class="cm-tag">收藏 + 关注</span></div>
</section>
```

## 一套好 deck 的节奏

封面（冲击力）→ 分栏/拆解内容页（结构充实、层级分明）→ 数据或清单页（信息密度）→ 金句页（情绪）→ 结尾（行动召唤）。整套同一主题，配色一致，版式逐页变化。
