/* =============================================================
   分步生成的四段 prompt：plan（内容大纲）→ design（全局设计系统 + 全局组件）
   → render（逐页排版，套用全局组件，链式承接）→ edit（只改本页主内容，组件定位锁死）。
   每个函数返回 { sys, user }，交给 callModel。
   设计原则：① 把画布真实状态充分告知 LLM、无运行时兜底、布局自由；
   ② 跨页一致的组件（header/footer/页码/title/subtitle）在 design 阶段定义一次、
      每页只套 class 填内容——保证改单页时它们的位置/样式绝不漂移。
   ============================================================= */

const THEMES = "light dark warm ink mint gradient ocean sky sunset forest paper bold pastel tech cream night";
const FONTS = "hei(现代黑) song(编辑宋) kai(文学楷) smiley(潮流标题) xiaowei(文艺宋) kuaile(活泼) mao(毛笔书法)";

const PRESET_TIP = {
  ppt: "16:9 横向演示稿（纵向很矮）。文档型 keynote：每页讲清一个主题的多个侧面，标题领衔、要点/数据横向铺开，纵向克制别堆太高。",
  story: "9:16 全屏竖版海报（高而窄）：纵向充裕，大字标题领衔，自上而下叙事，可承接多组结构化要点。",
  square: "1:1 方形卡片：构图均衡居中，内容精炼而充实。",
  xiaohongshu: "3:4 小红书竖版：干货信息卡，标题抓眼，正文给 3~5 条结构化干货，底部留署名——让人想截图收藏。",
};

const PRESET_FONT = {
  xiaohongshu: "正文 34~40px、小标题 ~46px、标题 60~84px、巨标题 ~110px",
  square: "正文 ~30px、小标题 ~34px、标题 44~60px、巨标题 ~88px",
  ppt: "正文 ~34px、小标题 ~40px、标题 52~72px、巨标题 ~110px",
  story: "正文 ~32px、小标题 ~40px、标题 56~82px、巨标题 ~130px",
};

// 画布真实状态——所有阶段共享（充分告知 + 无兜底 + 完全自由）
function canvasBlock(preset, P) {
  return [
    "【画布 · 你全权掌控，没有任何运行时兜底】",
    "- 固定整页画布：" + P.label + "（精确 " + P.w + "×" + P.h + "px）。一个 <section class=\"card\"> 就是这么大一块，按真实像素设计。",
    "- 没有 auto-fit、不自动缩放、不自动改色：写成什么样、导出就是什么样。【内容超出 " + P.h + "px 会被直接裁掉】，自己估准内容量、放不下就精简或拆页，绝不硬塞。",
    "- 主内容区布局完全自由：flex、grid、绝对定位都行。",
    "- 字号（大画布会被缩小观看，字要够大）：" + (PRESET_FONT[preset] || PRESET_FONT.xiaohongshu) + "。绝不要 14~22px 网页小号，正文低于 ~28px 算太小。拿不准就用 var(--cm-text)/var(--cm-h1) 等令牌（已按比例调好）。",
    "- 自定义背景务必同时设文字色（深底配浅字、浅底配深字），别只改背景不改 --cm-fg。",
    "- 禁止 <html>/<head>/<body>、``` 围栏、解释文字、<script>、外链图片/字体/CSS。换字体用 data-font。",
    "- 本比例取向：" + (PRESET_TIP[preset] || PRESET_TIP.xiaohongshu),
  ].join("\n");
}

const TOKENS =
  "设计令牌（已按比例调好，可引用或在 <style> 里覆盖）：--cm-fg 文字 · --cm-bg/--cm-card-bg 背景 · --cm-accent 强调(其上文字 --cm-accent-fg) · --cm-muted 次要 · --cm-line 描边；字阶 --cm-h1/--cm-h2/--cm-h3/--cm-text；间距 --cm-pad/--cm-gap。";

// 跨页一致的「全局组件」约定：位置/样式在 design 的全局 <style> 里定义一次，每页只套 class 填内容。
const COMPONENTS = [
  "【全局组件 · 跨页位置与样式完全一致——只在全局 <style> 里定义一次，每页套同名 class 只填内容，绝不在页内写它们的定位】",
  "- 固定 chrome（所有页同一坐标）：页眉 .cm-header（钉卡片顶部）、页脚 .cm-footer（钉底部）、页码 .cm-pageno（如右下角）。用 position:absolute 钉在卡片边缘。",
  "- 标题区（按页面角色 data-role 定位，同角色的页位置完全一致）：主标题 .cm-title、副标题 .cm-subtitle。",
  "  用形如 .card[data-role=\"cover\"] .cm-title{…} 与 .card[data-role=\"content\"] .cm-title{…} 区分角色——封面标题可大而居中，内容/数据/金句页的标题统一靠上、同一位置。",
  "- 这些组件的位置/尺寸/样式【只此一处定义】，每页直接套 class；这样无论生成还是改单页，它们跨页都不会漂移。",
].join("\n");

// ---------- 1) PLAN：内容大纲（输出 JSON） ----------
export function planPrompt(preset, pages, topic) {
  const sys = [
    "你是世界顶尖的中文内容策划。把用户主题拆成一套【连贯、读完即懂、信息充实】的卡片 deck 的内容大纲。",
    "这套卡片是【连续叙事】：页与页之间有承接关系（总分、递进、起承转合），不是互不相干的散页。",
    "每个内容页是一个能独立读懂的小章节：清晰标题 + 2~3 个结构化要点（小标题级短句，不是长段落）。",
    "节奏参考：封面(冲击力) → 分栏/拆解内容页(结构充实) → 数据或清单页(信息密度) → 金句页(情绪) → 结尾(行动召唤)。",
    "",
    "【只输出一个 JSON，禁止任何解释文字、禁止 ``` 围栏】，结构：",
    '{"title":"整套标题","vibe":"一句话视觉基调","theme":"从配色盘选一个","font":"从字体里选一个 key","pages":[{"role":"cover|content|data|quote|ending","title":"本页标题","subtitle":"可选副标题","points":["要点1","要点2"]}]}',
    "配色盘：" + THEMES,
    "字体：" + FONTS,
    "整套用同一种 theme/font 贯穿（封面结尾可同色系更浓）。role 用上面给定的几种值，render 阶段会据此给每页定标题位置。",
  ].join("\n");
  const user = "主题：" + topic + "\n比例：" + preset + "\n页数：恰好 " + pages + " 页（pages 数组长度必须是 " + pages + "）。";
  return { sys, user };
}

// ---------- 2) DESIGN：全局设计系统 + 全局组件（输出一个 <style>） ----------
export function designPrompt(preset, P, plan) {
  const roles = Array.from(new Set((plan.pages || []).map((p) => p.role || "content"))).join("、");
  const sys = [
    "你是世界顶尖的中文视觉设计师。基于整套内容大纲，设计【贯穿全套的视觉系统 + 全局组件】，输出【一个 <style>…</style>】，之后每一页都复用它。",
    "在 <style> 里完成两件事：",
    "① 设计系统：配色（覆盖 --cm-* 令牌或配合选定 data-theme）、可复用版式工具类、间距/字阶节奏、可选装饰母题。",
    "② 全局组件（见下）：把 header/footer/页码/标题/副标题的【位置和样式】在这里定义死，让每页只管套 class 填内容。",
    "",
    COMPONENTS,
    "⚠ 不要重定义 .card 本身的 width/height/position/margin/overflow——画布尺寸与卡片定位由运行时负责；你只定义配色令牌、全局组件（.cm-*）、可复用工具类。",
    "本套出现的页面角色：" + (roles || "cover、content") + "。请为每个角色定义好 .cm-title/.cm-subtitle 的位置（封面可居中放大，其余内容页统一靠上同位置）。",
    "",
    "选定基调：" + (plan.vibe || "") + "；建议 data-theme=" + (plan.theme || "") + "、data-font=" + (plan.font || "") + "（可在 <style> 里进一步定制）。",
    TOKENS,
    "画布：" + P.label + "（" + P.w + "×" + P.h + "px）。组件用真实像素定位，字号按大画布尺度（别用网页小号）。",
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
    "你是世界顶尖的中文卡片排版师。排【第 " + pageNum + " / " + total + " 页】，输出【一个 <section class=\"card\" data-theme=\"…\" data-role=\"" + role + "\">…</section>】。",
    "data-role 必须是 \"" + role + "\"——全局样式据此给本页标题定位。",
    "这是连续叙事的一页，与上一页【视觉承接、风格统一】，本页内容结构清晰、有层级、信息充实。",
    "",
    COMPONENTS,
    "所以：页眉用 <div class=\"cm-header\">…</div>、页脚 <div class=\"cm-footer\">…</div>、页码 <div class=\"cm-pageno\">…</div>、主标题 <h1 class=\"cm-title\">…</h1>、副标题 <p class=\"cm-subtitle\">…</p>——【只填文字内容，不要给它们写任何定位/位置样式】（位置已由全局 <style> 钉死）。你自由设计的是【主内容区】的版式。",
    "复用全局设计系统里的配色/工具类，别另起炉灶；本页可写少量内联样式微调主内容。",
    "",
    "全局设计系统 + 组件（已生效，直接套用其中 class/令牌；不要重复输出这个 <style>）：",
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
export function editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total) {
  const sys = [
    "你在修改一套卡片 deck 里的【第 " + pageNum + " / " + total + " 页】——【只有这一页】。下面只给你这一页的当前 HTML，你只需返回这一页修改后的完整 <section>（保留它的 data-role）。",
    "",
    COMPONENTS,
    "【硬约束】header/footer/页码/title/subtitle 这些全局组件的【位置、尺寸、定位样式由全局 <style> 决定，跨页必须一致】。你【只能改本页主内容区】；这些组件沿用全局 class、文字内容可改，但【绝不能改它们的定位/位置/尺寸】——不要给它们加内联 position/top/left/width，不要覆盖它们的布局，否则本页就会和别页对不齐（这正是要避免的）。",
    "",
    "全局设计系统 + 组件（已生效，直接套用，不要重复输出）：",
    designStyle || "（无）",
    "",
    canvasBlock(preset, P),
    "",
    "【只输出这一页修改后的 <section>…</section>，绝不输出别页、不要 <style>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "这一页（第 " + pageNum + " 页）的当前 HTML：\n" + currentHTML + "\n\n修改意见：" + (feedback || "优化这一页主内容区的排版与设计，使其更专业、信息更清晰、不溢出；全局组件保持不动。");
  return { sys, user };
}

// ---------- 5) STYLE：整套样式修改（改全局 <style>，所有页随之变） ----------
export function stylePrompt(preset, P, currentStyle, feedback) {
  const sys = [
    "你在修改一套卡片 deck 的【全局设计系统 <style>】——它定义整套的配色、字体、全局组件(header/footer/页码/标题/副标题)和工具类，每一页都复用它。改它，所有页会一起变。",
    "按用户意见调整：配色 / 强调色、字体、组件外观（线条/质感/留白）、整体风格基调。",
    "【必须保留全局组件的 class 名与定位结构】（.cm-header/.cm-footer/.cm-pageno/.cm-title/.cm-subtitle 以及各 .card[data-role=…] 的定位规则）——只改它们的视觉（颜色/字体/线条/质感），不要删除、改名或挪动定位，否则各页会对不齐。",
    "若用户要换中文字体：在 <style> 之前单独输出一行 <!--FONT key-->（key 从 " + FONTS + " 里选），运行时据此加载该中文 web 字体；同时可在 style 里设 font-family 兜底。",
    "",
    TOKENS,
    "画布：" + P.label + "（" + P.w + "×" + P.h + "px）。字号按大画布尺度，别用网页小号。",
    "",
    "【只输出修改后的完整 <style>…</style>（若换字体则其前面加一行 <!--FONT key-->），不要 <section>、不要解释文字、不要 ``` 围栏。】",
  ].join("\n");
  const user = "当前全局 <style>：\n" + currentStyle + "\n\n修改意见：" + feedback;
  return { sys, user };
}
