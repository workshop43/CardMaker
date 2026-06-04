/* =============================================================
   分步生成编排：把 prompts + callModel 组合成 4 个异步原语。
   控制流（确认大纲 / 逐页推进 / 打断 / 续生成）由 ui.js 的状态机驱动，
   这里保持无状态，只负责「一次 LLM 往返完成一个子任务」。
   ============================================================= */
import { callModel, extractSection, extractStyle } from "./model.js";
import { planPrompt, designPrompt, renderPrompt, editPrompt, stylePrompt } from "./prompts.js";

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
export async function makePlan(cfg, preset, pages, topic, onStream) {
  const { sys, user } = planPrompt(preset, pages, topic);
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
export async function makeDesignSample(cfg, preset, P, plan, samplePage, onStream) {
  const run = () => {
    const { sys, user } = designPrompt(preset, P, plan, samplePage);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => ({
      style: extractStyle(text), section: extractSection(text),
    }));
  };
  return withRetry(run, (r) => !!r.style, "设计未返回 <style>，已重试仍失败，请再试一次。");
}

// 3) 逐页排版：返回单个 <section> 字符串（链式，prevHTML 为上一页）
export async function renderPage(cfg, preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total, onStream) {
  const run = () => {
    const { sys, user } = renderPrompt(preset, P, plan, designStyle, pageSpec, prevHTML, pageNum, total);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => extractSection(text));
  };
  return withRetry(run, (s) => !!s, "第 " + pageNum + " 页未返回 <section>，已重试仍失败。");
}

// 4) 编辑单页：返回修改后的单个 <section>（页码由调用方锁定，模型只看这一页）
export async function editPage(cfg, preset, P, designStyle, currentHTML, feedback, pageNum, total, onStream) {
  const run = () => {
    const { sys, user } = editPrompt(preset, P, designStyle, currentHTML, feedback, pageNum, total);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => extractSection(text));
  };
  return withRetry(run, (s) => !!s, "修改后未返回 <section>，已重试仍失败。");
}

// 5) 整套样式修改：改全局 <style>，返回 { style, font }（font 为可选的 data-font key）
export async function editStyle(cfg, preset, P, currentStyle, feedback, onStream) {
  const run = () => {
    const { sys, user } = stylePrompt(preset, P, currentStyle, feedback);
    const [onDelta, onThink] = adapt(onStream);
    return callModel(cfg, sys, user, onDelta, onThink).then((text) => {
      const fontM = text.match(/<!--\s*FONT\s+([a-z]+)\s*-->/i);
      return { style: extractStyle(text), font: fontM ? fontM[1] : null };
    });
  };
  return withRetry(run, (r) => !!r.style, "未返回 <style>，已重试仍失败。");
}
