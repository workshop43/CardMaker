/* =============================================================
   AI 对话面板：右侧固定侧栏，生成 / 编辑 / 风格修改全在对话里进行，
   不再使用模态框覆盖画布。
   ============================================================= */
import { CardMaker } from "../deck.js";
import { listProviders, defaultProvider, loadSaved, saveCfg, resolveCfg, setLastCfg } from "./model.js";
import { extractStyle } from "./model.js";
import { classifyIntent, makePlan, makeDesignSample, renderPage, editPage, makeContentPatch, revisePlanStructure, editStyle } from "./pipeline.js";

// ─── 状态 ─────────────────────────────────────────────────────────────────────
let P = null;   // 面板 DOM 引用 { msgs, input, send, styleFile, styleStatus }
let S = null;   // 生成会话 { app,cfg,preset,PSet,plan,designStyle,sections,nextIdx,sampleIdx,sampleSection,aborted }
let activeJob = null; // 当前 LLM 请求 { controller }
let uploadedStyle = null; // 当前 conversation 附加的样式 { name, style }

// ─── 入口 ─────────────────────────────────────────────────────────────────────
export function mountAI(app) {
  injectStyles();
  buildPanel(app);
}

// ─── 面板构建 ─────────────────────────────────────────────────────────────────
function buildPanel(app) {
  const body = app.app.querySelector(".cm-body");
  const wrap = el("div", "cm-ai-panel");
  wrap.innerHTML =
    '<div class="cm-ai-head">' +
      '<span class="cm-ai-brand">AI 助手</span>' +
      '<button class="cm-btn cm-ai-cfg" title="API 设置">⚙</button>' +
    "</div>" +
    '<div class="cm-ai-msgs"></div>' +
    '<div class="cm-ai-foot">' +
      '<div class="cm-ai-quick-menu">' +
        '<button class="cm-btn cm-ai-quick-trigger" type="button">快捷</button>' +
        '<button class="cm-btn cm-ai-style-attach" type="button">上传样式</button>' +
        '<input class="cm-ai-style-file" type="file" accept=".css,.txt,.html,text/css,text/plain,text/html" hidden />' +
        '<div class="cm-ai-style-status" data-state="empty" hidden>' +
          '<span class="cm-ai-style-dot"></span>' +
          '<span class="cm-ai-style-text"></span>' +
          '<button class="cm-ai-style-clear" type="button" hidden>移除</button>' +
        "</div>" +
        '<div class="cm-ai-quick-pop" hidden>' +
          '<button class="cm-btn" data-quick="redesign">重做配色排版</button>' +
          '<button class="cm-btn" data-quick="add-content">增加内容页</button>' +
          '<button class="cm-btn" data-quick="ending">生成封底</button>' +
          '<button class="cm-btn" data-quick="overflow">正文溢出重排</button>' +
          '<button class="cm-btn" data-quick="reflow">正文排版重排</button>' +
          '<button class="cm-btn" data-quick="expand">正文太少补充</button>' +
        "</div>" +
      "</div>" +
      '<div class="cm-ai-input-wrap">' +
        '<textarea class="cm-ai-input" placeholder="描述你想做的卡片，或输入修改意见…\n⌘/Ctrl + Enter 发送" rows="3"></textarea>' +
        '<button class="cm-btn cm-primary cm-ai-send" title="发送" aria-label="发送"></button>' +
      "</div>" +
    "</div>";
  body.appendChild(wrap);

  P = {
    wrap, msgs: wrap.querySelector(".cm-ai-msgs"),
    input: wrap.querySelector(".cm-ai-input"), send: wrap.querySelector(".cm-ai-send"),
    styleFile: wrap.querySelector(".cm-ai-style-file"),
    styleStatus: wrap.querySelector(".cm-ai-style-status"),
    styleText: wrap.querySelector(".cm-ai-style-text"),
    styleClear: wrap.querySelector(".cm-ai-style-clear"),
  };

  installStyleToolbar(app);
  wrap.querySelector(".cm-ai-cfg").onclick = () => openSettings(app);
  const quickPop = wrap.querySelector(".cm-ai-quick-pop");
  wrap.querySelector(".cm-ai-quick-trigger").onclick = (e) => { e.stopPropagation(); quickPop.hidden = !quickPop.hidden; };
  wrap.querySelector(".cm-ai-style-attach").onclick = () => P.styleFile.click();
  P.styleFile.onchange = () => importStyleFile(app, P.styleFile);
  P.styleClear.onclick = () => {
    uploadedStyle = null;
    updateUploadedStyleUI();
  };
  document.addEventListener("click", (e) => {
    if (!quickPop.hidden && !wrap.querySelector(".cm-ai-quick-menu").contains(e.target)) quickPop.hidden = true;
  });
  wrap.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.onclick = () => { quickPop.hidden = true; runQuickAction(app, btn.getAttribute("data-quick")); };
  });
  P.send.onclick = () => handleSend(app);
  P.input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSend(app); }
  });

  addAIMsg("你好！描述你想做的卡片，或在画布里选好比例，直接发送主题开始生成。页数可以留给 AI，也可以写在提示词里。");
}

// 在主窗口 toolbar 注入新建与样式导出按钮，和编辑/放映/保存 HTML 保持同一层级。
function installStyleToolbar(app) {
  const bar = app.app.querySelector(".cm-toolbar");
  if (!bar) return;
  if (!bar.querySelector(".cm-new-deck")) {
    const btnNew = el("button", "cm-btn cm-new-deck", "新建");
    btnNew.title = "清空当前画布，开始一个新 deck";
    btnNew.onclick = () => clearStageForNewDeck(app);
    const anchor = app.btnEdit && app.btnEdit.parentNode === bar ? app.btnEdit : null;
    bar.insertBefore(btnNew, anchor);
  }
  if (!bar.querySelector(".cm-style-export")) {
    const btnExport = el("button", "cm-btn cm-style-export", "导出样式");
    btnExport.title = "导出当前全局样式";
    btnExport.onclick = () => exportCurrentStyle(app);
    const styleAnchor = app.btnSave && app.btnSave.parentNode === bar ? app.btnSave.nextSibling : null;
    bar.insertBefore(btnExport, styleAnchor);
  }
}

// 清空 stage，让下一条用户输入明确进入新生成流程；已上传的样式附件保留。
function clearStageForNewDeck(app) {
  if (activeJob) stopActiveJob();
  S = null;
  app.setHTML("");
  addAIMsg("画布已清空。现在输入主题会生成新的 deck。");
}

// ─── 消息操作 ─────────────────────────────────────────────────────────────────
function addUserMsg(text) {
  const d = el("div", "cm-msg cm-msg-user");
  d.innerHTML = '<div class="cm-msg-body">' + escapeHtml(text) + "</div>";
  P.msgs.appendChild(d); scrollMsgs();
  return d;
}

function addAIMsg(text, actions) {
  const d = el("div", "cm-msg cm-msg-ai");
  d.innerHTML = '<div class="cm-msg-body">' + (text ? escapeHtml(text) : "") + "</div>" +
    '<div class="cm-msg-actions"></div>';
  if (actions && actions.length) setMsgActions(d, actions);
  P.msgs.appendChild(d); scrollMsgs();
  return d;
}

// 流式 AI 消息：返回 { el, setText, setHtml, addActions, done }
function streamMsg() {
  const d = el("div", "cm-msg cm-msg-ai");
  d.innerHTML =
    '<div class="cm-msg-body"><span class="cm-ai-spin"></span> <span class="cm-msg-text"></span></div>' +
    '<div class="cm-msg-actions"></div>';
  P.msgs.appendChild(d); scrollMsgs();
  const spin = d.querySelector(".cm-ai-spin");
  const txt = d.querySelector(".cm-msg-text");
  return {
    el: d,
    setText(s) { txt.textContent = s; scrollMsgs(); },
    setHtml(h) { txt.innerHTML = h; scrollMsgs(); },
    done() { spin.remove(); },
    addActions(acts) { setMsgActions(d, acts); },
  };
}

function setMsgActions(msgEl, actions) {
  const row = msgEl.querySelector(".cm-msg-actions");
  row.innerHTML = "";
  actions.forEach((a) => {
    const b = el("button", "cm-btn" + (a.primary ? " cm-primary" : ""), a.label);
    b.onclick = a.onClick; row.appendChild(b);
  });
}

function scrollMsgs() { P.msgs.scrollTop = P.msgs.scrollHeight; }

function beginJob() {
  if (activeJob) activeJob.controller.abort();
  activeJob = { controller: new AbortController() };
  P.send.classList.add("is-stop");
  P.send.title = "停止生成";
  P.send.setAttribute("aria-label", "停止生成");
  return activeJob;
}

function endJob(job) {
  if (job && activeJob !== job) return;
  activeJob = null;
  P.send.classList.remove("is-stop");
  P.send.title = "发送";
  P.send.setAttribute("aria-label", "发送");
}

function cfgWithSignal(cfg, job) {
  return Object.assign({}, cfg, { signal: job.controller.signal });
}

function stopActiveJob() {
  if (!activeJob) return false;
  activeJob.controller.abort();
  endJob(activeJob);
  return true;
}

function isAbortError(e) {
  return e && (e.name === "AbortError" || /abort/i.test(String(e.message || e)));
}

// ─── 发送处理 ─────────────────────────────────────────────────────────────────
async function handleSend(app) {
  if (activeJob) { stopActiveJob(); return; }
  const text = P.input.value.trim();
  if (!text) return;
  const cfg = resolveCfg();
  if (!cfg) { addAIMsg("请先点击右上角 ⚙ 配置 API Key。"); openSettings(app); return; }
  P.input.value = "";
  addUserMsg(text);
  if (!app.cards.length && S && S.plan) {
    reviseDraftPlan(app, cfg, text);
    return;
  }
  let intent;
  try {
    intent = await runIntent(app, cfg, text);
  } catch (e) {
    return;
  }
  routeIntent(app, cfg, text, intent);
}

async function runIntent(app, cfg, text) {
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const m = streamMsg();
  m.setText("正在理解需求…");
  try {
    const intent = await classifyIntent(runCfg, fullDeckContext(app, { purpose: "intent" }), text);
    m.done();
    m.setHtml("已理解需求，开始处理。");
    endJob(job);
    if (!intent || intent.intent === "unknown") throw new Error("unknown intent");
    return intent;
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : "我没判断清楚你的意图。你是想新建一套、定向替换文字/组件、修改当前页、修改指定页、统一全套 UI/排版，还是增删/调整页面顺序？");
    endJob(job);
    throw e;
  }
}

function routeIntent(app, cfg, text, intent) {
  if (!app.cards.length && S && S.plan && intent.intent !== "generate_new") {
    reviseDraftPlan(app, cfg, text);
    return;
  }
  if (!app.cards.length || intent.intent === "generate_new") {
    runGenerate(app, cfg, text);
    return;
  }
  if (!ensureSessionFromDeck(app, cfg)) return runGenerate(app, cfg, text);
  if (intent.intent === "edit_structure") {
    runStructureEdit(app, cfg, text);
  } else if (intent.intent === "edit_global_style") {
    doStyleEdit(app, text);
  } else if (intent.intent === "edit_content") {
    runContentPatch(app, cfg, text, intent);
  } else if (intent.intent === "edit_page" || intent.intent === "edit_pages") {
    runEdit(app, cfg, text, intent);
  } else {
    addAIMsg("我没判断清楚你的意图。你是想新建一套、定向替换文字/组件、修改当前页、修改指定页、统一全套 UI/排版，还是增删/调整页面顺序？");
  }
}

// 执行快捷操作：跳过 intent 分类，直接进入对应的风格、结构或单页编辑 pipeline。
function runQuickAction(app, key) {
  if (activeJob) { stopActiveJob(); return; }
  const cfg = resolveCfg();
  const action = quickActionSpec(key);
  if (!action) return;
  if (!cfg) { addAIMsg("请先点击右上角 ⚙ 配置 API Key。"); openSettings(app); return; }
  addUserMsg(action.label);
  if (action.type === "style") {
    if (!ensureSessionFromDeck(app, cfg)) { addAIMsg("当前没有可调整的 deck。"); return; }
    doStyleEdit(app, action.prompt);
    return;
  }
  if (action.type === "structure") {
    if (!ensureSessionFromDeck(app, cfg)) { addAIMsg("当前没有可继续生成的 deck。"); return; }
    runStructureEdit(app, cfg, action.prompt);
    return;
  }
  if (action.type === "page") {
    if (!ensureSessionFromDeck(app, cfg)) { addAIMsg("当前没有可修改的页面。"); return; }
    const sourceIdx = sourcePageIdxFromViewIdx(app.index);
    runEdit(app, cfg, action.prompt, { intent: "edit_page", target_pages: [sourceIdx + 1], reference_page: null, allow_content_change: !!action.allowContentChange });
  }
}

// 快捷操作配置：按钮文案和实际发送给对应 pipeline 的精确任务说明。
function quickActionSpec(key) {
  const actions = {
    redesign: {
      type: "style",
      label: "整体配色和排版不好看，重新设计",
      prompt: "重新设计整套 deck 的全局视觉系统。保留现有内容与页面结构，重做配色、字体层级、内容块组件、header/footer、标题/副标题层级和整体排版节奏，让整套更统一、更好看。",
    },
    "add-content": {
      type: "structure",
      label: "增加页面继续生成内容",
      prompt: "在当前 deck 中增加一页新的内容页，继续展开主题，不生成封底。新增页需要与上下文衔接，role 使用 content 或 data。",
    },
    ending: {
      type: "structure",
      label: "生成封底",
      prompt: "在当前 deck 末尾增加一页封底，作为整套内容的收束页，role 使用 ending。",
    },
    overflow: {
      type: "page",
      label: "页面正文内容溢出容器/页面需重新排版",
      prompt: "页面正文内容溢出容器/页面需重新排版",
    },
    reflow: {
      type: "page",
      label: "页面正文内容排版不当，需重新排版",
      prompt: "页面正文内容排版不当，需重新排版",
    },
    expand: {
      type: "page",
      label: "页面正文内容太少，需补充",
      prompt: "页面正文内容太少，需补充",
      allowContentChange: true,
    },
  };
  return actions[key] || null;
}

function intentContext(app) {
  const cards = app.cards || [];
  return {
    has_deck: cards.length > 0,
    existing_deck_is_current_canvas: cards.length > 0,
    style_attachment: uploadedStyle ? {
      name: uploadedStyle.name,
      state: "attached_for_next_instruction",
      purpose: "conversation input style; use it as the visual style for the user's next deck task",
      current_canvas_note: "the existing canvas is background context and is not automatically the edit target",
    } : null,
    total_pages: cards.length,
    current_page: cards.length ? app.index + 1 : null,
    preset: app.preset,
    deck_title: app.title || "",
    pages: cards.map((card, i) => ({
      page: i + 1,
      role: card.getAttribute("data-role") || "",
      title: compactText((card.querySelector("h1,h2,.cm-display,.cm-title") || card).textContent).slice(0, 80),
      header: compactText((card.querySelector(".cm-header") || {}).textContent || "").slice(0, 120),
      footer: compactText((card.querySelector(".cm-footer") || {}).textContent || "").slice(0, 120),
    })),
  };
}

// 构造所有 LLM 调用共享的完整运行上下文，保证每种操作都知道同一份画布、style 和组件信息。
function fullDeckContext(app, opts) {
  const options = opts || {};
  const preset = (S && S.preset) || app.preset;
  const PSet = CardMaker.PRESETS[preset] || CardMaker.PRESETS[app.preset];
  const baseStyle = options.styleText || currentDesignStyle(app) || "";
  const styleContext = editStyleContext(app, baseStyle);
  const cards = app.cards || [];
  const runtimeCss = runtimeComponentCss();
  const context = {
    purpose: options.purpose || "general",
    canvas: {
      preset,
      label: PSet && PSet.label,
      width: PSet && PSet.w,
      height: PSet && PSet.h,
      unit: "px",
      fixed_image_canvas: true,
      overflow_behavior: "content outside the section height is clipped by the exported image canvas",
    },
    runtime_component_css: runtimeCss,
    deck_style: {
      source: styleContext.source,
      text: styleContext.text,
    },
    components: {
      classes: styleContext.classes,
      used_classes: Array.from(new Set(classesFromCurrentDeck(app))).sort(),
    },
    page_inline_style_capabilities: {
      allowed: true,
      purpose: "layout and text-density tuning on the current page",
      properties: allowedPageInlineStyleProps(),
    },
    layout_metrics: deckLayoutMetrics(app),
    deck: {
      has_deck: cards.length > 0,
      title: app.title || "",
      total_pages: editTotalPages(app),
      current_page: cards.length ? app.index + 1 : null,
      plan: S && S.plan ? {
        title: S.plan.title || "",
        scene: S.plan.scene || "",
        theme: S.plan.theme || "",
        font: S.plan.font || "",
        pages: S.plan.pages || [],
      } : null,
      pages: deckPageSummaries(app),
    },
    style_attachment: uploadedStyle ? {
      name: uploadedStyle.name,
      text: uploadedStyle.style,
    } : null,
  };
  logAIContext(context);
  return context;
}

// LLM 可用于单页排版密度微调的 inline style 属性；执行层会按同一组属性过滤。
function allowedPageInlineStyleProps() {
  return [
    "font-size", "line-height", "font-weight", "text-align",
    "display", "grid-template", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
    "flex", "flex-basis", "flex-direction", "flex-wrap", "align-items", "align-self", "justify-content",
    "gap", "row-gap", "column-gap",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  ];
}

// 从当前 deck 里提取每页摘要，作为所有操作的页面边界和组件位置上下文。
function deckPageSummaries(app) {
  const cards = app.cards || [];
  return cards.map((card, i) => ({
    page: i + 1,
    current: i === app.index,
    role: card.getAttribute("data-role") || "",
    theme: card.getAttribute("data-theme") || "",
    font: card.getAttribute("data-font") || "",
    classes: String(card.getAttribute("class") || "").split(/\s+/).filter(Boolean),
    header: compactText((card.querySelector(".cm-header") || {}).textContent || "").slice(0, 300),
    title: compactText((card.querySelector("h1,h2,.cm-display,.cm-title") || card).textContent || "").slice(0, 300),
    subtitle: compactText((card.querySelector(".cm-subtitle") || {}).textContent || "").slice(0, 300),
    footer: compactText((card.querySelector(".cm-footer") || {}).textContent || "").slice(0, 300),
    text: compactText(card.textContent || "").slice(0, 1200),
  }));
}

// 把当前真实 DOM 的盒模型和关键 computed style 传给模型，避免它只凭 CSS 猜页面边界。
function deckLayoutMetrics(app) {
  const cards = app.cards || [];
  return cards.map((card, i) => {
    const cardBox = elementMetrics(card, card);
    const main = card.querySelector(".cm-main");
    const header = card.querySelector(".cm-header");
    const footer = card.querySelector(".cm-footer");
    return {
      page: i + 1,
      current: i === app.index,
      card: cardBox,
      header: elementMetrics(header, card),
      main: elementMetrics(main, card),
      footer: elementMetrics(footer, card),
      available_content_area: {
        selector: ".cm-main",
        width: main ? Math.round(main.clientWidth || 0) : null,
        height: main ? Math.round(main.clientHeight || 0) : null,
        content_scroll_height: main ? Math.round(main.scrollHeight || 0) : null,
        content_fits: !!(main && main.scrollHeight && main.clientHeight && main.scrollHeight <= main.clientHeight + 1),
      },
      title: elementMetrics(card.querySelector("h1,h2,.cm-display,.cm-title"), card),
      subtitle: elementMetrics(card.querySelector(".cm-subtitle"), card),
      text_density: textDensityMetrics(card),
      components: Array.from(card.querySelectorAll(".cm-cell,.cm-grid,.cm-split,.cm-row,.cm-col,.cm-flow,.cm-feature-row,.cm-callout,.cm-band,.cm-mosaic,.cm-bento,.cm-compare,.cm-compare-col,.cm-process,.cm-step,.cm-insight,.cm-pullquote,.cm-metric-row,.cm-mini-card,.cm-stat,.cm-checklist,.cm-tag,.cm-chip"))
        .slice(0, 20)
        .map((node) => elementMetrics(node, card)),
      overflow: {
        card_scroll_height: Math.round(card.scrollHeight || 0),
        card_client_height: Math.round(card.clientHeight || 0),
        main_scroll_height: main ? Math.round(main.scrollHeight || 0) : null,
        main_client_height: main ? Math.round(main.clientHeight || 0) : null,
        card_overflows: !!(card.scrollHeight && card.clientHeight && card.scrollHeight > card.clientHeight + 1),
        main_overflows: !!(main && main.scrollHeight && main.clientHeight && main.scrollHeight > main.clientHeight + 1),
      },
    };
  });
}

// 汇总当前页正文元素的字号/行高，帮助模型判断是否需要缩小正文密度。
function textDensityMetrics(card) {
  if (!card || typeof getComputedStyle === "undefined") return null;
  const nodes = Array.from(card.querySelectorAll(".cm-main p,.cm-main li,.cm-main span,.cm-main h3,.cm-main .cm-cell,.cm-main .cm-feature-body,.cm-main .cm-mini-card"));
  const samples = nodes.slice(0, 40).map((node) => {
    const cs = getComputedStyle(node);
    return {
      selector: elementSelectorLabel(node),
      font_size_px: parseCssPx(cs.fontSize),
      line_height_px: parseCssPx(cs.lineHeight),
      text: compactText(node.textContent || "").slice(0, 120),
    };
  }).filter((item) => item.font_size_px);
  const sizes = samples.map((item) => item.font_size_px);
  const lines = samples.map((item) => item.line_height_px).filter(Boolean);
  return {
    sample_count: samples.length,
    min_font_size_px: sizes.length ? Math.min.apply(null, sizes) : null,
    max_font_size_px: sizes.length ? Math.max.apply(null, sizes) : null,
    avg_font_size_px: sizes.length ? round2(sizes.reduce((a, b) => a + b, 0) / sizes.length) : null,
    avg_line_height_px: lines.length ? round2(lines.reduce((a, b) => a + b, 0) / lines.length) : null,
    samples,
  };
}

function parseCssPx(value) {
  const n = parseFloat(String(value || ""));
  return Number.isFinite(n) ? round2(n) : null;
}

// 提取元素相对 card 的位置、尺寸和关键文字/布局 computed style。
function elementMetrics(node, card) {
  if (!node || !card || typeof getComputedStyle === "undefined") return null;
  const rect = node.getBoundingClientRect();
  const base = card.getBoundingClientRect();
  const cs = getComputedStyle(node);
  return {
    selector: elementSelectorLabel(node),
    class: node.getAttribute("class") || "",
    tag: node.tagName ? node.tagName.toLowerCase() : "",
    x: round2(rect.left - base.left),
    y: round2(rect.top - base.top),
    width: round2(rect.width),
    height: round2(rect.height),
    scroll_width: Math.round(node.scrollWidth || 0),
    scroll_height: Math.round(node.scrollHeight || 0),
    client_width: Math.round(node.clientWidth || 0),
    client_height: Math.round(node.clientHeight || 0),
    display: cs.display,
    position: cs.position,
    grid_template_columns: cs.gridTemplateColumns,
    flex_direction: cs.flexDirection,
    gap: cs.gap,
    padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" "),
    margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(" "),
    font_family: cs.fontFamily,
    font_size: cs.fontSize,
    font_weight: cs.fontWeight,
    line_height: cs.lineHeight,
    color: cs.color,
    background: cs.backgroundColor,
    text: compactText(node.textContent || "").slice(0, 240),
  };
}

function elementSelectorLabel(node) {
  if (!node) return "";
  if (node.classList && node.classList.length) return "." + Array.from(node.classList).join(".");
  return node.tagName ? node.tagName.toLowerCase() : "";
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 每次构造上下文都打印摘要，方便确认模型到底拿到了什么。
function logAIContext(context) {
  if (!context || typeof console === "undefined") return;
  console.info("[CardMaker AI] full context", {
    purpose: context.purpose,
    canvas: context.canvas,
    runtimeCssLength: String(context.runtime_component_css || "").length,
    deckStyleLength: String(context.deck_style && context.deck_style.text || "").length,
    classCount: context.components && context.components.classes ? context.components.classes.length : 0,
    pageCount: context.deck && context.deck.pages ? context.deck.pages.length : 0,
    currentLayout: (context.layout_metrics || []).find((p) => p.current) || null,
  });
}

// 从已加载的 cardmaker.css 中读取真实公共组件 CSS，只保留卡片画布和 cm 组件相关规则。
function runtimeComponentCss() {
  if (typeof document === "undefined" || !document.styleSheets) return "";
  const chunks = [];
  Array.prototype.forEach.call(document.styleSheets, (sheet) => {
    const href = sheet.href || "";
    if (href && href.indexOf("cardmaker.css") < 0) return;
    let rules;
    try { rules = sheet.cssRules; } catch (e) { rules = null; }
    if (!rules) return;
    Array.prototype.forEach.call(rules, (rule) => {
      const css = rule && rule.cssText ? String(rule.cssText) : "";
      if (isCardComponentRule(css)) chunks.push(css);
    });
  });
  return chunks.join("\n");
}

// 判断一条 CSSOM 规则是否属于卡片运行时、画布尺寸或公共组件定义。
function isCardComponentRule(css) {
  return /(\.cm-app\[data-preset=|\.cm-cards|\.card\b|\.cm-(header|main|footer|page|row|col|grid|split|between|items-center|center|middle|top|fill|text-center|muted|accent|sm|text|leading|compact|dense|pad|kicker|display|lead|tag|ghost|num|divider|titlebar|title|subtitle|cell|outline|flow|feature|callout|band|mosaic|bento|compare|process|step|insight|pullquote|metric|mini-card|span|stat|quote|bar|chip|checklist|mt|mb|gap|deco|watermark))/i.test(String(css || ""));
}

function newConversation(app) {
  S = null;
  uploadedStyle = null;
  updateUploadedStyleUI();
  addAIMsg("好的，开始新对话。描述你想做的卡片主题。");
}

// ─── 生成流程：大纲确认 → 封面+首个内容页确认 → 后续逐页确认 ─────────────────────
async function runGenerate(app, cfg, topic) {
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const preset = app.preset;
  const PSet = CardMaker.PRESETS[preset];

  S = { app, cfg: runCfg, preset, PSet, topic, plan: null, designStyle: "", sections: [], nextIdx: 0, aborted: false, sampleIdx: 0, sampleSection: "", uploadedStyle };

  // 第1步：构思内容
  const m1 = streamMsg();
  m1.setText("正在构思内容大纲…");
  try {
    S.plan = await makePlan(runCfg, preset, null, topic, fullDeckContext(app, { purpose: "plan" }));
  } catch (e) {
    m1.done();
    m1.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
    return;
  }
  m1.done();
  endJob(job);

  // 显示大纲
  const planHtml = formatPlan(S.plan);
  m1.setHtml(planHtml);
  setLastCfg(cfg);

  m1.addActions([
    { label: "重新构思", onClick: () => { S = null; addUserMsg("（重新构思）"); runGenerate(app, cfg, topic); } },
    { label: "开始", primary: true, onClick: () => runDesign(app) },
  ]);
}

// 大纲确认阶段的用户反馈：页面还没生成时，只修当前 plan，避免把“改成 5 页”等反馈当成新 deck。
async function reviseDraftPlan(app, cfg, feedback) {
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const m = streamMsg();
  m.setText("正在调整内容大纲…");
  try {
    S.plan = await revisePlanStructure(runCfg, S.plan, feedback, 1, fullDeckContext(app, { purpose: "structure" }));
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
    return;
  }
  m.done();
  endJob(job);
  m.setHtml(formatPlan(S.plan));
  m.addActions([
    { label: "重新构思", onClick: () => { const topic = S.topic; S = null; addUserMsg("（重新构思）"); runGenerate(app, cfg, topic); } },
    { label: "开始", primary: true, onClick: () => runDesign(app) },
  ]);
}

async function runDesign(app) {
  const job = beginJob();
  S.cfg = cfgWithSignal(S.cfg, job);
  S.aborted = false;
  const m = streamMsg();
  m.setText((S.uploadedStyle ? "正在套用上传样式" : "正在设计风格") + " + 排封面和第一个内容页，请稍候…");
  try {
    S.sampleIdx = pickSampleIdx(S.plan);
    if (S.uploadedStyle && S.uploadedStyle.style) {
      S.designStyle = S.uploadedStyle.style;
      m.setText("正在使用上传样式生成第一个内容页…");
    } else {
      const r = await makeDesignSample(S.cfg, S.preset, S.PSet, S.plan, S.plan.pages[S.sampleIdx],
        S.sampleIdx + 1, S.plan.pages.length, fullDeckContext(app, { purpose: "design" }),
        (txt, thinking) => { if (!thinking) m.setText("正在设计风格…"); });
      S.designStyle = r.style;
      S.sampleSection = r.section;
      if (S.sampleSection) S.sections[S.sampleIdx] = S.sampleSection;
    }
    if (!S.sections[S.sampleIdx]) {
      m.setText("正在生成第一个内容页…");
      S.sections[S.sampleIdx] = await renderPage(S.cfg, S.preset, S.PSet, S.plan, S.designStyle,
        S.plan.pages[S.sampleIdx], "", S.sampleIdx + 1, S.plan.pages.length, "", fullDeckContext(app, { purpose: "render", styleText: S.designStyle }));
    }

    const coverIdx = pickCoverIdx(S.plan);
    if (coverIdx !== S.sampleIdx && !S.sections[coverIdx]) {
      m.setText("正在生成封面…");
      S.sections[coverIdx] = await renderPage(S.cfg, S.preset, S.PSet, S.plan, S.designStyle,
        S.plan.pages[coverIdx], "", coverIdx + 1, S.plan.pages.length, confirmedLayoutReference(coverIdx), fullDeckContext(app, { purpose: "render", styleText: S.designStyle }));
    }

    S.nextIdx = findNextPageIdx();
    m.done();
    applySections(app);
    app.goTo(0);
    m.setHtml("封面和第一个内容页已就绪，请查看左侧画布。确认通过后再继续生成后续页面。");
    m.addActions([
      { label: "重做前两页", onClick: () => resetInitialPagesAndDesign(app) },
      ...renderProgressActions(S.plan.pages.length, null, m.el),
    ]);
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

// 重置首轮预览相关状态，避免旧样式或旧页面混入重新生成结果。
function resetInitialPagesAndDesign(app) {
  S.designStyle = "";
  S.sections = [];
  S.nextIdx = 0;
  S.sampleSection = "";
  addUserMsg("（重做封面和第一个内容页）");
  runDesign(app);
}

async function runRender(app) {
  const job = beginJob();
  S.cfg = cfgWithSignal(S.cfg, job);
  const total = S.plan.pages.length;
  S.nextIdx = findNextPageIdx();
  const m = streamMsg();

  if (S.nextIdx < 0) {
    m.done();
    m.setHtml(total + " / " + total + " 页已全部生成。可在输入框描述修改意见继续调整。");
    setMsgActions(m.el, []);
    endJob(job);
    return;
  }

  try {
    const i = S.nextIdx;
    m.setText("正在生成第 " + (i + 1) + " / " + total + " 页…");
    const prev = findPrevSection(i);
    const sec = await renderPage(S.cfg, S.preset, S.PSet, S.plan, S.designStyle, S.plan.pages[i], prev, i + 1, total, confirmedLayoutReference(i), fullDeckContext(app, { purpose: "render", styleText: S.designStyle }));
    S.sections[i] = sec;
    S.nextIdx = findNextPageIdx();
    applySections(app);
    app.goTo(S.sections.slice(0, i + 1).filter(Boolean).length - 1);
    m.done();
    const done = S.sections.filter(Boolean).length;
    m.setHtml("第 " + (i + 1) + " / " + total + " 页已生成，请确认左侧画布。当前进度：" + done + " / " + total + "。");
    setMsgActions(m.el, renderProgressActions(total, i, m.el));
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

// ─── 编辑流程 ─────────────────────────────────────────────────────────────────
async function runEdit(app, cfg, feedback, intent) {
  ensureSessionFromDeck(app, cfg);
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const currentSourceIdx = sourcePageIdxFromViewIdx(app.index);
  const targets = intentTargetSourceIdxs(intent, currentSourceIdx);
  const referenceIdx = intentReferenceSourceIdx(intent);
  const total = editTotalPages(app), preset = app.preset;
  const PSet = CardMaker.PRESETS[preset];
  const designStyle = currentDesignStyle(app);
  const styleContext = editStyleContext(app, designStyle);
  const fullContext = fullDeckContext(app, { purpose: "edit", styleText: styleContext.text });
  const m = streamMsg();
  try {
    const resolvedTargets = resolveEditTargets(app, targets);
    const patch = {};
    const changedTargets = [];
    for (let i = 0; i < resolvedTargets.length; i++) {
      const target = resolvedTargets[i];
      const sourceIdx = target.sourceIdx;
      const referenceHTML = referenceIdx >= 0 && referenceIdx !== sourceIdx
        ? namedReferenceHTML([{ idx: referenceIdx, html: S.sections[referenceIdx] || "" }])
        : confirmedLayoutReference(sourceIdx);
      m.setText("正在修改第 " + (sourceIdx + 1) + " / " + total + " 页…");
      console.info("[CardMaker AI] edit context", {
        preset,
        canvas: PSet,
        page: sourceIdx + 1,
        total,
        styleSource: styleContext.source,
        styleLength: styleContext.text.length,
        classCount: styleContext.classes.length,
        classes: styleContext.classes.slice(0, 80),
      });
      let sec = await editPage(runCfg, preset, PSet, styleContext.text, target.currentHTML, feedback, sourceIdx + 1, total, referenceHTML, fullContext);
      let textDiff = layoutTextDiff(intent, target.currentHTML, sec);
      if (textDiff) {
        console.warn("[CardMaker AI] layout edit changed visible text", { page: sourceIdx + 1, diff: textDiff });
        sec = await editPage(runCfg, preset, PSet, styleContext.text, target.currentHTML, feedback + "\n\n这是排版/布局修改，不能改写、增删或替换原页面可见文字。请只重组 DOM、class、字号、行高、间距、列数和布局，保留这些可见文字：\n" + originalVisibleText(target.currentHTML), sourceIdx + 1, total, referenceHTML, fullContext);
        textDiff = layoutTextDiff(intent, target.currentHTML, sec);
        if (textDiff) throw new Error("第 " + (sourceIdx + 1) + " 页排版修改改变了原文，已阻止应用。请改用定向内容修改来改文字。");
      }
      if (sameSection(sec, target.currentHTML)) {
        console.warn("[CardMaker AI] edit page returned no visible change", { page: sourceIdx + 1 });
        sec = await editPage(runCfg, preset, PSet, styleContext.text, target.currentHTML, feedback + "\n\n上一轮返回与原页面几乎相同。请重新执行原始修改需求，并确保返回的 <section> 与当前页不同。", sourceIdx + 1, total, referenceHTML, fullContext);
        textDiff = layoutTextDiff(intent, target.currentHTML, sec);
        if (textDiff) throw new Error("第 " + (sourceIdx + 1) + " 页排版修改改变了原文，已阻止应用。请改用定向内容修改来改文字。");
      }
      if (sameSection(sec, target.currentHTML)) throw new Error("第 " + (sourceIdx + 1) + " 页模型返回内容与原页面基本一致，未实际修改。");
      patch[target.viewIdx] = sec;
      S.sections[sourceIdx] = sec;
      changedTargets.push(sourceIdx);
    }
    if (!Object.keys(patch).length) throw new Error("没有找到可修改的目标页面。");
    app.patchDeck({ pages: patch });
    refreshSessionSectionsFromDeck(app);
    app.goTo(Math.max(0, viewIdxFromSourcePageIdx(changedTargets[0])));
    m.done(); m.setHtml(formatEditDone(changedTargets));
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

// ─── 结构编辑：增删页面 / 调整顺序 ───────────────────────────────────────────────
async function runStructureEdit(app, cfg, feedback) {
  ensureSessionFromDeck(app, cfg);
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const sourceIdx = sourcePageIdxFromViewIdx(app.index);
  const m = streamMsg();
  m.setText("正在调整页面结构…");
  try {
    const revised = await revisePlanStructure(runCfg, S.plan, feedback, sourceIdx + 1, fullDeckContext(app, { purpose: "structure" }));
    if (!revised.pages || !revised.pages.length) throw new Error("结构调整后没有页面。");
    revised.title = revised.title || S.plan.title;
    revised.scene = revised.scene || S.plan.scene;
    revised.theme = revised.theme || S.plan.theme;
    revised.font = revised.font || S.plan.font;
    const mapped = mapSectionsToRevisedPlan(revised, S.sections);
    S.plan = revised;
    S.sections = mapped.sections;
    S.nextIdx = findNextPageIdx();
    applySections(app);
    app.goTo(Math.min(mapped.focusIdx, Math.max(0, app.cards.length - 1)));
    m.done();
    const done = S.sections.filter(Boolean).length;
    const total = S.plan.pages.length;
    endJob(job);
    if (S.nextIdx >= 0) {
      m.setHtml("页面结构已调整。当前已生成 " + done + " / " + total + " 页，开始生成新增页面。");
      return runRender(app);
    }
    m.setHtml("页面结构已调整。当前已生成 " + done + " / " + total + " 页。");
    setMsgActions(m.el, renderProgressActions(total, sourceIdx, m.el));
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

// 触发整套风格修改
function promptStyleEdit(app) {
  addAIMsg("好的，请在输入框描述想要的风格调整（如：换成深色系、强调色改橙色、整体换宋体）。", []);
  P.input.focus();
  // 下一次发送强制走整套风格
  const origSend = P.send.onclick;
  P.send.onclick = () => {
    if (activeJob) { stopActiveJob(); return; }
    const text = P.input.value.trim();
    if (!text) return;
    P.input.value = "";
    P.send.onclick = origSend; // 恢复
    addUserMsg(text);
    doStyleEdit(app, text);
  };
}

async function doStyleEdit(app, feedback) {
  ensureSessionFromDeck(app, resolveCfg());
  const job = beginJob();
  const cfg = resolveCfg(); if (!cfg) { endJob(job); return; }
  const runCfg = cfgWithSignal(cfg, job);
  const preset = app.preset, PSet = CardMaker.PRESETS[preset];
  const curStyle = currentDesignStyle(app);
  if (!curStyle) { addAIMsg("当前 deck 没有可改的全局 <style>。"); endJob(job); return; }
  const m = streamMsg(); m.setText("正在修改整套风格…");
  try {
    const r = await editStyle(runCfg, preset, PSet, curStyle, feedback, deckReferenceHTML(), fullDeckContext(app, { purpose: "style", styleText: curStyle }));
    app.patchDeck({ style: r.style });
    cleanupInlineStylesCoveredByDeckStyle(app, r.style);
    app.setHTML(app.getHTML());
    if (r.font) app.setFont(r.font);
    if (S) S.designStyle = r.style;
    refreshSessionSectionsFromDeck(app);
    m.done(); m.setHtml("整套风格已更新，请查看画布。");
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

// 导出当前 deck 级 <style>，便于把好看的风格保存成可复用样式文件。
function exportCurrentStyle(app) {
  ensureSessionFromDeck(app, resolveCfg());
  const style = currentDesignStyle(app);
  if (!style) { addAIMsg("当前 deck 没有可导出的样式。"); return; }
  downloadText(style, styleFileName(app), "text/css;charset=utf-8");
  addAIMsg("当前全局样式已导出。");
}

function cleanupInlineStylesCoveredByDeckStyle(app, styleText) {
  const classProps = classStyleProps(styleText);
  if (!classProps.size || !app.cards) return 0;
  let changed = 0;
  app.cards.forEach((card) => {
    card.querySelectorAll("[style]").forEach((node) => {
      const covered = coveredInlineProps(node, classProps);
      if (!covered.length) return;
      covered.forEach((prop) => node.style.removeProperty(prop));
      if (!node.getAttribute("style")) node.removeAttribute("style");
      changed += covered.length;
    });
  });
  return changed;
}

function classStyleProps(styleText) {
  const out = new Map();
  String(styleText || "").replace(/\.([_a-zA-Z][\w-]*)[^{]*\{([^}]*)\}/g, (_, cls, body) => {
    const props = out.get(cls) || new Set();
    String(body || "").split(";").forEach((decl) => {
      const i = decl.indexOf(":");
      if (i > 0) props.add(decl.slice(0, i).trim().toLowerCase());
    });
    out.set(cls, props);
    return "";
  });
  return out;
}

function coveredInlineProps(node, classProps) {
  const out = [];
  const classes = Array.from(node.classList || []);
  if (!classes.length) return out;
  Array.from(node.style || []).forEach((prop) => {
    const lower = String(prop || "").toLowerCase();
    if (!isDeckStyleMigratableProp(lower)) return;
    if (classes.some((cls) => classProps.get(cls) && classProps.get(cls).has(lower))) out.push(lower);
  });
  return out;
}

function isDeckStyleMigratableProp(prop) {
  return /^(font-size|line-height|font-weight|text-align|display|grid-template|grid-template-columns|grid-template-rows|grid-column|grid-row|flex|flex-basis|flex-direction|flex-wrap|align-items|align-self|justify-content|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left)$/i.test(prop);
}

// 读取用户上传的样式文件，作为当前 conversation 的样式附件。
function importStyleFile(app, input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = "";
  if (!file) return;
  file.text().then((text) => {
    const style = styleFromUploadedText(text);
    if (!style) {
      updateUploadedStyleUI("上传失败：未识别到可用样式");
      addAIMsg("上传文件里没有识别到可用样式。支持 <style>…</style> 或纯 CSS。");
      return;
    }
    uploadedStyle = { name: file.name, style };
    updateUploadedStyleUI();
    addAIMsg("已上传样式「" + file.name + "」。后续生成新 deck 会优先使用这份样式。");
  }).catch((e) => {
    updateUploadedStyleUI("读取样式文件失败");
    addAIMsg("读取样式文件失败：" + String(e.message || e));
  });
}

// 从上传内容中提取 <style>，或把纯 CSS 包装成 deck 级 <style>。
function styleFromUploadedText(text) {
  const existing = extractStyle(text || "");
  if (existing) return existing;
  const css = String(text || "").trim();
  if (!css || /<\/?(html|body|section|div|script)\b/i.test(css)) return "";
  return "<style>\n" + css + "\n</style>";
}

// 刷新输入区附近的样式附件状态。
function updateUploadedStyleUI(errorText) {
  if (!P || !P.styleStatus || !P.styleText || !P.styleClear) return;
  if (errorText) {
    P.styleStatus.setAttribute("data-state", "error");
    P.styleStatus.hidden = false;
    P.styleText.textContent = errorText;
    P.styleClear.hidden = true;
    return;
  }
  if (!uploadedStyle) {
    P.styleStatus.setAttribute("data-state", "empty");
    P.styleStatus.hidden = true;
    P.styleText.textContent = "";
    P.styleClear.hidden = true;
    return;
  }
  P.styleStatus.hidden = false;
  P.styleStatus.setAttribute("data-state", "ready");
  P.styleText.textContent = "已附加样式：" + uploadedStyle.name;
  P.styleClear.hidden = false;
}

// 触发浏览器下载一段文本内容。
function downloadText(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// 生成样式文件名，和 deck 标题保持一致。
function styleFileName(app) {
  return slug(app.title || "cardmaker") + ".cardmaker-style.css";
}

// 把标题压成适合下载文件名的短 slug。
function slug(s) {
  return String(s || "cardmaker").trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "cardmaker";
}

// ─── 辅助 ─────────────────────────────────────────────────────────────────────
function applySections(app) {
  const html = (S.designStyle || "") + "\n" + S.sections.filter(Boolean).join("\n");
  app.setHTML(html);
  refreshSessionSectionsFromDeck(app);
  app.goTo(Math.max(0, S.sections.filter(Boolean).length - 1));
}

// 当前画布只渲染已生成页面，view index 需要映射回 plan/sections 的原始 page index。
function sourcePageIdxFromViewIdx(viewIdx) {
  if (!S || !S.sections || !S.sections.length) return viewIdx;
  const generated = [];
  S.sections.forEach((sec, i) => { if (sec) generated.push(i); });
  return generated[viewIdx] != null ? generated[viewIdx] : viewIdx;
}

function viewIdxFromSourcePageIdx(sourceIdx) {
  if (!S || !S.sections || !S.sections.length) return sourceIdx;
  let viewIdx = -1;
  for (let i = 0; i <= sourceIdx; i++) {
    if (S.sections[i]) viewIdx++;
  }
  return S.sections[sourceIdx] ? viewIdx : -1;
}

function editTotalPages(app) {
  return S && S.plan && S.plan.pages ? S.plan.pages.length : app.cards.length;
}

function intentTargetSourceIdxs(intent, currentSourceIdx) {
  const total = editTotalPages(S.app);
  const pages = intent && Array.isArray(intent.target_pages) ? intent.target_pages : [];
  const valid = pages.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= total);
  const uniq = Array.from(new Set(valid));
  return (uniq.length ? uniq : [currentSourceIdx + 1]).map((n) => n - 1);
}

function intentReferenceSourceIdx(intent) {
  const page = intent && intent.reference_page != null ? parseInt(intent.reference_page, 10) : 0;
  const idx = page - 1;
  return S && S.sections && S.sections[idx] ? idx : -1;
}

function resolveEditTargets(app, targets) {
  const missing = [];
  const resolved = targets.map((sourceIdx) => {
    let viewIdx = viewIdxFromSourcePageIdx(sourceIdx);
    let currentHTML = S && S.sections ? (S.sections[sourceIdx] || "") : "";
    if (!currentHTML && app.cards.length === editTotalPages(app) && app.cards[sourceIdx]) {
      currentHTML = app.cards[sourceIdx].outerHTML;
      S.sections[sourceIdx] = currentHTML;
      viewIdx = sourceIdx;
    }
    if (viewIdx < 0 || !currentHTML) {
      missing.push(sourceIdx + 1);
      return null;
    }
    return { sourceIdx, viewIdx, currentHTML };
  }).filter(Boolean);
  if (missing.length) {
    console.warn("[CardMaker AI] edit target page not found", { missing, targets: targets.map((i) => i + 1), sections: S && S.sections && S.sections.map(Boolean) });
    throw new Error("第 " + missing.join("、") + " 页还没有生成或无法定位，不能直接修改。请先生成这些页面，或明确要修改当前可见页面。");
  }
  return resolved;
}

function formatEditDone(targets) {
  const nums = targets.map((i) => i + 1).join("、");
  return "第 " + nums + " 页已修改，请查看画布。";
}

// ─── 定向内容/组件补丁：替换文字、改特定组件属性/class/局部 style ───────────────
async function runContentPatch(app, cfg, feedback, intent) {
  ensureSessionFromDeck(app, cfg);
  const job = beginJob();
  const runCfg = cfgWithSignal(cfg, job);
  const m = streamMsg();
  m.setText("正在生成定向内容补丁…");
  try {
    const context = contentPatchContext(app, intent);
    const patch = await makeContentPatch(runCfg, context, feedback);
    const result = applyContentPatch(app, patch, intent);
    if (!result.changed.length) throw new Error("补丁没有命中任何内容或组件。请明确页码、组件名或要替换的原文字。");
    app.patchDeck({ pages: result.pages });
    syncPatchedSections(result.pages);
    app.goTo(Math.max(0, result.changed[0].viewIdx));
    m.done();
    m.setHtml("已定向更新第 " + result.changed.map((p) => p.sourceIdx + 1).join("、") + " 页，共执行 " + result.count + " 处修改。");
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

function contentPatchContext(app, intent) {
  const currentSourceIdx = sourcePageIdxFromViewIdx(app.index);
  const targetIdxs = intentTargetSourceIdxs(intent, currentSourceIdx);
  const pages = resolveEditTargets(app, targetIdxs).map((target) => ({
    page: target.sourceIdx + 1,
    current: target.sourceIdx === currentSourceIdx,
    html: target.currentHTML,
    text: compactText(htmlText(target.currentHTML)).slice(0, 1600),
  }));
  return {
    full_context: fullDeckContext(app, { purpose: "content_patch" }),
    current_page: currentSourceIdx + 1,
    total_pages: editTotalPages(app),
    target_pages: targetIdxs.map((i) => i + 1),
    selector_hints: selectorHints(),
    pages,
  };
}

function selectorHints() {
  return [
    ".cm-header",
    ".cm-header span:first-child",
    ".cm-header span:last-child",
    ".cm-main",
    ".cm-footer",
    ".cm-footer span:first-child",
    ".cm-footer span:last-child",
    "h1,h2,.cm-title,.cm-display",
    ".cm-subtitle",
    ".cm-cell",
    ".cm-kicker",
  ];
}

function htmlText(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return doc.body.textContent || "";
}

function applyContentPatch(app, patch, intent) {
  const currentSourceIdx = sourcePageIdxFromViewIdx(app.index);
  const defaultTargets = intentTargetSourceIdxs(intent, currentSourceIdx);
  const total = editTotalPages(app);
  const pages = {};
  const changed = [];
  let count = 0;
  const touched = new Map();
  (patch.ops || []).forEach((op) => {
    const sourceIdxs = patchOpTargets(op, defaultTargets, total);
    sourceIdxs.forEach((sourceIdx) => {
      const target = getPatchTarget(app, sourceIdx, touched);
      if (!target) return;
      const before = target.card.outerHTML;
      count += applyPatchOp(target, op);
      if (target.card.outerHTML !== before) {
        pages[target.viewIdx] = target.card.outerHTML;
        if (!changed.some((p) => p.sourceIdx === sourceIdx)) changed.push({ sourceIdx, viewIdx: target.viewIdx });
      }
    });
  });
  return { pages, changed, count };
}

function patchOpTargets(op, fallback, total) {
  if (op.page === "all") return Array.from({ length: total }, (_, i) => i);
  const page = parseInt(op.page, 10);
  if (page >= 1 && page <= total) return [page - 1];
  return fallback && fallback.length ? fallback : [0];
}

function getPatchTarget(app, sourceIdx, touched) {
  if (touched.has(sourceIdx)) return touched.get(sourceIdx);
  let viewIdx = viewIdxFromSourcePageIdx(sourceIdx);
  let currentHTML = S && S.sections ? (S.sections[sourceIdx] || "") : "";
  if (!currentHTML && app.cards.length === editTotalPages(app) && app.cards[sourceIdx]) {
    currentHTML = app.cards[sourceIdx].outerHTML;
    viewIdx = sourceIdx;
  }
  if (viewIdx < 0 || !currentHTML) return null;
  const doc = new DOMParser().parseFromString(currentHTML, "text/html");
  const card = doc.body.querySelector("section.card");
  if (!card) return null;
  const liveCard = viewIdx >= 0 ? app.cards[viewIdx] : app.cards[sourceIdx];
  const target = { sourceIdx, viewIdx, card, liveCard };
  touched.set(sourceIdx, target);
  return target;
}

function applyPatchOp(target, op) {
  const card = target.card;
  const nodes = op.selector ? Array.from(card.querySelectorAll(op.selector)) : [card];
  let changed = 0;
  nodes.forEach((node) => {
    const before = node.outerHTML || node.textContent || "";
    if (op.op === "replace_text") replaceTextInNode(node, op);
    else if (op.op === "set_text") node.textContent = String(op.text || "");
    else if (op.op === "set_html") node.innerHTML = sanitizePatchHTML(op.html);
    else if (op.op === "remove") node.remove();
    else if (op.op === "set_attr") setSafeAttr(node, op.name, op.value);
    else if (op.op === "remove_attr") node.removeAttribute(String(op.name || ""));
    else if (op.op === "add_class") classListApply(node, op.class, true);
    else if (op.op === "remove_class") classListApply(node, op.class, false);
    else if (op.op === "set_style") mergeInlineStyle(node, op.style);
    const after = node.isConnected ? (node.outerHTML || node.textContent || "") : "";
    if (before !== after) changed++;
  });
  return changed;
}

function replaceTextInNode(root, op) {
  const from = String(op.from || "");
  const to = String(op.to || "");
  const mode = String(op.mode || "contains");
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach((node) => {
    const text = node.nodeValue || "";
    if (mode === "exact" && text.trim() === from) node.nodeValue = text.replace(from, to);
    else if (mode === "regex") {
      try { node.nodeValue = text.replace(new RegExp(from, "g"), to); } catch (e) { /* ignore bad regex */ }
    } else if (text.indexOf(from) !== -1) node.nodeValue = text.split(from).join(to);
  });
}

function sanitizePatchHTML(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.body.querySelectorAll("script,style,link,iframe,object,embed").forEach((n) => n.remove());
  return doc.body.innerHTML;
}

function setSafeAttr(node, name, value) {
  name = String(name || "").trim();
  if (!name || /^on/i.test(name) || /^(src|href)$/i.test(name)) return;
  if (name.toLowerCase() === "style") {
    const kept = sanitizePatchStyle(value);
    if (kept) node.setAttribute("style", kept);
    else node.removeAttribute("style");
    return;
  }
  node.setAttribute(name, String(value || ""));
}

function classListApply(node, classText, add) {
  String(classText || "").split(/\s+/).filter(Boolean).forEach((cls) => {
    if (add) node.classList.add(cls);
    else node.classList.remove(cls);
  });
}

// 合并定向补丁里的 inline style，只允许布局和文字排版密度属性落到 DOM。
function mergeInlineStyle(node, styleText) {
  sanitizePatchStyle(styleText).split(";").map((s) => s.trim()).filter(Boolean).forEach((decl) => {
    const i = decl.indexOf(":");
    if (i <= 0) return;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (prop) node.style.setProperty(prop, value);
  });
}

// 过滤补丁 style 声明，保持和 pipeline 的单页 HTML 清理规则一致。
function sanitizePatchStyle(styleText) {
  return String(styleText || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((decl) => {
      const i = decl.indexOf(":");
      if (i <= 0) return false;
      return /^(font-size|line-height|font-weight|text-align|display|grid-template|grid-template-columns|grid-template-rows|grid-column|grid-row|flex|flex-basis|flex-direction|flex-wrap|align-items|align-self|justify-content|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left)$/i.test(decl.slice(0, i).trim());
    })
    .join("; ");
}

function syncPatchedSections(pages) {
  if (!S || !S.sections) return;
  Object.keys(pages || {}).forEach((viewIdxText) => {
    const viewIdx = parseInt(viewIdxText, 10);
    const sourceIdx = sourcePageIdxFromViewIdx(viewIdx);
    if (sourceIdx >= 0) S.sections[sourceIdx] = pages[viewIdxText];
  });
}

function sameSection(a, b) {
  return sectionFingerprint(a) === sectionFingerprint(b);
}

function layoutTextDiff(intent, beforeHTML, afterHTML) {
  if (!mustPreserveVisibleText(intent)) return null;
  const before = visibleTextSignature(beforeHTML);
  const after = visibleTextSignature(afterHTML);
  if (before.signature === after.signature) return null;
  return {
    before: before.text.slice(0, 600),
    after: after.text.slice(0, 600),
  };
}

function mustPreserveVisibleText(intent) {
  return !!intent && !intent.allow_content_change && (intent.intent === "edit_page" || intent.intent === "edit_pages");
}

function originalVisibleText(html) {
  return visibleTextSignature(html).text;
}

function visibleTextSignature(html) {
  if (typeof DOMParser === "undefined") return { text: compactText(html), signature: compactText(html) };
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("style,script,link,iframe,object,embed,.cm-page").forEach((node) => node.remove());
  const text = compactText(doc.body.textContent || "");
  return {
    text,
    signature: text
      .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, "")
      .replace(/\s+/g, ""),
  };
}

function sectionFingerprint(html) {
  return compactText(String(html || "")
    .replace(/data-cm-active="[^"]*"/g, "")
    .replace(/\s(id|aria-[\w-]+)="[^"]*"/g, "")
    .replace(/>\s+</g, "><"));
}

function ensureSessionFromDeck(app, cfg) {
  if (!app.cards || !app.cards.length) return false;
  const html = app.getHTML();
  const parsed = parseDeckHTML(html);
  if (!parsed.sections.length) return false;
  if (S && S.plan) {
    syncSessionFromParsedDeck(parsed);
    S.app = app;
    S.cfg = cfg || S.cfg;
    S.preset = app.preset;
    S.PSet = CardMaker.PRESETS[app.preset];
    return true;
  }
  const PSet = CardMaker.PRESETS[app.preset];
  S = {
    app,
    cfg,
    preset: app.preset,
    PSet,
    topic: app.title || "deck",
    plan: {
      title: app.title || "deck",
      scene: "从当前已存在的 deck 恢复，用于继续补充和调整页面结构。",
      theme: inferTheme(parsed.sections),
      font: "",
      pages: parsed.sections.map(sectionToPageSpec),
    },
    designStyle: parsed.style,
    sections: parsed.sections,
    nextIdx: -1,
    aborted: false,
    sampleIdx: 0,
    sampleSection: "",
  };
  return true;
}

function refreshSessionSectionsFromDeck(app) {
  if (!S || !S.sections) return;
  const parsed = parseDeckHTML(app.getHTML());
  if (!parsed.sections.length) return;
  const generated = [];
  S.sections.forEach((section, i) => {
    if (section) generated.push(i);
  });
  parsed.sections.forEach((section, viewIdx) => {
    const sourceIdx = generated[viewIdx] != null ? generated[viewIdx] : viewIdx;
    S.sections[sourceIdx] = section;
  });
  if (parsed.style) S.designStyle = parsed.style;
}

function syncSessionFromParsedDeck(parsed) {
  if (parsed.style) S.designStyle = parsed.style;
  const generated = [];
  S.sections.forEach((sec, i) => { if (sec) generated.push(i); });
  parsed.sections.forEach((sec, viewIdx) => {
    const sourceIdx = generated[viewIdx] != null ? generated[viewIdx] : viewIdx;
    S.sections[sourceIdx] = sec;
  });
}

function parseDeckHTML(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const style = Array.from(doc.body.querySelectorAll("style")).map((n) => n.outerHTML).join("\n");
  const sections = Array.from(doc.body.querySelectorAll("section.card")).map((n) => n.outerHTML);
  return { style, sections };
}

function sectionToPageSpec(sectionHTML, idx) {
  const doc = new DOMParser().parseFromString(sectionHTML || "", "text/html");
  const card = doc.body.querySelector("section");
  const role = card && card.getAttribute("data-role") || (idx === 0 ? "cover" : "content");
  const titleEl = card && (card.querySelector("h1,h2,.cm-display,.cm-title") || card.querySelector(".cm-main"));
  const title = compactText(titleEl ? titleEl.textContent : "") || "第 " + (idx + 1) + " 页";
  const content = Array.from(card ? card.querySelectorAll("p,li,.cm-cell,.cm-stat-label") : [])
    .map((n) => compactText(n.textContent))
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => ({ heading: "", text }));
  return { role, title, subtitle: "", content };
}

function inferTheme(sections) {
  for (let i = 0; i < sections.length; i++) {
    const doc = new DOMParser().parseFromString(sections[i] || "", "text/html");
    const card = doc.body.querySelector("section");
    const theme = card && card.getAttribute("data-theme");
    if (theme) return theme;
  }
  return "";
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mapSectionsToRevisedPlan(revised, oldSections) {
  const total = revised.pages.length;
  const sections = revised.pages.map((pg, i) => {
    const id = String(pg.id || "");
    const m = id.match(/^p(\d+)$/i);
    const oldIdx = m ? parseInt(m[1], 10) - 1 : -1;
    const sec = oldIdx >= 0 ? oldSections[oldIdx] : "";
    return sec ? normalizeSectionPageNumber(sec, i + 1, total) : "";
  });
  return { sections, focusIdx: Math.max(0, sections.findIndex(Boolean)) };
}

function normalizeSectionPageNumber(section, pageNum, total) {
  if (!section || typeof DOMParser === "undefined") return section;
  const wanted = String(pageNum).padStart(2, "0") + "/" + String(total).padStart(2, "0");
  const doc = new DOMParser().parseFromString(section, "text/html");
  const card = doc.body.querySelector("section");
  if (!card) return section;
  const targets = card.querySelectorAll(".cm-footer span, .cm-footer, .cm-page, [class*=\"page\"], [class*=\"Page\"]");
  targets.forEach((node) => {
    const text = (node.textContent || "").trim();
    if (/^\d{1,2}\s*\/\s*\d{1,2}$/.test(text)) node.textContent = wanted;
  });
  return card.outerHTML;
}

// 找到下一个尚未生成的原始页序号，用于把批量生成拆成逐页确认。
function findNextPageIdx() {
  if (!S || !S.plan || !S.plan.pages) return -1;
  return S.plan.pages.findIndex((_, i) => !S.sections[i]);
}

// 取当前页之前最近一张已生成页面，给模型做视觉承接参考。
function findPrevSection(idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (S.sections[i]) return S.sections[i];
  }
  return "";
}

function confirmedLayoutReference(excludeIdx) {
  if (!S || !S.sections) return "";
  const refs = [];
  const coverIdx = S.plan ? pickCoverIdx(S.plan) : 0;
  const sampleIdx = S.sampleIdx != null ? S.sampleIdx : pickSampleIdx(S.plan || { pages: [] });
  [coverIdx, sampleIdx].forEach((idx) => {
    if (idx !== excludeIdx && S.sections[idx] && !refs.some((r) => r.html === S.sections[idx])) refs.push({ idx, html: S.sections[idx] });
  });
  if (!refs.length) {
    S.sections.some((sec, idx) => {
      if (idx !== excludeIdx && sec) refs.push({ idx, html: sec });
      return refs.length >= 2;
    });
  }
  return namedReferenceHTML(refs.slice(0, 2));
}

function namedReferenceHTML(refs) {
  return (refs || [])
    .filter((ref) => ref && ref.html)
    .map((ref) => "参考页：第 " + (ref.idx + 1) + " 页\n" + ref.html)
    .join("\n\n")
    .slice(0, 12000);
}

function deckReferenceHTML() {
  if (!S || !S.sections) return "";
  return S.sections
    .filter(Boolean)
    .slice(0, 4)
    .map((sec, i) => "页面样例 " + (i + 1) + "：\n" + sec)
    .join("\n\n")
    .slice(0, 18000);
}

// 优先使用大纲里的 cover 页；模型偶发漏标时退回第一页。
function pickCoverIdx(plan) {
  const ps = plan.pages || [];
  const i = ps.findIndex((p) => p.role === "cover");
  return i >= 0 ? i : 0;
}

// 第一个内容页用来定正式样式，避免只看封面看不出版式密度。
function pickSampleIdx(plan) {
  const ps = plan.pages || [];
  let i = ps.findIndex((p) => p.role === "content" || p.role === "data");
  return i >= 0 ? i : (ps.length > 1 ? 1 : 0);
}

// 生成下一页的确认动作：点击后立刻清空当前消息按钮，避免重复触发同一页生成。
function nextPageAction(msgEl) {
  return {
    label: "确认，生成下一页",
    primary: true,
    onClick: () => {
      if (msgEl) setMsgActions(msgEl, []);
      runRender(S.app);
    },
  };
}

// 根据当前进度生成操作按钮：生成过程中只允许重做当前页或继续下一页，不在这里改整套风格。
function renderProgressActions(total, sourceIdx, msgEl) {
  const actions = [];
  const idx = sourceIdx == null ? sourcePageIdxFromViewIdx(S.app.index) : sourceIdx;
  if (idx >= 0 && idx < total && S.sections[idx]) {
    actions.push({
      label: "重新生成本页",
      onClick: () => {
        if (msgEl) setMsgActions(msgEl, []);
        regeneratePage(S.app, idx);
      },
    });
  }
  if (findNextPageIdx() >= 0) actions.push(nextPageAction(msgEl));
  return actions;
}

// 使用既有 plan/designStyle 重新渲染某一页，适合生成过程中当前页不满意时快速重做。
async function regeneratePage(app, sourceIdx) {
  if (!S || !S.plan || !S.sections[sourceIdx]) return;
  const job = beginJob();
  S.cfg = cfgWithSignal(S.cfg, job);
  const total = S.plan.pages.length;
  const m = streamMsg();
  try {
    m.setText("正在重新生成第 " + (sourceIdx + 1) + " / " + total + " 页…");
    const prev = findPrevSection(sourceIdx);
    const sec = await renderPage(S.cfg, S.preset, S.PSet, S.plan, S.designStyle,
      S.plan.pages[sourceIdx], prev, sourceIdx + 1, total, confirmedLayoutReference(sourceIdx), fullDeckContext(app, { purpose: "render", styleText: S.designStyle }));
    S.sections[sourceIdx] = sec;
    applySections(app);
    app.goTo(Math.max(0, viewIdxFromSourcePageIdx(sourceIdx)));
    m.done();
    m.setHtml("第 " + (sourceIdx + 1) + " / " + total + " 页已重新生成，请确认左侧画布。");
    setMsgActions(m.el, renderProgressActions(total, sourceIdx, m.el));
    endJob(job);
  } catch (e) {
    m.done();
    m.setHtml(isAbortError(e) ? "已停止。" : '<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>");
    endJob(job);
  }
}

function extractStyleFromDeck(app) {
  return extractStyle(app.getHTML());
}

// 获取可被导出或继续编辑的全局样式；没有显式 <style> 时，从当前渲染效果生成一份快照。
function currentDesignStyle(app) {
  return extractStyleFromDeck(app) || (S && S.designStyle) || styleSnapshotFromDeck(app);
}

function editStyleContext(app, style) {
  const deckStyle = style || "";
  const classes = Array.from(new Set(
    classNamesFromText(deckStyle)
      .concat(builtinComponentClasses())
      .concat(classesFromCurrentDeck(app))
  )).sort();
  const builtin = "<!-- CardMaker builtin public classes available from cardmaker.css -->\n" +
    classes.map((cls) => "." + cls).join(" ");
  return {
    source: deckStyle.indexOf("CardMaker style snapshot") >= 0 ? "snapshot+builtin" : "deck-style+builtin",
    text: [deckStyle || "<style></style>", builtin].join("\n\n"),
    classes,
  };
}

function classNamesFromText(text) {
  const out = [];
  String(text || "").replace(/\.([_a-zA-Z][\w-]*)/g, (_, cls) => {
    out.push(cls);
    return "";
  });
  return out;
}

function classesFromCurrentDeck(app) {
  const out = [];
  (app.cards || []).forEach((card) => {
    card.querySelectorAll("[class]").forEach((node) => {
      String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean).forEach((cls) => out.push(cls));
    });
  });
  return out;
}

function builtinComponentClasses() {
  return [
    "card", "cm-header", "cm-main", "cm-footer", "cm-page",
    "cm-row", "cm-col", "cm-grid", "cm-grid-3", "cm-split", "cm-split-13", "cm-split-31",
    "cm-between", "cm-items-center", "cm-center", "cm-middle", "cm-top", "cm-fill", "cm-text-center",
    "cm-mt", "cm-mt-lg", "cm-mb", "cm-gap-lg", "cm-gap-sm", "cm-gap-xs", "cm-pad-sm", "cm-pad-xs",
    "cm-cell", "cm-outline", "cm-flow", "cm-feature-row", "cm-feature-label", "cm-feature-body",
    "cm-callout", "cm-band", "cm-mosaic", "cm-bento", "cm-span-2", "cm-compare", "cm-compare-col",
    "cm-process", "cm-step", "cm-step-num", "cm-insight", "cm-insight-mark", "cm-pullquote", "cm-metric-row", "cm-mini-card",
    "cm-stat", "cm-stat-num", "cm-stat-label",
    "cm-checklist", "cm-chip", "cm-tag", "cm-ghost", "cm-kicker", "cm-title", "cm-subtitle",
    "cm-titlebar", "cm-lead", "cm-display", "cm-muted", "cm-accent", "cm-sm",
    "cm-text-xs", "cm-text-sm", "cm-text-md", "cm-text-lg", "cm-leading-tight", "cm-leading-normal", "cm-leading-loose", "cm-compact", "cm-dense",
    "cm-bar", "cm-divider",
  ];
}

// 从当前卡片的计算样式生成可复用的 deck 级 <style>，覆盖内置样式但不依赖单页私有样式。
function styleSnapshotFromDeck(app) {
  const card = (app.cards && (app.cards[app.index] || app.cards[0])) || null;
  if (!card || typeof getComputedStyle === "undefined") return "";
  const cardCS = getComputedStyle(card);
  const headerCS = computedOf(card, ".cm-header") || cardCS;
  const footerCS = computedOf(card, ".cm-footer") || cardCS;
  const titleCS = computedOf(card, "h1,h2,.cm-title,.cm-display") || cardCS;
  const textCS = computedOf(card, "p,li,.cm-lead") || cardCS;
  const css = [
    "/* CardMaker style snapshot: exported from the current rendered deck. */",
    ":root {",
    cssVar("--cm-card-bg", cssBackground(cardCS)),
    cssVar("--cm-bg", cardCS.backgroundColor),
    cssVar("--cm-fg", cardCS.color),
    cssVar("--cm-muted", footerCS.color || headerCS.color),
    cssVar("--cm-line", borderColor(footerCS) || borderColor(headerCS) || "rgba(0,0,0,.16)"),
    cssVar("--cm-h1", titleCS.fontSize),
    cssVar("--cm-h2", titleCS.fontSize),
    cssVar("--cm-h3", textCS.fontSize),
    cssVar("--cm-text", textCS.fontSize),
    "}",
    ".card {",
    "  background: var(--cm-card-bg);",
    "  color: var(--cm-fg);",
    "  font-family: " + cardCS.fontFamily + ";",
    "}",
    ".cm-header, .cm-footer {",
    "  color: var(--cm-muted);",
    "  font-size: " + headerCS.fontSize + ";",
    "  letter-spacing: " + headerCS.letterSpacing + ";",
    "}",
    ".cm-footer { border-top: 1px solid var(--cm-line); }",
    "h1, h2, .cm-title, .cm-display {",
    "  color: " + titleCS.color + ";",
    "  font-family: " + titleCS.fontFamily + ";",
    "  font-weight: " + titleCS.fontWeight + ";",
    "  line-height: " + titleCS.lineHeight + ";",
    "}",
    "p, li, .cm-lead {",
    "  color: " + textCS.color + ";",
    "  font-family: " + textCS.fontFamily + ";",
    "  font-size: var(--cm-text);",
    "  line-height: " + textCS.lineHeight + ";",
    "}",
  ].filter(Boolean).join("\n");
  return "<style>\n" + css + "\n</style>";
}

function computedOf(root, selector) {
  const node = root.querySelector(selector);
  return node ? getComputedStyle(node) : null;
}

function cssBackground(cs) {
  const image = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : "";
  return image ? image + ", " + cs.backgroundColor : cs.backgroundColor;
}

function cssVar(name, value) {
  return value ? "  " + name + ": " + value + ";" : "";
}

function borderColor(cs) {
  return cs && cs.borderTopColor && cs.borderTopStyle !== "none" ? cs.borderTopColor : "";
}

function formatPlan(plan) {
  const pages = (plan.pages || []).map((pg, i) => {
    const items = (pg.content || []).map((c) =>
      "<li>" + escapeHtml((c.heading ? c.heading + "：" : "") + (c.text || "")) + "</li>"
    ).join("");
    return '<div class="cm-plan-pg"><span class="cm-plan-n">' + (i + 1) + "</span><div>" +
      '<div class="cm-plan-t">' + escapeHtml(pg.title || pg.role) + "</div>" +
      (pg.subtitle ? '<div class="cm-plan-sub">' + escapeHtml(pg.subtitle) + "</div>" : "") +
      (items ? "<ul>" + items + "</ul>" : "") +
      "</div></div>";
  }).join("");
  return '<div class="cm-plan"><div class="cm-plan-h">《' + escapeHtml(plan.title || "") + "》 · " +
    escapeHtml(plan.scene || "") + "</div>" + pages + "</div>";
}

// ─── API 设置弹窗 ─────────────────────────────────────────────────────────────
let settingsMask = null;
function openSettings(app) {
  if (settingsMask) { settingsMask.classList.add("is-open"); return; }
  const providers = listProviders();
  const provOpts = Object.keys(providers).map((k) =>
    '<option value="' + k + '">' + providers[k].label + "</option>").join("");
  const mask = el("div", "cmai-mask");
  mask.innerHTML =
    '<div class="cmai">' +
    '<header><h3>API 设置</h3><button class="cmai-x" data-close>×</button></header>' +
    '<div class="cmai-body">' +
    '<div><label>服务商</label><select data-provider>' + provOpts + '</select><div data-modelinfo style="font-size:12px;color:#9aa0ad;margin-top:5px"></div></div>' +
    '<div><label>API Key</label><input data-key type="password" placeholder="填入 API Key" /></div>' +
    '<label class="cmai-check"><input type="checkbox" data-remember /> 记住（仅存本地浏览器）</label>' +
    "</div>" +
    '<footer><div class="cmai-status" data-status></div>' +
    '<button class="cm-btn" data-close>取消</button>' +
    '<button class="cm-btn cm-primary" data-save>保存</button>' +
    "</footer></div>";
  document.body.appendChild(mask);
  settingsMask = mask;
  const $ = (s) => mask.querySelector(s);
  const saved = loadSaved();
  $("[data-provider]").value = saved.provider || defaultProvider();
  $("[data-remember]").checked = saved.remember;
  $("[data-key]").value = saved.key;
  const updateInfo = () => { const p = providers[$("[data-provider]").value]; $("[data-modelinfo]").textContent = p ? "模型：" + p.model : ""; };
  $("[data-provider]").onchange = updateInfo; updateInfo();
  mask.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => mask.classList.remove("is-open"); });
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.classList.remove("is-open"); });
  $("[data-save]").onclick = () => {
    const provider = $("[data-provider]").value;
    const key = $("[data-key]").value.trim();
    const remember = $("[data-remember]").checked;
    if (!key) { $("[data-status]").textContent = "请填写 API Key"; return; }
    const prov = providers[provider];
    if (!prov) { $("[data-status]").textContent = "无效服务商"; return; }
    saveCfg(provider, key, remember);
    setLastCfg({ base: prov.base, model: prov.model, key });
    mask.classList.remove("is-open");
    $("[data-status]").textContent = "";
  };
  mask.classList.add("is-open");
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ─── 样式注入 ─────────────────────────────────────────────────────────────────
let _styled = false;
function injectStyles() {
  if (_styled) return; _styled = true;
  const css =
    // ── 右侧 AI 面板 ──
    ".cm-ai-panel{flex:none;width:320px;display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,.08);background:#0e0f13;font-family:var(--cm-font-sans,system-ui);color:#e9e9ee;overflow:hidden}" +
    ".cm-ai-head{flex:none;display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07)}" +
    ".cm-ai-brand{font-weight:600;font-size:14px;flex:1}" +
    ".cm-ai-head .cm-btn{padding:5px 8px;font-size:12px}" +
    ".cm-ai-msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}" +
    // ── 消息气泡 ──
    ".cm-msg{display:flex;flex-direction:column;gap:6px;max-width:100%}" +
    ".cm-msg-body{font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}" +
    ".cm-msg-user .cm-msg-body{background:var(--cm-accent,#6d6df0);color:#fff;border-radius:12px 12px 4px 12px;padding:9px 12px;align-self:flex-end;max-width:90%}" +
    ".cm-msg-user{align-items:flex-end}" +
    ".cm-msg-ai .cm-msg-body{color:#d4d9e8}" +
    ".cm-msg-actions{display:flex;flex-wrap:wrap;gap:6px}" +
    ".cm-msg-actions .cm-btn{font-size:12px;padding:5px 11px}" +
    ".cm-err{color:#f87171}" +
    // ── 进度 spinner ──
    ".cm-ai-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.15);border-top-color:var(--cm-accent,#8b8bf5);animation:cmai-rot .7s linear infinite;vertical-align:middle}" +
    "@keyframes cmai-rot{to{transform:rotate(360deg)}}" +
    // ── 大纲格式 ──
    ".cm-plan{font-size:12px}" +
    ".cm-plan-h{color:#8a90a0;margin-bottom:8px;font-size:12px}" +
    ".cm-plan-pg{display:flex;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}" +
    ".cm-plan-n{flex:none;width:20px;height:20px;border-radius:6px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:11px;color:#9aa0ad;margin-top:2px}" +
    ".cm-plan-t{font-size:13px;color:#e9e9ee;font-weight:500}" +
    ".cm-plan-sub{color:#8a90a0;margin-top:2px}" +
    ".cm-plan ul{margin:4px 0 0 14px;padding:0;color:#8a90a0}" +
    ".cm-plan li{margin-bottom:2px}" +
    // ── 底部输入区 ──
    ".cm-ai-foot{flex:none;padding:10px 14px;border-top:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;gap:8px}" +
    ".cm-ai-quick-menu{position:relative;display:flex;align-items:center;justify-content:flex-start;gap:6px;flex-wrap:wrap}" +
    ".cm-ai-quick-trigger{font-size:12px;padding:5px 10px;color:#d4d9e8;background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.1)}" +
    ".cm-ai-style-attach{font-size:12px;padding:5px 10px;color:#d4d9e8;background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.1)}" +
    ".cm-ai-style-status{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);font-size:12px;line-height:1.25;color:#8f96a6}" +
    ".cm-ai-style-status[hidden]{display:none}" +
    ".cm-ai-style-status[data-state='ready']{color:#a7f3d0;background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.24)}" +
    ".cm-ai-style-status[data-state='error']{color:#fecaca;background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.24)}" +
    ".cm-ai-style-dot{width:6px;height:6px;border-radius:50%;background:#6b7280;flex:none}" +
    ".cm-ai-style-status[data-state='ready'] .cm-ai-style-dot{background:#10b981}" +
    ".cm-ai-style-status[data-state='error'] .cm-ai-style-dot{background:#ef4444}" +
    ".cm-ai-style-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".cm-ai-style-clear{flex:none;background:transparent;border:0;color:inherit;font:inherit;font-size:12px;padding:0 1px;cursor:pointer;opacity:.82}" +
    ".cm-ai-style-clear:hover{opacity:1;text-decoration:underline}" +
    ".cm-ai-quick-pop{position:absolute;left:0;bottom:34px;z-index:5;width:260px;display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#16181d;border:1px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 18px 45px rgba(0,0,0,.38)}" +
    ".cm-ai-quick-pop[hidden]{display:none}" +
    ".cm-ai-quick-pop .cm-btn{font-size:12px;padding:5px 9px;color:#d4d9e8;background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1);white-space:normal;text-align:left}" +
    ".cm-ai-input-wrap{position:relative}" +
    ".cm-ai-input{display:block;width:100%;box-sizing:border-box;background:#0a0b0e;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 48px 12px 11px;font:inherit;font-size:13px;line-height:1.5;resize:none;outline:none;min-height:72px}" +
    ".cm-ai-input:focus{border-color:var(--cm-accent,#6d6df0)}" +
    ".cm-ai-send{position:absolute;right:10px;bottom:10px;width:30px;height:30px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.26);transition:transform .14s ease,filter .14s ease,background .14s ease}" +
    ".cm-ai-send:hover{transform:translateY(-1px);filter:brightness(1.08)}" +
    ".cm-ai-send:active{transform:translateY(0) scale(.96)}" +
    ".cm-ai-send::before{content:\"\";width:0;height:0;border-left:9px solid #fff;border-top:6px solid transparent;border-bottom:6px solid transparent;transform:translateX(1px)}" +
    ".cm-ai-send.is-stop{background:#ef4444;color:#fff}" +
    ".cm-ai-send.is-stop::before{width:10px;height:10px;border:0;border-radius:2px;background:#fff;transform:none}" +
    // ── 设置弹窗（复用 cmai 样式） ──
    ".cmai-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:200;display:none;align-items:center;justify-content:center}" +
    ".cmai-mask.is-open{display:flex}" +
    ".cmai{width:min(500px,90vw);max-height:88vh;overflow:auto;background:#16181d;color:#e9e9ee;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.5);font-family:var(--cm-font-sans,system-ui)}" +
    ".cmai header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08)}" +
    ".cmai header h3{margin:0;font-size:16px}" +
    ".cmai .cmai-x{background:none;border:none;color:#9aa0ad;font-size:22px;cursor:pointer;line-height:1}" +
    ".cmai .cmai-body{padding:18px 22px;display:flex;flex-direction:column;gap:14px}" +
    ".cmai label{display:block;font-size:13px;color:#9aa0ad;margin-bottom:6px}" +
    ".cmai input,.cmai select{width:100%;box-sizing:border-box;background:#0d0f13;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;outline:none}" +
    ".cmai input:focus,.cmai select:focus{border-color:var(--cm-accent,#6d6df0)}" +
    ".cmai .cmai-check{display:flex;align-items:center;gap:8px;color:#9aa0ad;font-size:13px}" +
    ".cmai .cmai-check input{width:auto}" +
    ".cmai footer{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid rgba(255,255,255,.08)}" +
    ".cmai .cmai-status{flex:1;font-size:13px;color:#f87171}" +
    // 滚动条
    ".cm-ai-msgs,.cm-ai-panel{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}";
  const st = el("style"); st.textContent = css; document.head.appendChild(st);
}
