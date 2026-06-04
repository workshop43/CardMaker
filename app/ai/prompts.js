/* =============================================================
   分步生成的 prompt：plan（内容：每页完整文案 + 场景）→ design（设计视觉系统，
   并用真实内容排一张样板页供确认）→ render（用确认过的内容逐页排版）→ edit/style（改）。
   每个函数返回 { sys, user }。

   原则：
   ① 只给【任务 + 上下文(是什么/为谁做) + 硬约束 + 输出格式】，不替模型做审美决策
     （字号/排版/配色交回模型）。不写「你是世界顶尖…」这类角色扮演。
   ② 内容在 plan 阶段定稿（完整文案），render 只排版、不再编内容。
   ③ 样式在 design 阶段连同一张样板页一起产出，先确认再铺开全套。
   ④ 版面用常规流（.cm-header / .cm-main / .cm-footer），不靠绝对定位 chrome——结构上杜绝文字重叠。
   ============================================================= */

const THEMES = "light dark warm ink mint gradient ocean sky sunset forest paper bold pastel tech cream night";
const FONTS = "hei(现代黑) song(编辑宋) kai(文学楷) smiley(潮流标题) xiaowei(文艺宋) kuaile(活泼) mao(毛笔书法)";

// 任务规格：这是一张要导出成图片的固定尺寸版面（不是网页）。只说「是什么」，不指导「怎么设计」。
function mediumBlock(preset, P) {
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
    "- 自定义背景务必同时设文字色（深底配浅字、浅底配深字），别只改背景不改 --cm-fg。",
    "- 禁止 <html>/<head>/<body>、``` 围栏、解释文字、<script>、外链图片/字体/CSS。换字体用 data-font（" + FONTS + "）。",
    TOKENS,
  ].join("\n");
}

// 极简版面结构（常规流，杜绝绝对定位 chrome 导致的重叠）。这是系统约定，不是设计审美。
const LAYOUT = [
  "【版面结构 · 常规流，别用绝对定位钉页眉页脚】",
  "把一页排成三段常规流：可选页眉 <div class=\"cm-header\">…</div>、主内容 <div class=\"cm-main\">…</div>、可选页脚 <div class=\"cm-footer\"><span>左</span><span>右（页码如 02/08）</span></div>。",
  "- 主内容【必须】放进 .cm-main——它会自动撑满页眉与页脚之间，所以正文/标题/要点再多也【绝不会盖到页眉页脚】。标题、副标题、要点都放 .cm-main 里，常规流从上到下排，你自由设计版式。",
  "- 封面 / 金句这种极简页：给 <section> 加 class=\"cm-middle\"（内容垂直居中，页眉页脚自动钉上下边）。",
  "- 别用 position:absolute 去钉页眉/页脚/标题（运行时已处理）；页码就是页脚右侧 <span>，不另做。",
].join("\n");

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
export function planPrompt(preset, pages, topic) {
  const sys = [
    "把用户主题拆成一套卡片 deck，并写出每页的【完整文案】——是最终要印在卡片上的字，不是关键词大纲。",
    "先定场景（scene）：这套是干什么用的、给谁看、什么调性，一两句话——后续设计据此定风格。",
    "整套连续叙事：页与页有承接（总分/递进/起承转合）。每个内容页是能独立读懂的小章节。",
    "",
    "【只输出一个 JSON，禁止任何解释文字、禁止 ``` 围栏】，结构：",
    '{"title":"整套标题","scene":"用途/受众/调性，一两句","theme":"从配色盘选一个","font":"从字体选一个 key","pages":[' +
      '{"role":"cover|content|data|quote|ending","title":"本页标题(完整)","subtitle":"副标题(完整，可空)","content":[{"heading":"小标题(可空)","text":"完整说明句"}]}]}',
    "封面/金句/结尾页 content 可留空或一两条；内容/数据页给 2~3 条 content（每条 heading + 完整 text）。所有文字写完整、能直接读，就是最终上卡的字。",
    "配色盘：" + THEMES,
    "字体：" + FONTS,
    "整套用同一 theme/font。role 用上面给定的值。",
  ].join("\n");
  const user = "主题 / 要求：" + topic + "\n比例：" + preset + "\n页数：恰好 " + pages + " 页（pages 数组长度必须是 " + pages + "）。";
  return { sys, user };
}

// ---------- 2) DESIGN：设计视觉系统 + 用真实内容排一张样板页（输出 <style> + <section>） ----------
export function designPrompt(preset, P, plan, samplePage) {
  const roles = Array.from(new Set((plan.pages || []).map((p) => p.role || "content"))).join("、");
  const sampleRole = (samplePage && samplePage.role) || "content";
  const sys = [
    "为这套卡片设计【贯穿全套的视觉系统】，并立刻用它【把给定的一页真实内容排成一张完整的卡】作为样板（供用户先确认风格，再铺开全套）。",
    "输出两段，依次：① 一个 <style>…</style>（全套复用的设计系统 + 全局组件）；② 一个 <section>…</section>（套用该 <style>、data-role=\"" + sampleRole + "\" 的样板页，用下面给定的真实内容）。",
    "",
    mediumBlock(preset, P),
    sceneLine(plan),
    "建议 data-theme=" + (plan.theme || "") + "、data-font=" + (plan.font || "") + "（可进一步定制）。配色、字号字阶、版式、间距、装饰——设计判断由你做主。",
    "",
    LAYOUT,
    "⚠ 不要重定义 .card / .cm-main / .cm-header / .cm-footer 的 position 或 .card 的 width/height/margin/overflow——版面结构与画布尺寸由运行时负责，你只管配色、字体、字号、间距、装饰这些视觉。",
    "",
    canvasBlock(preset, P),
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
export function renderPrompt(preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total) {
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
    "复用全局设计系统的 class/令牌（配色/字体），别另起炉灶。",
    "",
    "全局设计系统 + 组件（已生效，直接套用，不要重复输出这个 <style>）：",
    designStyle || "（无，自己按令牌配色）",
    "",
    canvasBlock(preset, P),
    "",
    "【只输出这一页的 <section>…</section>，不要 <style>、不要别页、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = [
    pageContentText(pageSpec),
    prevHTML ? "\n上一页（仅参考风格与衔接，不要重复它）：\n" + prevHTML : "\n这是第一页。",
  ].join("\n");
  return { sys, user };
}

// ---------- 4) EDIT：只改本页主内容（全局组件定位锁死，模型拿不到别页） ----------
export function editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total) {
  const sys = [
    "修改一套卡片 deck 里的【第 " + pageNum + " / " + total + " 页】——只有这一页。下面只给你这一页的当前 HTML，返回这一页修改后的完整 <section>（保留它的 data-role）。",
    "",
    mediumBlock(preset, P),
    "",
    LAYOUT,
    "保持本页原有的 .cm-header/.cm-main/.cm-footer 结构与全局 class 不变（位置一致靠它们），别给它们加 position:absolute；主内容在 .cm-main 里改。",
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
    "修改一套卡片 deck 的【全局设计系统 <style>】——它定义整套的配色、字体、全局组件和工具类，每页都复用。改它，所有页一起变。",
    "按用户意见调整配色 / 强调色、字体、组件外观、整体风格——设计判断由你做主。",
    "【保留 .cm-header / .cm-main / .cm-footer 的常规流结构，别给它们加 position:absolute】——只改视觉（配色/字体/线条/质感），别动版面结构，否则各页会对不齐。",
    "若换中文字体：在 <style> 之前单独输出一行 <!--FONT key-->（key 从 " + FONTS + " 里选）。",
    "",
    mediumBlock(preset, P),
    TOKENS,
    "",
    "【只输出修改后的完整 <style>…</style>（若换字体则其前面加一行 <!--FONT key-->），不要 <section>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "当前全局 <style>：\n" + currentStyle + "\n\n修改意见：" + feedback;
  return { sys, user };
}
