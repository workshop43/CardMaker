/* =============================================================
   分步生成编排：把 prompts + callModel 组合成 4 个异步原语。
   控制流（确认大纲 / 逐页推进 / 打断 / 续生成）由 ui.js 的状态机驱动，
   这里保持无状态，只负责「一次 LLM 往返完成一个子任务」。
   ============================================================= */
import { callModel, extractSection, extractStyle } from "./model.js";
import { intentPrompt, planPrompt, designPrompt, renderPrompt, editPrompt, contentPatchPrompt, structurePrompt, stylePrompt } from "./prompts.js";

// 把 callModel 的「先思考(reasoning) 后正文(content)」两路流，归一成一个 onStream(text, isReasoning)。
// 第二个参数标记这段是【思考】还是【正文】——思考绝不能渲染进卡片预览（推理模型常在思考里
// 草拟带 <section> 的半成品 + 大段计划文字，渲染出来就是一卡片乱码）。调用方据此分流。
function adapt(onStream) {
  let contentStarted = false;
  return [
    function onDelta(full) { contentStarted = true; if (onStream) onStream(full, false); },
    function onThink(r) { if (!contentStarted && onStream) onStream(r, true); },
  ];
}

// 1) 大纲：返回解析后的 plan 对象 {title,vibe,theme,font,pages:[{role,title,points}]}
export async function makePlan(cfg, preset, pages, topic, context, onStream) {
  const { sys, user } = planPrompt(preset, pages, topic, context);
  const [onDelta, onThink] = adapt(onStream);
  const text = await callModel(cfg, sys, user, onDelta, onThink);
  return parsePlan(text);
}

function parsePlan(text) {
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1); // 容错：截首尾花括号
  let plan;
  try { plan = JSON.parse(s); } catch (e) { throw new Error("大纲解析失败（模型未返回合法 JSON），请重试。"); }
  if (!plan.pages || !plan.pages.length) throw new Error("大纲里没有页面，请重试。");
  return plan;
}

export async function classifyIntent(cfg, context, text, onStream) {
  const { sys, user } = intentPrompt(context, text);
  const [onDelta, onThink] = adapt(onStream);
  const raw = await callModel(cfg, sys, user, onDelta, onThink);
  return parseIntent(raw);
}

function parseIntent(text) {
  let s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  let intent;
  try { intent = JSON.parse(s); } catch (e) { throw new Error("意图解析失败（模型未返回合法 JSON）。"); }
  if (!intent || !intent.intent) throw new Error("意图解析失败（缺少 intent）。");
  intent.target_pages = Array.isArray(intent.target_pages) ? intent.target_pages.map((n) => parseInt(n, 10)).filter(Boolean) : [];
  intent.reference_page = intent.reference_page == null ? null : parseInt(intent.reference_page, 10);
  return intent;
}

export async function makeContentPatch(cfg, context, feedback, onStream) {
  const { sys, user } = contentPatchPrompt(context, feedback);
  const [onDelta, onThink] = adapt(onStream);
  const raw = await callModel(cfg, sys, user, onDelta, onThink);
  return parseContentPatch(raw);
}

function parseContentPatch(text) {
  let s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  let patch;
  try { patch = JSON.parse(s); } catch (e) { throw new Error("内容补丁解析失败（模型未返回合法 JSON）。"); }
  if (!patch || !Array.isArray(patch.ops) || !patch.ops.length) throw new Error("内容补丁为空。");
  patch.ops = patch.ops.map(normalizePatchOp).filter(Boolean);
  if (!patch.ops.length) throw new Error("内容补丁没有可执行操作。");
  return patch;
}

function normalizePatchOp(op) {
  if (!op || typeof op !== "object") return null;
  const kind = String(op.op || "").trim();
  const page = op.page === "all" ? "all" : parseInt(op.page, 10);
  const out = Object.assign({}, op, {
    op: kind,
    page: page === "all" || page > 0 ? page : null,
    selector: String(op.selector || "").trim(),
  });
  if (!/^(replace_text|set_text|set_html|remove|set_attr|remove_attr|add_class|remove_class|set_style)$/.test(kind)) return null;
  if (kind !== "replace_text" && !out.selector) return null;
  if ((kind === "set_attr" || kind === "remove_attr") && !String(out.name || "").trim()) return null;
  if ((kind === "replace_text") && !String(out.from || "")) return null;
  return out;
}

// 自动重试一次：format 错误（style/section 为空）时，重试往往就能拿到——不立刻报错给用户。
async function withRetry(fn, validate, errMsg) {
  let r = await fn();
  if (validate(r)) return r;
  r = await fn(); // 重试一次
  if (validate(r)) return r;
  throw new Error(errMsg);
}

// 2) 设计视觉系统 + 一张样板页：返回 { style, section }。
//    style 是必须的，section 可选（样板页没出来时预览回退，不阻塞流程）。
export async function makeDesignSample(cfg, preset, P, plan, samplePage, samplePageNum, total, context, onStream) {
  const run = () => {
    const { sys, user } = designPrompt(preset, P, plan, samplePage, samplePageNum, total, context);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => ({
      style: extractStyle(text), section: normalizePageNumber(sanitizeSection(extractSection(text), samplePage && samplePage.role), samplePageNum, total),
    }));
  };
  return withRetry(run, (r) => !!r.style, "设计未返回 <style>，已重试仍失败，请再试一次。");
}

// 3) 逐页排版：返回单个 <section> 字符串（链式，prevHTML 为上一页）
export async function renderPage(cfg, preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total, layoutReferenceHTML, context, onStream) {
  const run = () => {
    const { sys, user } = renderPrompt(preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total, layoutReferenceHTML, context);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => normalizePageNumber(sanitizeSection(extractSection(text), pageSpec && pageSpec.role), pageNum, total));
  };
  return withRetry(run, (s) => !!s, "第 " + pageNum + " 页未返回 <section>，已重试仍失败。");
}

// 4) 编辑单页：返回修改后的单个 <section>（页码由调用方锁定，模型只看这一页）
export async function editPage(cfg, preset, P, designStyle, currentHTML, feedback, pageNum, total, referenceHTML, context, onStream) {
  const run = () => {
    const { sys, user } = editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total, referenceHTML, context);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) =>
      normalizePageNumber(sanitizeSection(extractSection(text), pageRoleFromSection(currentHTML), currentHTML, designStyle), pageNum, total)
    );
  };
  return withRetry(run, (s) => !!s, "修改后未返回 <section>，已重试仍失败。");
}

// 清理单页输出里的局部视觉系统：页面只能复用 deck 级 <style>，不能自带局部 <style> 或视觉 inline style。
function sanitizeSection(section, role, lockedHTML, sharedStyle) {
  if (!section || typeof DOMParser === "undefined") return section;
  const doc = new DOMParser().parseFromString(section, "text/html");
  const card = doc.body.querySelector("section");
  if (!card) return section;
  const lockedCard = lockedHTML ? new DOMParser().parseFromString(lockedHTML, "text/html").body.querySelector("section") : null;
  const pageRole = role || card.getAttribute("data-role") || "";
  if (!allowsMiddleLayout(pageRole)) card.classList.remove("cm-middle");
  lockSectionVisualContract(card, lockedCard);
  card.querySelectorAll("style").forEach((node) => node.remove());
  card.querySelectorAll("[style]").forEach((node) => {
    const kept = sanitizeInlineStyle(node.getAttribute("style") || "");
    if (kept) node.setAttribute("style", kept);
    else node.removeAttribute("style");
  });
  return card.outerHTML;
}

function lockSectionVisualContract(card, lockedCard) {
  if (!lockedCard) return;
  ["data-theme", "data-font", "data-role"].forEach((name) => {
    if (lockedCard.hasAttribute(name)) card.setAttribute(name, lockedCard.getAttribute(name));
    else card.removeAttribute(name);
  });
  card.className = lockedCard.className;
}

// 单页 inline style 只保留布局和文字排版密度，视觉系统属性仍由 deck 级 <style> 管。
function sanitizeInlineStyle(styleText) {
  return String(styleText || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((decl) => {
      const i = decl.indexOf(":");
      if (i <= 0) return false;
      return isAllowedInlineStyleProp(decl.slice(0, i).trim().toLowerCase());
    })
    .join("; ");
}

// 判断 inline style 属性是否属于布局/文字排版密度，而不是配色、装饰或风格系统。
function isAllowedInlineStyleProp(prop) {
  return /^(font-size|line-height|font-weight|text-align|display|grid-template|grid-template-columns|grid-template-rows|grid-column|grid-row|flex|flex-basis|flex-direction|flex-wrap|align-items|align-self|justify-content|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left)$/i.test(prop);
}

function pageRoleFromSection(section) {
  if (!section || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(section, "text/html");
  const card = doc.body.querySelector("section");
  return card ? (card.getAttribute("data-role") || "") : "";
}

function allowsMiddleLayout(role) {
  return /^(cover|ending|quote)$/i.test(String(role || ""));
}

// 修正模型从示例或上一页里抄错的独立页码，限定在页脚/页码类元素，避免误改正文里的比例或日期。
function normalizePageNumber(section, pageNum, total) {
  if (!section || !pageNum || !total || typeof DOMParser === "undefined") return section;
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

// 5) 页面结构调整：只改 plan.pages，用调用方复用/重排/补生成页面。
export async function revisePlanStructure(cfg, plan, feedback, currentPageNum, context, onStream) {
  const { sys, user } = structurePrompt(plan, feedback, currentPageNum, context);
  const [onDelta, onThink] = adapt(onStream);
  const text = await callModel(cfg, sys, user, onDelta, onThink);
  return parsePlan(text);
}

// 6) 整套样式修改：改全局 <style>，返回 { style, font }（font 为可选的 data-font key）
export async function editStyle(cfg, preset, P, currentStyle, feedback, deckReferenceHTML, context, onStream) {
  const run = () => {
    const { sys, user } = stylePrompt(preset, P, currentStyle, feedback, deckReferenceHTML, context);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => {
      const fontM = text.match(/<!--\s*FONT\s+([a-z]+)\s*-->/i);
      return { style: extractStyle(text), font: fontM ? fontM[1] : null };
    });
  };
  return withRetry(run, (r) => !!r.style, "未返回 <style>，已重试仍失败。");
}
