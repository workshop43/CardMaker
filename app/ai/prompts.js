/* =============================================================
   分步生成的 prompt：plan（内容：每页完整文案 + 场景）→ design（设计视觉系统，
   并用真实内容排一张样板页供确认）→ render（用确认过的内容逐页排版）→ edit/style（改）。
   每个函数返回 { sys, user }。

   原则：
   ① 只给【任务 + 上下文(是什么/为谁做) + 硬约束 + 输出格式】，不替模型做审美决策
     （字号/排版/配色交回模型）。不写「你是世界顶尖…」这类角色扮演。
   ② 内容在 plan 阶段定稿（完整文案），render 只排版、不再编内容。
   ③ 样式在 design 阶段连同一张样板页一起产出，先确认再铺开全套。
   ④ 版面用常规流（.cm-header / .cm-main / .cm-footer），不靠绝对定位 chrome。
   ============================================================= */

const THEMES = "light dark warm ink mint gradient ocean sky sunset forest paper bold pastel tech cream night";
const FONTS = "hei(现代黑) song(编辑宋) kai(文学楷) smiley(潮流标题) xiaowei(文艺宋) kuaile(活泼) mao(毛笔书法)";

// 任务规格：这是一张要导出成图片的固定尺寸版面（不是网页）。只说「是什么」，不指导「怎么设计」。
function mediumBlock(preset, P) {
  if (preset === "story") {
    return "这是一套【微信公众号图文排版】：" + P.label + "，预览画布 " + P.w + "×" + P.h +
      "px。最终会复制为微信公众号编辑器可识别的 HTML 片段，所以内容应像一篇可连续阅读的公众号文章：清晰标题、导语、小标题、段落、重点卡片/引用/分隔，而不是全屏海报。视觉、排版、字号、配色完全由你做主。";
  }
  const seen = preset === "ppt" ? "在投影 / 大屏上看" : "发社交平台、在手机上看（会被缩小）";
  return "这是一张【要导出成图片】的固定尺寸版面：" + P.label + "，精确 " + P.w + "×" + P.h +
    "px，" + seen + "——是一张图，不是网页。视觉、排版、字号、配色完全由你做主。";
}

// 场景行：把整套的用途/受众/调性告诉模型（来自 plan.scene），让它设计有的放矢。
function sceneLine(plan) {
  return plan && plan.scene ? "这套的场景与调性：" + plan.scene : "";
}

const TOKENS =
  "可选设计令牌：--cm-fg 文字 · --cm-bg/--cm-card-bg 背景 · --cm-accent 强调(其上文字 --cm-accent-fg) · --cm-muted 次要 · --cm-line 描边 · 字阶 --cm-h1/--cm-h2/--cm-h3/--cm-text · 间距 --cm-pad/--cm-gap。用不用、用多大随你。";

function canvasBlock(preset, P) {
  return [
    "【硬约束】",
    "- 一个 <section class=\"card\"> 就是整页 " + P.w + "×" + P.h + "px，按真实像素设计；布局自由。内容超出 " + P.h + "px 会被裁切。",
    "- 正文不是整页画布：页眉、标题、副标题、页脚、padding 会占用空间；当前真实正文区域看上下文 layout_metrics.main 的 client_height / scroll_height。",
    "- 自定义背景务必同时设文字色（深底配浅字、浅底配深字），别只改背景不改 --cm-fg。",
    "- 禁止 <html>/<head>/<body>、``` 围栏、解释文字、<script>、外链图片/字体/CSS。换字体用 data-font（" + FONTS + "）。",
    TOKENS,
  ].join("\n");
}

// 所有模型调用都带同一份运行上下文：画布、运行时组件 CSS、当前 deck 级 style、公共 class。
function contextBlock(context) {
  if (!context) return "";
  return [
    "【完整运行上下文：画布 / style / 组件】",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

// 极简版面结构（常规流，避免绝对定位 chrome）。这是系统约定，不是设计审美。
const LAYOUT = [
  "【版面结构 · 常规流，别用绝对定位钉页眉页脚】",
  "把一页排成三段常规流：可选页眉 <div class=\"cm-header\">…</div>、主内容 <div class=\"cm-main\">…</div>、可选页脚 <div class=\"cm-footer\"><span>左</span><span>右（页码）</span></div>。",
  "- 主内容放进 .cm-main；.cm-main 的可用高度不是整页高度，必须结合 layout_metrics.main 的 client_height、scroll_height 和 main_overflows 判断。",
  "- 标题、副标题、要点都放 .cm-main 里，常规流从上到下排；内容多时需要自行调整字号、行高、间距、列数或内容密度。",
  "- 封面 / 金句这种极简页：给 <section> 加 class=\"cm-middle\"（内容垂直居中，页眉页脚自动钉上下边）。",
  "- 别用 position:absolute 去钉页眉/页脚/标题（运行时已处理）；页码就是页脚右侧 <span>，不另做。页码必须使用当前任务给你的真实页码，不要沿用任何示例数字。",
].join("\n");

const STYLE_POLICY = [
  "【风格边界】",
  "- 全套视觉风格必须集中在 deck 级 <style>：颜色、字体、阴影、背景、边框、圆角、装饰、组件质感都由全局样式控制。",
  "- 单页 <section> 负责内容结构与排版组合：可以使用公共 class、当前共享 style 里的 class，也可以自行组织语义 class 和 DOM 结构。",
  "- render/edit 阶段不要输出 <style>；颜色、背景、阴影、边框、圆角等视觉系统优先来自 deck 级 <style> 或 CSS 变量。",
  "- 页面局部排版密度可以用 style 属性调整布局和文字尺寸，例如 font-size、line-height、gap、grid-template、width/height。",
].join("\n");

const COMPONENT_POLICY = [
  "【跨页组件规范】",
  "- header/footer/title/subtitle/page number/section label/内容块样式都是跨页组件，不是每页临时发挥的装饰。",
  "- design 阶段必须在全局 <style> 中定义这些组件的视觉和间距规范；后续页面只复用这些组件。",
  "- header/footer/page number/title/subtitle 这些跨页 chrome 保持同一套视觉系统。",
  "- 正文内容区可以重组 DOM 结构、组件组合和信息层级；页面之间可以使用不同正文版式。",
  "- 页面之间可以换内容版式，但不能换 UI 系统；同类角色页面的 title/subtitle/header/footer 必须有稳定位置、稳定层级、稳定样式。",
].join("\n");

const ROLE_LAYOUT_POLICY = [
  "【页面角色与布局】",
  "- cover/ending/quote 可以使用 cm-middle 和封面式大标题。",
  "- content/data 是正文页，通常由标题、副标题、正文块组成，放在 .cm-main 常规流里。",
  "- 页面内容必须在固定画布内完整呈现。",
].join("\n");

const OVERFLOW_POLICY = [
  "【输出前版面自检】",
  "- 输出前必须用上下文里的 layout_metrics 判断正文显示区，而不是只按整页画布估算。",
  "- 检查 .cm-main：内容高度不能超过 client_height，也不要贴近底部；应保留可感知的安全余量。",
  "- 检查正文里的容器、卡块、分栏、网格、callout、band、feature row：文字不能溢出容器，也不要贴近容器边界。",
  "- 如果正文区或局部容器有溢出/贴边风险，自行选择更适合的版式，或降低 font-size、line-height、gap、padding，或减少列数/改变分栏比例。",
  "- 允许用公共组件，也允许自行设计 DOM 结构；最终结果必须完整落在正文显示区和各自容器内。",
].join("\n");

// 页码规则：每次只给当前页的确定值，避免模型从示例里抄出错误总页数。
function pageNumberLine(pageNum, total) {
  if (!pageNum || !total) return "";
  return "本页元信息：当前页序号=" + pageNum + "，总页数=" + total + "。若出现页码，只能基于这两个数字格式化；禁止抄写示例页码或其他总页数。";
}

// 把一页的「定稿内容」渲染成喂给模型的文本（render/design 样板页共用）。
export function pageContentText(pg) {
  const lines = [];
  lines.push("角色：" + (pg.role || "content"));
  if (pg.title) lines.push("标题：" + pg.title);
  if (pg.subtitle) lines.push("副标题：" + pg.subtitle);
  if (pg.content && pg.content.length) {
    lines.push("内容（逐条排进去，文字照用、不要改写或增删）：");
    pg.content.forEach((c) => lines.push("- " + (c.heading ? c.heading + "：" : "") + (c.text || "")));
  }
  return lines.join("\n");
}

// ---------- 1) PLAN：内容定稿（每页完整文案 + 场景，输出 JSON） ----------
export function planPrompt(preset, pages, topic, context) {
  const isStory = preset === "story";
  const pageLine = isStory
    ? "页数：恰好 1 页（微信公众号排版是单篇长文，不分页；pages 数组长度必须是 1）。"
    : pages
    ? "页数：恰好 " + pages + " 页（pages 数组长度必须是 " + pages + "）。"
    : "页数：结合主题、受众、内容复杂度和输入约束自行决定。";
  const storyLine = isStory
    ? "微信公众号模式：pages[0] 承载整篇文章，把完整标题、导语、章节、小标题、段落、引用/重点块都放进这一页的 content；根据内容需要给 6~12 条 content，不要拆成多页。"
    : "整套连续叙事：页与页有承接（总分/递进/起承转合）。每个内容页是能独立读懂的小章节。";
  const contentLine = isStory
    ? "公众号长文页的 content 要覆盖完整文章结构（每条 heading + 完整 text），文字写完整、能直接读，就是最终进入公众号的正文。"
    : "封面/金句/结尾页 content 可留空或一两条；内容/数据页给 2~3 条 content（每条 heading + 完整 text）。所有文字写完整、能直接读，就是最终上卡的字。";
  const sys = [
    "把主题拆成一套卡片 deck，并写出每页的【完整文案】——是最终要印在卡片上的字，而不是粗略提纲。",
    "先定场景（scene）：这套是干什么用的、给谁看、什么调性，一两句话——后续设计据此定风格。",
    storyLine,
    "",
    "【只输出一个 JSON，禁止任何解释文字、禁止 ``` 围栏】，结构：",
    '{"title":"整套标题","scene":"用途/受众/调性，一两句","theme":"从配色盘选一个","font":"从字体选一个 key","pages":[' +
      '{"role":"cover|content|data|quote|ending","title":"本页标题(完整)","subtitle":"副标题(完整，可空)","content":[{"heading":"小标题(可空)","text":"完整说明句"}]}]}',
    contentLine,
    "配色盘：" + THEMES,
    "字体：" + FONTS,
    "整套用同一 theme/font。role 用上面给定的值。",
    "",
    contextBlock(context),
  ].join("\n");
  const user = "主题 / 要求：" + topic + "\n比例：" + preset + "\n" + pageLine;
  return { sys, user };
}

// ---------- 0) INTENT：理解用户这句话要做什么（只输出 JSON） ----------
export function intentPrompt(context, text) {
  const sys = [
    "判断用户这句话在 CardMaker 当前 deck 中的操作意图。只做分类，不执行修改。",
    "必须只输出一个 JSON，禁止解释文字、禁止 ``` 围栏。",
    "",
    "intent 只能取以下枚举，按操作作用域理解：",
    "- generate_new：创建一套新 deck，当前画布已有内容时也可以被新 deck 替换",
    "- edit_page：只改变一个页面",
    "- edit_pages：改变多个页面，但不改变页面清单",
    "- edit_content：定向修改已有页面里的文字、元素属性、元素 class，或某个具体元素实例的局部排版属性，不重绘页面",
    "- edit_global_style：改变 deck 级 <style>、selector/class 规则、视觉系统、跨页组件规范，或改变整套主题/data-theme",
    "- edit_structure：改变页面清单本身",
    "- unknown：当前上下文不足以判断",
    "",
    "输出结构：",
    '{"intent":"generate_new|edit_page|edit_pages|edit_content|edit_global_style|edit_structure|unknown","target_pages":[页码数字],"reference_page":页码数字或null,"reason":"简短原因"}',
    "target_pages / reference_page 只在目标是已有页面时填写；创建新 deck 时 target_pages 为空数组。",
    "",
    "结合输入和当前上下文自行判断 intent、目标页和参考页；信息不足时返回 unknown。不要执行任务，只返回判断结果。",
  ].join("\n");
  const user = [
    "当前上下文：\n" + JSON.stringify(context, null, 2),
    "用户输入：\n" + text,
  ].join("\n\n");
  return { sys, user };
}

// ---------- 2) DESIGN：设计视觉系统 + 用真实内容排一张样板页（输出 <style> + <section>） ----------
export function designPrompt(preset, P, plan, samplePage, samplePageNum, total, context) {
  const roles = Array.from(new Set((plan.pages || []).map((p) => p.role || "content"))).join("、");
  const sampleRole = (samplePage && samplePage.role) || "content";
  const sys = [
    "为这套卡片设计【贯穿全套的视觉系统】，并立刻用它【把给定的一页真实内容排成一张完整的卡】作为样板（供用户先确认风格，再铺开全套）。",
    "输出两段，依次：① 一个 <style>…</style>（全套复用的设计系统 + 全局组件）；② 一个 <section>…</section>（套用该 <style>、data-role=\"" + sampleRole + "\" 的样板页，用下面给定的真实内容）。",
    "",
    mediumBlock(preset, P),
    sceneLine(plan),
    "建议 data-theme=" + (plan.theme || "") + "、data-font=" + (plan.font || "") + "（可进一步定制）。配色、字号字阶、版式、间距、装饰——设计判断由你做主。",
    "你必须在 <style> 中定义足够复用的页面组件和 role 变体，让 cover/content/data/quote/ending 都能用同一套视觉语言排版；不要把关键视觉写进样板页的 style 属性。",
    "",
    LAYOUT,
    STYLE_POLICY,
    COMPONENT_POLICY,
    ROLE_LAYOUT_POLICY,
    OVERFLOW_POLICY,
    pageNumberLine(samplePageNum, total),
    "⚠ 不要重定义 .card / .cm-main / .cm-header / .cm-footer 的 position 或 .card 的 width/height/margin/overflow——版面结构与画布尺寸由运行时负责，你只管配色、字体、字号、间距、装饰这些视觉。",
    "",
    canvasBlock(preset, P),
    contextBlock(context),
    "",
    "样板页要排的真实内容：\n" + pageContentText(samplePage || { role: "content" }),
    "",
    "【先输出完整的 <style>…</style>，紧接着输出一个 <section>…</section>；不要别的页、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "整套内容大纲（场景/风格参考；样板只排上面指定的那一页）：\n" +
    JSON.stringify({ title: plan.title, scene: plan.scene, theme: plan.theme, font: plan.font, pages: (plan.pages || []).map((p) => ({ role: p.role, title: p.title })) }, null, 2);
  return { sys, user };
}

// ---------- 3) RENDER：用定稿内容排某一页（套用全局样式，链式承接） ----------
export function renderPrompt(preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total, layoutReferenceHTML, context) {
  const role = pageSpec.role || "content";
  const sys = [
    "把【已定稿的内容】排成第 " + pageNum + " / " + total + " 页，输出【一个 <section class=\"card\" data-theme=\"…\" data-role=\"" + role + "\">…</section>】。",
    "内容是定好的：照排，不要增删、不要改写文字、不要自己编新内容。你做的是排版与视觉。",
    "",
    mediumBlock(preset, P),
    sceneLine(plan),
    "data-role 必须是 \"" + role + "\"。与上一页视觉承接、风格统一。",
    "",
    LAYOUT,
    STYLE_POLICY,
    COMPONENT_POLICY,
    ROLE_LAYOUT_POLICY,
    OVERFLOW_POLICY,
    pageNumberLine(pageNum, total),
    "可以复用全局设计系统的 class/令牌，也可以自行组织正文 DOM 和语义 class；新增页面必须看起来像同一套 deck 的自然延续。",
    "",
    "全局设计系统 + 组件（已生效，直接套用，不要重复输出这个 <style>）：",
    designStyle || "（无，自己按令牌配色）",
    "",
    "已确认页面规范参考（只学习跨页 chrome、色彩、字体、组件视觉，不复制其内容）：",
    layoutReferenceHTML || "（无）",
    "",
    canvasBlock(preset, P),
    contextBlock(context),
    "",
    "【只输出这一页的 <section>…</section>，不要 <style>、不要别页、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = [
    pageContentText(pageSpec),
    prevHTML ? "\n上一页（仅参考风格与衔接，不要重复它）：\n" + prevHTML : "\n这是第一页。",
  ].join("\n");
  return { sys, user };
}

// ---------- 4) EDIT：只改目标页；可复用全局组件样式，不能改 deck 级 style ----------
export function editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total, referenceHTML, context) {
  const sys = [
    "【模式：单页修改】修改一套卡片 deck 里的【第 " + pageNum + " / " + total + " 页】——只能改这一页。",
    "返回当前页修改后的完整 <section>。",
    "可以重组本页 .cm-main 内的 DOM 结构、正文组件组合和信息层级；跨页 header/footer/page number 仍复用当前视觉系统。",
    "不要输出其他页面、整套大纲、解释文字或代码围栏。",
    "",
    mediumBlock(preset, P),
    canvasBlock(preset, P),
    STYLE_POLICY,
    COMPONENT_POLICY,
    OVERFLOW_POLICY,
    pageNumberLine(pageNum, total),
    contextBlock(context),
    "",
    "当前共享 <style> 与公共 class 清单（只读；这些 class 可用但不强制，也可以自行设计正文结构和语义 class；不要输出或修改 <style>）：",
    designStyle || "（无）",
    "",
    "【只输出这一页修改后的 <section>…</section>，绝不输出别页、不要 <style>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = [
    "任务类型：只修改当前这一页。",
    "当前页 HTML：\n" + currentHTML,
    referenceHTML ? "参考页 HTML（只学习视觉风格和跨页 chrome，不复制参考页内容）：\n" + referenceHTML : "",
    "修改意见：\n" + (feedback || "优化这一页主内容区的排版与设计；全局组件保持不动。"),
  ].filter(Boolean).join("\n\n");
  return { sys, user };
}

// ---------- 4.5) CONTENT PATCH：定向修改已有 DOM 内容 / 组件属性 / 局部样式 ----------
export function contentPatchPrompt(context, feedback) {
  const sys = [
    "【模式：定向内容/组件补丁】修改已有 CardMaker deck。不要重绘页面、不要改全局 <style>、不要输出 <section>。",
    "只返回一个 JSON patch，由前端按选择器在 DOM 上执行。",
    "",
    "输出结构：",
    '{"ops":[{"op":"replace_text","page":"all 或页码数字","selector":"CSS 选择器或空字符串","from":"原文字","to":"新文字","mode":"exact|contains|regex"},{"op":"set_text","page":"all 或页码数字","selector":"CSS 选择器","text":"新文本"},{"op":"set_html","page":"all 或页码数字","selector":"CSS 选择器","html":"安全 HTML 片段"},{"op":"remove","page":"all 或页码数字","selector":"CSS 选择器"},{"op":"set_attr","page":"all 或页码数字","selector":"CSS 选择器","name":"属性名","value":"属性值"},{"op":"remove_attr","page":"all 或页码数字","selector":"CSS 选择器","name":"属性名"},{"op":"add_class","page":"all 或页码数字","selector":"CSS 选择器","class":"类名 空格分隔"},{"op":"remove_class","page":"all 或页码数字","selector":"CSS 选择器","class":"类名 空格分隔"},{"op":"set_style","page":"all 或页码数字","selector":"CSS 选择器","style":"CSS 声明"}]}',
    "",
    "规则：",
    "- 只输出 JSON，禁止解释文字、禁止 ``` 围栏。",
    "- page 可取页码数字或 \"all\"。",
    "- selector 要尽量精确。header 用 .cm-header，footer 用 .cm-footer，主内容用 .cm-main；右上角 header 常见选择器是 .cm-header span:last-child。",
    "- replace_text 可 selector 为空，表示在目标页所有文本节点里替换；如果给 selector，只在该组件内替换。",
    "- set_html 只能使用安全片段，禁止 <script>、<style>、外链资源。",
    "- set_style 只用于具体元素实例的布局和文字排版尺寸，例如 font-size、line-height、gap、grid-template、width/height；不要用它处理 class 级样式或全局 style 修改。",
  ].join("\n");
  const user = [
    "当前 deck 上下文：\n" + JSON.stringify(context, null, 2),
    "用户需求：\n" + feedback,
  ].join("\n\n");
  return { sys, user };
}

// ---------- 5) STRUCTURE：增删页面 / 调整页面顺序（只改 plan，不直接产 HTML） ----------
export function structurePrompt(plan, feedback, currentPageNum, context) {
  const pages = (plan.pages || []).map((p, i) => ({
    id: "p" + (i + 1),
    role: p.role || "content",
    title: p.title || "",
    subtitle: p.subtitle || "",
    content: p.content || [],
  }));
  const sys = [
    "【模式：页面结构调整】调整 deck 的页面清单，只处理增加页面、删除页面、减少页数、调整页面顺序。",
    "不要输出 HTML，不要写 <section>，不要改全局样式。你只返回新的 plan JSON。",
    "保留不在本次结构调整范围内的页面：原有页面必须带回它的 id；新增页面 id 写 \"new\"。",
    "删除页面：从 pages 数组移除对应原有页面。",
    "调整顺序：只改变 pages 数组顺序，不改页面文案。",
    "增加页面：为新增页写完整 title/subtitle/content，role 从 cover/content/data/quote/ending 中选择；新增页必须能和上下页衔接。",
    "涉及当前页的相对操作时，当前页序号按下面给出的 currentPageNum 理解。",
    "",
    "【只输出一个 JSON，禁止解释文字、禁止 ``` 围栏】，结构：",
    '{"title":"整套标题","scene":"用途/受众/调性","theme":"主题 key","font":"字体 key","pages":[{"id":"p1 或 new","role":"cover|content|data|quote|ending","title":"完整标题","subtitle":"完整副标题，可空","content":[{"heading":"小标题，可空","text":"完整说明句"}]}]}',
    "",
    contextBlock(context),
  ].join("\n");
  const user = [
    "当前页序号：" + currentPageNum,
    "用户结构调整需求：\n" + feedback,
    "当前 plan：\n" + JSON.stringify({
      title: plan.title || "",
      scene: plan.scene || "",
      theme: plan.theme || "",
      font: plan.font || "",
      pages,
    }, null, 2),
  ].join("\n\n");
  return { sys, user };
}

// ---------- 6) STYLE：整套样式修改（改全局 <style>，所有页随之变） ----------
export function stylePrompt(preset, P, currentStyle, feedback, deckReferenceHTML, context) {
  const sys = [
    "修改一套卡片 deck 的【全局设计系统 <style>】——它定义整套的配色、字体、全局组件和工具类，每页都复用。改它，所有页一起变。",
    "可按用户意见精确修改已有 selector/class 规则，也可补充新的 class 规则；保留不相关规则和当前视觉系统。",
    "可调整配色 / 强调色、字体、组件外观、整体风格、跨页组件规范——设计判断由你做主。",
    "可调整 header/footer/title/subtitle/page number/内容块/section label 等跨页组件的样式、间距、层级和密度一致性。",
    "【保留 .cm-header / .cm-main / .cm-footer 的常规流结构，别给它们加 position:absolute】——只改视觉（配色/字体/线条/质感），别动版面结构，否则各页会对不齐。",
    "不要输出 <section>，不要把 class 级样式分散写进每页 section 的 style 属性。",
    "若换中文字体：在 <style> 之前单独输出一行 <!--FONT key-->（key 从 " + FONTS + " 里选）。",
    "若整套需要切换内置主题 key：在 <style> 之前单独输出一行 <!--THEME key-->（key 从 " + THEMES + " 里选）。这会由执行层统一写到所有页面的 data-theme。",
    "",
    mediumBlock(preset, P),
    canvasBlock(preset, P),
    STYLE_POLICY,
    COMPONENT_POLICY,
    OVERFLOW_POLICY,
    TOKENS,
    contextBlock(context),
    "",
    "【只输出修改后的完整 <style>…</style>（若换字体/主题则其前面加 <!--FONT key--> / <!--THEME key-->），不要 <section>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = [
    "当前全局 <style>：\n" + currentStyle,
    deckReferenceHTML ? "当前页面样例（只用于观察现有跨页组件和不一致处，不要输出这些 section）：\n" + deckReferenceHTML : "",
    "修改意见：" + feedback,
  ].filter(Boolean).join("\n\n");
  return { sys, user };
}
