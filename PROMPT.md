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
    <section class="card" data-theme="ocean">…第 1 页（内部布局随你设计）…</section>
    <section class="card" data-theme="ocean">…第 2 页…</section>
  </div>
  <script type="module" src="app/main.js"></script>
</body>
</html>
```

## 硬规则（只有这几条）

1. 每页是一个 `<section class="card">`；卡片前可放**一个** `<style>` 作为你的设计系统。**禁止** `<html>/<head>/<body>`、代码围栏、解释文字（除非要求整份文件）。
2. 比例由 `data-preset` 决定：`xiaohongshu`(3:4) `square`(1:1) `ppt`(16:9) `story`(9:16)。画布固定，按尺寸设计。
3. **禁止** `<script>`、外链图片/字体/CSS。换字体用 `data-font`（运行时安全加载、导出嵌入）。
4. CSS 选择器随你写（`.card .x`、`.card > .x`、给元素直接加 class 都行）——内容就渲染在 `.card` 里，没有额外包裹层。

## ⚠ 画布是固定尺寸，没有任何运行时兜底

这是最重要的一条：**引擎不会替你缩放、不会自动改色、不会防溢出**。你写成什么样，导出就是什么样。

- 画布是**固定整页**：小红书 1080×1440 / 方形 1080×1080 / PPT 1280×720 / 竖屏 1080×1920。一个 `.card` 就是这么大一块。
- **内容超出画布会被直接裁掉**。所以你要**自己估准内容量**，放得下才放；放不下就精炼表达、改紧凑版式、或拆成更多页——绝不硬塞。
- **布局完全自由**：flex、grid、绝对定位、自己写固定页眉页脚都行。你最清楚这块画布该怎么排，自主决定。
- 引擎只负责：把卡片**一键导出**为 2x 高清 PNG、像 PPT 一样**放映**、按屏幕大小整体缩放显示。

## ⚠ 字号一定要够大（最常见翻车点）

画布是 **1080~1280px 宽的大图**，会被缩小观看 / 导出成图——**别用 14~22px 这种网页字号**。各比例的合适字号：

| 比例 | 正文 | 小标题 | 标题 | 巨标题 |
|---|---|---|---|---|
| 小红书 3:4 (1080×1440) | 34~40 | ~46 | 60~84 | ~110 |
| 方形 1:1 (1080×1080) | ~30 | ~34 | 44~60 | ~88 |
| PPT 16:9 (1280×720) | ~34 | ~40 | 52~72 | ~110 |
| 竖屏 9:16 (1080×1920) | ~32 | ~40 | 56~82 | ~130 |

- 正文低于 **~28px** 一律算太小。
- 在 `<style>` 里重定义 `--cm-text`/`--cm-h1` 等令牌时，值也要落在上表尺度。
- 拿不准就直接用 `var(--cm-text)`/`var(--cm-h1)`…（已按比例调好）。

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
  <div class="cm-header">系列名 · 本页标题</div>
  …主内容（自己给页眉页脚留出上下空间，正文不会自动避让）…
  <div class="cm-footer"><span>@账号</span><span>02 / 08</span></div>
</section>
```

> 注意：正文**不会**自动避开页眉页脚——给主内容区留出上下 padding，或用 flex 布局让出位置。

## 自由设计，但选一种风格贯穿全套

做成「读完即懂的文档型」——每页是能独立读懂的小章节：清晰标题 + 结构化、有层级的内容，逐页变换版式。为整套选定**一种**视觉风格（配色/字体/间距/母题）并贯穿。

### ① 风格统一
整套用**同一个 `data-theme`**（封面/结尾可用更浓的同色系）。可选主题：
`light`(默认浅) `dark` `warm` `ink`(衬线) `mint` `gradient` `ocean` `sky` `sunset` `forest` `paper`(衬线) `bold`(高对比) `pastel` `tech` `cream` `night`。

想要专属配色，**优先直接选合适的 `data-theme`**，通常只需再改强调色：
```html
<section class="card" data-theme="ocean" style="--cm-accent:#ff5a5f">
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

**现成零件**（想用就用）：眉题 `cm-kicker` · 巨标题 `cm-display` · 导语 `cm-lead` · 强调条 `cm-bar` · 大序号 `cm-num` · 水印序号 `cm-watermark` · 标签 `cm-tag`/`cm-chip` · 分隔线 `cm-divider` · 署名行 `cm-footer` · `<strong>` 自动用强调色。
**布局类**：`cm-middle` 垂直居中 · `cm-top` 顶对齐 · `cm-text-center` · `cm-row` 横排 · `cm-col` 竖排 · `cm-items-center` · `cm-between` · `cm-fill` 占满剩余 · `cm-mt`/`cm-mt-lg` 间距。
**装饰层**（自动垫在内容之下，不挡字）：`<div class="cm-deco cm-deco-glow"></div>`，可选 `cm-deco-blob`/`cm-deco-grid`/`cm-deco-dots`/`cm-deco-ring`。

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

**金句页**
```html
<section class="card cm-middle" data-theme="ocean">
  <div class="cm-quote-mark">"</div>
  <div class="cm-quote-text">你如何度过一天，<br>就如何度过一生。</div>
  <div class="cm-footer cm-mt-lg"><span>@CardMaker</span></div>
</section>
```

## 一套好 deck 的节奏

封面（冲击力）→ 分栏/拆解内容页（结构充实、层级分明）→ 数据或清单页（信息密度）→ 金句页（情绪）→ 结尾（行动召唤）。整套同一主题，配色一致，版式逐页变化。
