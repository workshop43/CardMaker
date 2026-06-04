/* =============================================================
   分步生成的四段 prompt：plan（内容大纲）→ design（全局设计系统 + 全局组件）
   → render（逐页排版）→ edit/style（改单页 / 改整套样式）。每个函数返回 { sys, user }。

   原则（2026-06 简化）：只给【任务规格 + 结构约束 + 输出格式】，不替模型做设计决策。
   字号、字阶、排版、配色、留白等全部交回模型自由发挥——经验表明，我越指导（字号令牌限制、
   排版原则、铺满要求…），出来越丑。唯一保留的非技术约定是跨页一致的「全局组件契约」
   （COMPONENTS），那是为了改单页时组件不漂移的系统架构，不是设计审美。
   ============================================================= */

const THEMES = "light dark warm ink mint gradient ocean sky sunset forest paper bold pastel tech cream night";
const FONTS = "hei(现代黑) song(编辑宋) kai(文学楷) smiley(潮流标题) xiaowei(文艺宋) kuaile(活泼) mao(毛笔书法)";

// 任务规格：这是一张要导出成图片的固定尺寸版面（不是网页）。只说「是什么」，不指导「怎么设计」。
function mediumBlock(preset, P) {
  const seen = preset === "ppt" ? "在投影 / 大屏上看" : "发社交平台、在手机上看（会被缩小）";
  return "你在设计一张【要导出成图片】的固定尺寸版面：" + P.label + "，精确 " + P.w + "×" + P.h +
    "px，" + seen + "——是一张图，不是网页。视觉、排版、字号、配色完全由你做主。";
}

// 可引用的设计令牌（事实性 API，非设计指导；用不用随你）。
const TOKENS =
  "可选设计令牌：--cm-fg 文字 · --cm-bg/--cm-card-bg 背景 · --cm-accent 强调(其上文字 --cm-accent-fg) · --cm-muted 次要 · --cm-line 描边 · 字阶 --cm-h1/--cm-h2/--cm-h3/--cm-text · 间距 --cm-pad/--cm-gap。用不用、用多大随你。";

// 画布技术约束（硬规则，非审美）。
function canvasBlock(preset, P) {
  return [
    "【硬约束】",
    "- 一个 <section class=\"card\"> 就是整页 " + P.w + "×" + P.h + "px，按真实像素设计；布局自由（flex/grid/绝对定位都行）。内容超出 " + P.h + "px 会被裁切。",
    "- 自定义背景务必同时设文字色（深底配浅字、浅底配深字），别只改背景不改 --cm-fg。",
    "- 禁止 <html>/<head>/<body>、``` 围栏、解释文字、<script>、外链图片/字体/CSS。换字体用 data-font（" + FONTS + "）。",
    TOKENS,
  ].join("\n");
}

// 跨页一致的「全局组件」契约：位置/样式在 design 的全局 <style> 里定义一次，每页只套 class 填内容。
// 这是系统架构（保证改单页时组件不漂移、标题副标题不重叠），不是设计审美——故保留。
const COMPONENTS = [
  "【全局组件契约 · 跨页位置与样式一致——只在全局 <style> 里定义一次，每页套同名 class 只填内容，绝不在页内写它们的定位】",
  "- 固定 chrome（所有页同一坐标，用 position:absolute 钉在卡片边缘）：页眉 .cm-header（钉顶部）、页脚 .cm-footer（钉底部，flex 左右两栏）。",
  "  ⚠ 页码不要单独定位——它就是 .cm-footer 里的右侧 <span>（如「02 / 08」）。绝不另做一个绝对定位的页码钉在右下角，否则会和页脚右栏叠在一起。",
  "- 标题区 .cm-titlebar（按页面角色 data-role 定位）：是一个【容器】，里面装主标题 .cm-title 和副标题 .cm-subtitle。",
  "  ⚠【绝对定位只加在 .cm-titlebar 容器上；容器内的 .cm-title 与 .cm-subtitle 走常规流（不给它们任何 position/top/left）】——副标题靠 margin 紧跟主标题下方。这样主标题折行也会把副标题自然顶下去、绝不重叠。【绝不单独绝对定位 .cm-subtitle】。",
  "  用 .card[data-role=\"cover\"] .cm-titlebar{…} 区分角色（封面可居中放大，其余内容页统一靠上同位置）。",
].join("\n");

// ---------- 1) PLAN：内容大纲（输出 JSON） ----------
export function planPrompt(preset, pages, topic) {
  const sys = [
    "你是世界顶尖的中文内容策划。把用户主题拆成一套【连贯、读完即懂、信息充实】的卡片 deck 的内容大纲。",
    "整套是连续叙事：页与页有承接关系（总分、递进、起承转合）。每个内容页是能独立读懂的小章节：清晰标题 + 2~3 个结构化要点。",
    "",
    "【只输出一个 JSON，禁止任何解释文字、禁止 ``` 围栏】，结构：",
    '{"title":"整套标题","vibe":"一句话视觉基调","theme":"从配色盘选一个","font":"从字体里选一个 key","pages":[{"role":"cover|content|data|quote|ending","title":"本页标题","subtitle":"可选副标题","points":["要点1","要点2"]}]}',
    "配色盘：" + THEMES,
    "字体：" + FONTS,
    "整套用同一种 theme/font 贯穿。role 用上面给定的几种值，render 阶段会据此给每页定标题位置。",
  ].join("\n");
  const user = "主题：" + topic + "\n比例：" + preset + "\n页数：恰好 " + pages + " 页（pages 数组长度必须是 " + pages + "）。";
  return { sys, user };
}

// ---------- 2) DESIGN：全局设计系统 + 全局组件（输出一个 <style>） ----------
export function designPrompt(preset, P, plan) {
  const roles = Array.from(new Set((plan.pages || []).map((p) => p.role || "content"))).join("、");
  const sys = [
    "你是世界顶尖的中文视觉设计师。基于整套内容大纲，设计【贯穿全套的视觉系统 + 全局组件】，输出【一个 <style>…</style>】，之后每一页都复用它。",
    "",
    mediumBlock(preset, P),
    "",
    "在 <style> 里完成两件事：",
    "① 设计系统：配色、字号字阶、版式工具类、间距、装饰——全凭你的设计判断，自由发挥。",
    "② 全局组件（见下）：把 header/footer/标题区的位置和样式定义死，让每页只管套 class 填内容。",
    "",
    COMPONENTS,
    "本套出现的页面角色：" + (roles || "cover、content") + "。为每个角色定义好 .cm-titlebar 容器的位置；定位只加在容器上，容器内 .cm-title/.cm-subtitle 走常规流。",
    "⚠ 不要重定义 .card 本身的 width/height/position/margin/overflow——画布尺寸与卡片定位由运行时负责。",
    "",
    "选定基调：" + (plan.vibe || "") + "；建议 data-theme=" + (plan.theme || "") + "、data-font=" + (plan.font || "") + "（可进一步定制）。",
    TOKENS,
    "",
    "【只输出一个 <style>…</style>，不要 <section>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "整套大纲：\n" + JSON.stringify(plan, null, 2);
  return { sys, user };
}

// ---------- 3) RENDER：逐页排版（套用全局组件，链式承接） ----------
export function renderPrompt(preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total) {
  const role = pageSpec.role || "content";
  const sys = [
    "你是世界顶尖的中文海报/卡片设计师。排【第 " + pageNum + " / " + total + " 页】，输出【一个 <section class=\"card\" data-theme=\"…\" data-role=\"" + role + "\">…</section>】。",
    "",
    mediumBlock(preset, P),
    "data-role 必须是 \"" + role + "\"（全局样式据此给本页标题定位）。本页与上一页视觉承接、风格统一。",
    "",
    COMPONENTS,
    "套用方式：页眉 <div class=\"cm-header\">…</div>、页脚 <div class=\"cm-footer\"><span>左栏</span><span>右栏(页码如 02/08)</span></div>、标题区 <div class=\"cm-titlebar\"><h1 class=\"cm-title\">…</h1><p class=\"cm-subtitle\">…</p></div>——【只填文字，不写定位】。主标题副标题务必一起放进 .cm-titlebar、上下常规流，绝不单独定位副标题；页码只作页脚右栏 <span>。主内容区的版式你自由设计。",
    "复用全局设计系统的 class/令牌，别另起炉灶。",
    "",
    "全局设计系统 + 组件（已生效，直接套用，不要重复输出这个 <style>）：",
    designStyle || "（无，自己按令牌配色）",
    "",
    canvasBlock(preset, P),
    "",
    "【只输出这一页的 <section>…</section>，不要 <style>、不要别页、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = [
    "本页角色：" + role,
    "本页标题：" + (pageSpec.title || ""),
    pageSpec.subtitle ? "本页副标题：" + pageSpec.subtitle : "",
    "本页要点：" + (pageSpec.points && pageSpec.points.length ? pageSpec.points.join("；") : "（自定）"),
    prevHTML ? "\n上一页（用于视觉/叙事承接，不要重复它，只参考风格与衔接）：\n" + prevHTML : "\n这是第一页（封面），定下整套视觉基调。",
  ].filter(Boolean).join("\n");
  return { sys, user };
}

// ---------- 4) EDIT：只改本页主内容（全局组件定位锁死，模型拿不到别页） ----------
// 也用于「检查器反馈重排」：feedback 里带上检测到的问题。
export function editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total) {
  const sys = [
    "你在修改一套卡片 deck 里的【第 " + pageNum + " / " + total + " 页】——【只有这一页】。下面只给你这一页的当前 HTML，你只需返回这一页修改后的完整 <section>（保留它的 data-role）。",
    "",
    mediumBlock(preset, P),
    "",
    COMPONENTS,
    "【硬约束】header/footer/titlebar(含其内 title/subtitle) 的位置/尺寸/定位由全局 <style> 决定，跨页必须一致。你【只能改本页主内容区】：这些组件沿用全局 class、文字可改，但绝不能改它们的定位/位置/尺寸（不加内联 position/top/left/width，尤其【绝不单独给 .cm-subtitle 定位】）；页码沿用页脚右栏 <span>。",
    "",
    "全局设计系统 + 组件（已生效，直接套用，不要重复输出）：",
    designStyle || "（无）",
    "",
    canvasBlock(preset, P),
    "",
    "【只输出这一页修改后的 <section>…</section>，绝不输出别页、不要 <style>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "这一页（第 " + pageNum + " 页）的当前 HTML：\n" + currentHTML + "\n\n修改意见：" + (feedback || "优化这一页主内容区的排版与设计；全局组件保持不动。");
  return { sys, user };
}

// ---------- 5) STYLE：整套样式修改（改全局 <style>，所有页随之变） ----------
export function stylePrompt(preset, P, currentStyle, feedback) {
  const sys = [
    "你在修改一套卡片 deck 的【全局设计系统 <style>】——它定义整套的配色、字体、全局组件和工具类，每一页都复用它。改它，所有页一起变。",
    "按用户意见调整：配色 / 强调色、字体、组件外观、整体风格基调——设计判断由你做主。",
    "【必须保留全局组件的 class 名与定位结构】（.cm-header/.cm-footer/.cm-titlebar/.cm-title/.cm-subtitle 及各 .card[data-role=…] 的定位规则）——只改它们的视觉，不要删除、改名或挪动定位，否则各页会对不齐。",
    "若用户要换中文字体：在 <style> 之前单独输出一行 <!--FONT key-->（key 从 " + FONTS + " 里选）。",
    "",
    mediumBlock(preset, P),
    TOKENS,
    "",
    "【只输出修改后的完整 <style>…</style>（若换字体则其前面加一行 <!--FONT key-->），不要 <section>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "当前全局 <style>：\n" + currentStyle + "\n\n修改意见：" + feedback;
  return { sys, user };
}
