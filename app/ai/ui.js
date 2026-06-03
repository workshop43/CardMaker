/* =============================================================
   AI 面板与交互：
   - 生成：设置 → 构思大纲 → 用户确认 → 设计全局风格 → 逐页排版（链式）
     · 生成一页、主舞台就长一页；可随时「停止」，之后从下一页「继续」
   - 修改：在第 N 页点「✦ 修改」→ 只重渲染第 N 页（页码硬锁，模型拿不到别页）
   ============================================================= */
import { CardMaker } from "../deck.js";
import {
  listProviders, defaultProvider, loadSaved, saveCfg, resolveCfg, setLastCfg,
} from "./model.js";
import { extractStyle } from "./model.js";
import { makePlan, makeDesign, renderPage, editPage, editStyle } from "./pipeline.js";

export function mountAI(app) {
  injectStyles();
  app.addToolButton("✦ 修改", function () { openEdit(app); }, {});
  app.addToolButton("✦ AI 生成", function () { openGen(app); }, { primary: true });
}

function nowTs() { return (window.performance && performance.now ? performance.now() : Date.now()); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function field(label, inputHtml, hint) {
  return '<div><label>' + label + "</label>" + inputHtml +
    (hint ? '<div class="cmai-hint" style="margin-top:6px">' + hint + "</div>" : "") + "</div>";
}
// 在文本框里按 ⌘/Ctrl + Enter 触发提交按钮
function submitOnCmdEnter(textarea, btn) {
  if (!textarea || !btn) return;
  textarea.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.keyCode === 13)) { e.preventDefault(); btn.click(); }
  });
}
// 从当前 deck 源码里抽全局设计系统 <style>（修改/续生成时复用，刷新后也能拿到）
function deckStyle(app) { return extractStyle(app.getHTML()); }

// ---------------- 生成：设置面板 ----------------
let genEls = null;
function openGen(app) {
  if (!genEls) genEls = buildGenPanel(app);
  genEls.preset.value = app.preset;
  setStatus(genEls, "");
  genEls.mask.classList.add("is-open");
  setTimeout(function () { genEls.topic.focus(); }, 50);
}

function buildGenPanel(app) {
  const presets = CardMaker.PRESETS;
  const presetOpts = Object.keys(presets).map((k) => '<option value="' + k + '">' + presets[k].label + "</option>").join("");
  const providers = listProviders();
  const providerOpts = Object.keys(providers).map((k) => '<option value="' + k + '">' + providers[k].label + "</option>").join("");

  const mask = el("div", "cmai-mask");
  mask.innerHTML =
    '<div class="cmai" role="dialog">' +
    "<header><h3>AI 生成卡片</h3><button class=\"cmai-x\" data-close>×</button></header>" +
    '<div class="cmai-body">' +
    field("主题 / 要求", '<textarea data-topic placeholder="例：做一套讲「3 个时间管理技巧」的小红书卡，语气轻松、有连续叙事。"></textarea>') +
    '<div class="cmai-row">' +
    field("比例", '<select data-preset>' + presetOpts + "</select>") +
    field("页数", '<input data-pages type="text" inputmode="numeric" value="5" />') +
    "</div>" +
    field("服务商", '<select data-provider>' + providerOpts + "</select>", '<span data-modelinfo></span>') +
    field("API Key", '<input data-key type="password" placeholder="填入该服务商的 API Key" />') +
    '<label class="cmai-check"><input type="checkbox" data-remember /> 记住 API Key（仅存本地浏览器）</label>' +
    "</div>" +
    "<footer><div class=\"cmai-status\" data-status></div>" +
    '<button class="cm-btn" data-close>取消</button>' +
    '<button class="cm-btn cm-primary" data-go>生成</button></footer>' +
    "</div>";
  document.body.appendChild(mask);
  const $ = (s) => mask.querySelector(s);
  const els = {
    mask, topic: $("[data-topic]"), preset: $("[data-preset]"), pages: $("[data-pages]"),
    provider: $("[data-provider]"), modelinfo: $("[data-modelinfo]"), key: $("[data-key]"),
    remember: $("[data-remember]"), status: $("[data-status]"), go: $("[data-go]"),
  };
  const saved = loadSaved();
  els.provider.value = saved.provider;
  els.remember.checked = saved.remember;
  els.key.value = saved.key;
  els.preset.value = app.preset;
  showModelInfo(els);
  els.provider.onchange = function () { showModelInfo(els); };
  Array.prototype.forEach.call(mask.querySelectorAll("[data-close]"), (b) => { b.onclick = () => mask.classList.remove("is-open"); });
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.classList.remove("is-open"); });
  els.go.onclick = function () { startGenerate(app, els); };
  submitOnCmdEnter(els.topic, els.go);
  return els;
}

function showModelInfo(els) {
  const p = listProviders()[els.provider.value];
  els.modelinfo.textContent = p ? "模型：" + p.model : "";
}
function setStatus(els, msg, isErr) {
  els.status.textContent = msg || "";
  els.status.className = "cmai-status" + (isErr ? " err" : "");
}

// ---------------- 生成：过程蒙版（构思 / 确认 / 设计 / 逐页） ----------------
let _ov = null;
function overlay() {
  if (_ov) return _ov;
  const root = el("div", "cmai-gen");
  root.innerHTML =
    '<div class="cmai-gen-box">' +
    '<div class="cmai-gen-head"><span class="cmai-spin" data-spin></span>' +
    '<span class="cmai-gen-title" data-title>正在构思…</span>' +
    '<span class="cmai-gen-count" data-count></span><div class="cmai-pbar" data-bar></div></div>' +
    '<div class="cmai-gen-cols">' +
    '<div class="cmai-gen-col"><div class="cmai-gen-label" data-llabel>流式</div><div class="cmai-gen-stream" data-stream></div></div>' +
    '<div class="cmai-gen-col"><div class="cmai-gen-label">预览</div><div class="cmai-gen-prevwrap" data-prev></div></div>' +
    "</div>" +
    '<div class="cmai-gen-foot" data-foot></div>' +
    "</div>";
  document.body.appendChild(root);
  _ov = {
    root, title: root.querySelector("[data-title]"), count: root.querySelector("[data-count]"),
    bar: root.querySelector("[data-bar]"), stream: root.querySelector("[data-stream]"),
    prev: root.querySelector("[data-prev]"), foot: root.querySelector("[data-foot]"),
    llabel: root.querySelector("[data-llabel]"), spin: root.querySelector("[data-spin]"),
  };
  return _ov;
}
function ovShow() { overlay().root.classList.add("is-show"); }
function ovHide() { if (_ov) _ov.root.classList.remove("is-show"); }
function ovTitle(t, spinning) { const g = overlay(); g.title.textContent = t; g.spin.style.visibility = spinning ? "visible" : "hidden"; }
function ovStream(label, text) { const g = overlay(); g.llabel.textContent = label; g.stream.textContent = text || ""; g.stream.scrollTop = g.stream.scrollHeight; }
function ovCount(t) { overlay().count.textContent = t || ""; }
function ovBar(frac) { overlay().bar.style.width = Math.round((frac || 0) * 100) + "%"; }
function ovPreview(deckHTML, preset) { const g = overlay(); CardMaker.renderThumb(deckHTML, preset, g.prev, Math.min(280, g.prev.clientWidth || 280)); }
function ovFoot(buttons) { // buttons: [{label, primary, onClick}]
  const g = overlay(); g.foot.innerHTML = "";
  buttons.forEach((b) => {
    const btn = el("button", "cm-btn" + (b.primary ? " cm-primary" : ""), b.label);
    btn.onclick = b.onClick; g.foot.appendChild(btn);
  });
}
function ovClearPreview(msg) { overlay().prev.innerHTML = '<div style="color:#5b606e;font-size:13px">' + (msg || "") + "</div>"; }

// 生成会话状态
let S = null;

function startGenerate(app, els) {
  const topic = els.topic.value.trim();
  if (!topic) return setStatus(els, "请先填写主题。", true);
  const provider = els.provider.value;
  const p = listProviders()[provider];
  if (!p || !p.base || !p.model) return setStatus(els, "配置文件中未找到该服务商的 base/model。", true);
  const key = els.key.value.trim();
  if (!key) return setStatus(els, "请填写 API Key。", true);
  const cfg = { base: p.base, model: p.model, key };
  setLastCfg(cfg);
  saveCfg(provider, key, els.remember.checked);

  const preset = els.preset.value;
  const pages = parseInt(els.pages.value, 10) || 5;
  app.setPreset(preset);

  S = {
    app, cfg, preset, P: CardMaker.PRESETS[preset], topic, pages,
    plan: null, designStyle: "", sections: [], nextIdx: 0, aborted: false,
  };

  els.mask.classList.remove("is-open");
  setStatus(els, "");
  ovShow();
  runPlan();
}

async function runPlan() {
  const g = overlay();
  ovTitle("正在构思大纲…", true);
  ovCount(""); ovBar(0); ovStream("构思内容", ""); ovClearPreview("大纲确认后开始逐页排版");
  ovFoot([{ label: "取消", onClick: cancelAll }]);
  const t0 = nowTs();
  const timer = setInterval(() => ovCount(Math.round((nowTs() - t0) / 1000) + "s"), 250);
  try {
    const plan = await makePlan(S.cfg, S.preset, S.pages, S.topic, (txt) => ovStream("构思内容", txt));
    clearInterval(timer);
    S.plan = plan;
    showPlanConfirm();
  } catch (err) {
    clearInterval(timer);
    failBack(err);
  }
}

// 大纲确认：展示页面清单 + 「开始排版 / 重新构思 / 取消」
function showPlanConfirm() {
  const g = overlay();
  ovTitle("大纲已就绪，请确认", false);
  ovBar(0); ovCount((S.plan.pages.length) + " 页");
  const list = S.plan.pages.map((pg, i) =>
    '<div class="cmai-plan-item"><span class="cmai-plan-n">' + (i + 1) + "</span><div><div class=\"cmai-plan-t\">" +
    escapeHtml(pg.title || pg.role || ("第" + (i + 1) + "页")) + "</div><div class=\"cmai-plan-p\">" +
    escapeHtml((pg.points || []).join(" · ")) + "</div></div></div>"
  ).join("");
  g.stream.innerHTML =
    '<div class="cmai-plan-head">《' + escapeHtml(S.plan.title || S.topic) + "》　基调：" + escapeHtml(S.plan.vibe || "") +
    "　主题色:" + escapeHtml(S.plan.theme || "-") + " / 字体:" + escapeHtml(S.plan.font || "-") + "</div>" + list;
  g.llabel.textContent = "内容大纲";
  ovClearPreview("确认后开始逐页排版");
  ovFoot([
    { label: "重新构思", onClick: runPlan },
    { label: "开始逐页排版", primary: true, onClick: runDesignThenRender },
  ]);
}

async function runDesignThenRender() {
  const g = overlay();
  ovTitle("正在设计整套风格…", true);
  ovStream("设计风格", ""); ovBar(0); ovClearPreview("风格就绪后逐页排版");
  ovFoot([{ label: "取消", onClick: cancelAll }]);
  const t0 = nowTs();
  const timer = setInterval(() => ovCount(Math.round((nowTs() - t0) / 1000) + "s"), 250);
  try {
    S.designStyle = await makeDesign(S.cfg, S.preset, S.P, S.plan, (txt) => ovStream("设计风格", txt));
    clearInterval(timer);
    runRender();
  } catch (err) {
    clearInterval(timer);
    failBack(err);
  }
}

// 逐页排版（链式）：从 S.nextIdx 开始，逐页生成→落入主舞台→预览；可被 aborted 中断
async function runRender() {
  S.aborted = false;
  const total = S.plan.pages.length;
  ovFoot([{ label: "停止", onClick: function () { S.aborted = true; ovTitle("正在停止（完成当前页后停）…", true); } }]);
  try {
    for (let i = S.nextIdx; i < total; i++) {
      ovTitle("正在排第 " + (i + 1) + " / " + total + " 页…", true);
      ovCount((i + 1) + " / " + total); ovBar(i / total);
      const prev = S.sections[i - 1] || "";
      const sec = await renderPage(
        S.cfg, S.preset, S.P, S.plan, S.designStyle, S.plan.pages[i], prev, i + 1, total,
        function (txt) { ovStream("排版第 " + (i + 1) + " 页", txt); livePreviewWith(S.designStyle, sec0(txt), S.preset); }
      );
      S.sections[i] = sec;
      S.nextIdx = i + 1;
      applySections(true); // 落入主舞台并跳到这一页
      ovPreview(S.designStyle + "\n" + sec, S.preset);
      ovBar(S.nextIdx / total);
      if (S.aborted) break;
    }
    finishOrPause(total);
  } catch (err) {
    failBack(err);
  }
}

function finishOrPause(total) {
  if (S.nextIdx >= total) {
    ovTitle("生成完成", false); ovBar(1);
    ovFoot([{ label: "完成", primary: true, onClick: doneAll }]);
    setTimeout(doneAll, 400); // 顺滑收尾
  } else {
    ovTitle("已停在第 " + S.nextIdx + " 页", false);
    ovFoot([
      { label: "完成（保留已生成）", onClick: doneAll },
      { label: "继续生成第 " + (S.nextIdx + 1) + " 页", primary: true, onClick: runRender },
    ]);
  }
}

// 把已生成的 designStyle + sections 灌入主舞台
function applySections(jumpToLast) {
  const html = (S.designStyle || "") + "\n" + S.sections.filter(Boolean).join("\n");
  S.app.setHTML(html);
  if (jumpToLast) S.app.goTo(Math.max(0, S.sections.filter(Boolean).length - 1));
}
// 流式期间的实时预览：把半截 section 直接塞进真 .card 渲染（renderThumb 用 DOMParser 容错补全
// 未闭合标签），内容边到边显示——组件一个个冒出来。节流到 ~120ms/帧，避免每个 token 都重渲。
function sec0(streamText) { const m = (streamText || "").match(/<section[\s\S]*/i); return m ? m[0] : ""; }
let _prevTs = 0;
function livePreviewWith(style, sec, preset) {
  if (!sec) return;
  const now = (window.performance && performance.now ? performance.now() : Date.now());
  if (now - _prevTs < 120) return;
  _prevTs = now;
  ovPreview((style || "") + "\n" + sec, preset);
}

function doneAll() { ovHide(); S = null; }
function cancelAll() { S = null; ovHide(); }
function failBack(err) {
  ovTitle("失败", false);
  ovStream("出错", (err && err.message) || String(err));
  ovFoot([{ label: "关闭", onClick: cancelAll }, { label: "重试构思", primary: true, onClick: runPlan }]);
}

// ---------------- 修改：只改当前页（页码硬锁） ----------------
let editEls = null;
function openEdit(app) {
  if (!app.cards.length) return;
  if (!editEls) editEls = buildEditPanel(app);
  editEls.app = app;
  editEls.fb.value = "";
  setEditScope(editEls, "page"); // 每次打开默认「改这一页」
  editEls.idxLabel.textContent = "第 " + (app.index + 1) + " / " + app.cards.length + " 页";
  setStatus(editEls, "");
  editEls.mask.classList.add("is-open");
  setTimeout(() => editEls.fb.focus(), 50);
}

function buildEditPanel(app) {
  const mask = el("div", "cmai-mask");
  mask.innerHTML =
    '<div class="cmai" role="dialog">' +
    "<header><h3>AI 修改</h3><button class=\"cmai-x\" data-close>×</button></header>" +
    '<div class="cmai-body">' +
    '<div class="cmai-tabs">' +
    '<button class="cmai-tab is-on" data-scope="page">改这一页 · <span data-idx></span></button>' +
    '<button class="cmai-tab" data-scope="deck">改整套风格</button>' +
    "</div>" +
    field("修改意见", '<textarea data-fb></textarea>', '<span data-hint></span>') +
    "</div>" +
    "<footer><div class=\"cmai-status\" data-status></div>" +
    '<button class="cm-btn" data-close>取消</button>' +
    '<button class="cm-btn cm-primary" data-go>修改</button></footer>' +
    "</div>";
  document.body.appendChild(mask);
  const $ = (s) => mask.querySelector(s);
  const els = {
    mask, app, fb: $("[data-fb]"), status: $("[data-status]"), go: $("[data-go]"),
    idxLabel: $("[data-idx]"), hint: $("[data-hint]"), scope: "page",
    tabs: Array.prototype.slice.call(mask.querySelectorAll("[data-scope]")),
  };
  els.tabs.forEach((t) => { t.onclick = () => setEditScope(els, t.getAttribute("data-scope")); });
  Array.prototype.forEach.call(mask.querySelectorAll("[data-close]"), (b) => { b.onclick = () => mask.classList.remove("is-open"); });
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.classList.remove("is-open"); });
  els.go.onclick = function () { (els.scope === "deck" ? applyStyleEdit : applyEditOne)(els); };
  submitOnCmdEnter(els.fb, els.go);
  return els;
}

// 切换修改范围：这一页 / 整套风格
function setEditScope(els, scope) {
  els.scope = scope;
  els.tabs.forEach((t) => t.classList.toggle("is-on", t.getAttribute("data-scope") === scope));
  if (scope === "deck") {
    els.fb.placeholder = "例：换成深色系 / 强调色改成橙色 / 整体换宋体 / 改成杂志极简风";
    els.hint.textContent = "改全局配色 / 字体 / 风格，所有页一起变；改完可再「逐页按新风格重绘」。";
    els.go.textContent = "改整套风格";
  } else {
    els.fb.placeholder = "例：把标题再大一点 / 内容和页脚重叠了往上收 / 改成左右两栏";
    els.hint.textContent = "只改你当前所在的这一页，不会动到别页。";
    els.go.textContent = "修改这一页";
  }
}

async function applyEditOne(els) {
  const app = els.app;
  const cfg = resolveCfg();
  if (!cfg) return setStatus(els, "请先用「✦ AI 生成」设置好服务商与 API Key。", true);
  const idx = app.index, total = app.cards.length, preset = app.preset; // 页码在此锁定
  const P = CardMaker.PRESETS[preset];
  const currentHTML = app.currentCardHTML();
  const feedback = els.fb.value.trim();

  els.mask.classList.remove("is-open");
  ovShow();
  ovTitle("正在修改第 " + (idx + 1) + " / " + total + " 页…", true);
  ovCount(""); ovBar(0.3); ovStream("修改第 " + (idx + 1) + " 页", ""); ovClearPreview("");
  ovFoot([]);
  const t0 = nowTs();
  const timer = setInterval(() => ovCount(Math.round((nowTs() - t0) / 1000) + "s"), 250);
  try {
    const sec = await editPage(
      cfg, preset, P, deckStyle(app), currentHTML, feedback, idx + 1, total,
      function (txt) { ovStream("修改第 " + (idx + 1) + " 页", txt); livePreviewWith(deckStyle(app), sec0(txt), preset); }
    );
    clearInterval(timer);
    app.patchDeck({ pages: { [idx]: sec } }); // 只替换第 idx 页——页码由我们锁定，模型无权改别页
    app.goTo(idx);
    ovHide();
  } catch (err) {
    clearInterval(timer);
    ovHide();
    setStatus(els, "失败：" + ((err && err.message) || err), true);
    els.mask.classList.add("is-open");
  }
}

// 整套风格修改：改全局 <style>，所有页随令牌/组件一起变；改完给「逐页重绘」可选项
async function applyStyleEdit(els) {
  const app = els.app;
  const cfg = resolveCfg();
  if (!cfg) return setStatus(els, "请先用「✦ AI 生成」设置好服务商与 API Key。", true);
  const preset = app.preset, P = CardMaker.PRESETS[preset];
  const cur = deckStyle(app);
  if (!cur) return setStatus(els, "当前 deck 没有可改的全局 <style>（可能是手写的简单卡片）。", true);
  const feedback = els.fb.value.trim() || "优化整套的配色与视觉风格，使其更协调、精致。";

  els.mask.classList.remove("is-open");
  ovShow();
  ovTitle("正在改整套风格…", true);
  ovCount(""); ovBar(0.3); ovStream("整套风格", ""); ovClearPreview("");
  ovFoot([]);
  const t0 = nowTs();
  const timer = setInterval(() => ovCount(Math.round((nowTs() - t0) / 1000) + "s"), 250);
  try {
    const r = await editStyle(cfg, preset, P, cur, feedback, (txt) => ovStream("整套风格", txt));
    clearInterval(timer);
    app.patchDeck({ style: r.style }); // 替换全局 <style>，所有页随令牌/组件变
    if (r.font) app.setFont(r.font);   // 换中文 web 字体
    app.goTo(app.index);
    ovTitle("整套风格已更新", false); ovBar(1);
    ovPreview(r.style + "\n" + app.currentCardHTML(), preset);
    ovFoot([
      { label: "完成", onClick: doneAll },
      { label: "逐页按新风格重绘", primary: true, onClick: () => rerenderAll(app, r.style) },
    ]);
  } catch (err) {
    clearInterval(timer);
    ovHide();
    setStatus(els, "失败：" + ((err && err.message) || err), true);
    els.mask.classList.add("is-open");
  }
}

// 逐页按新风格重绘：循环 editPage（内容不变、版式配色按新风格重画），复用逐页预览/打断
async function rerenderAll(app, designStyle) {
  const cfg = resolveCfg();
  if (!cfg) return;
  const preset = app.preset, P = CardMaker.PRESETS[preset], total = app.cards.length;
  let aborted = false;
  ovFoot([{ label: "停止", onClick: function () { aborted = true; ovTitle("正在停止（完成当前页后停）…", true); } }]);
  try {
    for (let i = 0; i < total; i++) {
      ovTitle("按新风格重绘第 " + (i + 1) + " / " + total + " 页…", true);
      ovCount((i + 1) + " / " + total); ovBar(i / total);
      app.goTo(i);
      const cur = app.currentCardHTML();
      const sec = await editPage(
        cfg, preset, P, designStyle, cur,
        "按新的全局风格重新设计这一页的版式与配色，内容信息保持不变。", i + 1, total,
        function (txt) { ovStream("重绘第 " + (i + 1) + " 页", txt); livePreviewWith(designStyle, sec0(txt), preset); }
      );
      app.patchDeck({ pages: { [i]: sec } });
      app.goTo(i);
      ovPreview(designStyle + "\n" + sec, preset);
      ovBar((i + 1) / total);
      if (aborted) break;
    }
    ovTitle(aborted ? "已停止（保留已重绘的页）" : "整套重绘完成", false); ovBar(1);
    ovFoot([{ label: "完成", primary: true, onClick: doneAll }]);
    if (!aborted) setTimeout(doneAll, 400);
  } catch (err) {
    ovTitle("失败", false); ovStream("出错", (err && err.message) || String(err));
    ovFoot([{ label: "关闭", onClick: doneAll }]);
  }
}

function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------------- 样式 ----------------
let _styled = false;
function injectStyles() {
  if (_styled) return; _styled = true;
  const css =
    ".cmai-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:200;display:none;align-items:center;justify-content:center}" +
    ".cmai-mask.is-open{display:flex}" +
    ".cmai{width:min(560px,92vw);max-height:90vh;overflow:auto;background:#16181d;color:#e9e9ee;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.5);font-family:var(--cm-font-sans,system-ui)}" +
    ".cmai header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.08)}" +
    ".cmai header h3{margin:0;font-size:17px}" +
    ".cmai header .cmai-x{background:none;border:none;color:#9aa0ad;font-size:22px;cursor:pointer;line-height:1}" +
    ".cmai .cmai-body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}" +
    ".cmai label{display:block;font-size:13px;color:#9aa0ad;margin-bottom:7px}" +
    ".cmai input,.cmai select,.cmai textarea{width:100%;box-sizing:border-box;background:#0d0f13;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;outline:none}" +
    ".cmai input:focus,.cmai select:focus,.cmai textarea:focus{border-color:var(--cm-accent,#6d6df0)}" +
    ".cmai textarea{resize:vertical;min-height:84px;line-height:1.5}" +
    ".cmai .cmai-row{display:flex;gap:12px}.cmai .cmai-row>div{flex:1}" +
    ".cmai .cmai-check{display:flex;align-items:center;gap:8px;color:#9aa0ad;font-size:13px}" +
    ".cmai .cmai-check input{width:auto}" +
    ".cmai-tabs{display:flex;gap:8px;margin-bottom:4px}" +
    ".cmai-tab{flex:1;padding:9px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#9aa0ad;font:inherit;font-size:13px;cursor:pointer}" +
    ".cmai-tab.is-on{background:var(--cm-accent,#6d6df0);border-color:transparent;color:#fff;font-weight:600}" +
    ".cmai footer{display:flex;align-items:center;gap:12px;padding:16px 24px;border-top:1px solid rgba(255,255,255,.08)}" +
    ".cmai .cmai-status{flex:1;font-size:13px;color:#9aa0ad;min-height:18px;display:flex;align-items:center;gap:9px}" +
    ".cmai .cmai-status.err{color:#f87171}" +
    ".cmai .cmai-hint{font-size:12px;color:#6b7280;line-height:1.5}" +
    ".cmai a{color:var(--cm-accent,#8b8bf5)}" +
    ".cmai-spin{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:var(--cm-accent,#8b8bf5);animation:cmai-rot .7s linear infinite}" +
    "@keyframes cmai-rot{to{transform:rotate(360deg)}}" +
    ".cmai-gen{position:fixed;inset:0;z-index:205;display:none;align-items:center;justify-content:center;background:rgba(8,8,12,.82);backdrop-filter:blur(6px);font-family:var(--cm-font-sans,system-ui);color:#e9e9ee}" +
    ".cmai-gen.is-show{display:flex}" +
    ".cmai-gen-box{width:min(900px,94vw);height:min(640px,88vh);background:#14151b;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}" +
    ".cmai-gen-head{position:relative;display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);font-size:15px}" +
    ".cmai-gen-title{font-weight:600}" +
    ".cmai-gen-count{margin-left:auto;color:#9aa0ad;font-variant-numeric:tabular-nums}" +
    ".cmai-gen-head .cmai-pbar{position:absolute;left:0;bottom:0;height:3px;width:0;background:var(--cm-accent,#8b8bf5);transition:width .3s}" +
    ".cmai-gen-cols{flex:1;display:flex;min-height:0}" +
    ".cmai-gen-col{flex:1;display:flex;flex-direction:column;min-width:0;padding:16px 20px}" +
    ".cmai-gen-col+.cmai-gen-col{border-left:1px solid rgba(255,255,255,.08)}" +
    ".cmai-gen-label{font-size:12px;color:#7c8190;letter-spacing:1px;margin-bottom:10px;flex:none}" +
    ".cmai-gen-stream{flex:1;overflow:auto;font-family:var(--cm-font-mono,monospace);font-size:12px;line-height:1.65;color:#9fb3c8;white-space:pre-wrap;word-break:break-word}" +
    ".cmai-gen-prevwrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}" +
    ".cmai-gen-prevwrap .cmai-prev{overflow:hidden;border-radius:10px;box-shadow:0 10px 36px rgba(0,0,0,.45)}" +
    ".cmai-gen-foot{display:flex;gap:10px;justify-content:flex-end;padding:14px 22px;border-top:1px solid rgba(255,255,255,.08)}" +
    ".cmai-gen-foot:empty{display:none}" +
    // 大纲确认清单
    ".cmai-plan-head{color:#cdd3df;font-size:13px;margin-bottom:12px;line-height:1.6}" +
    ".cmai-plan-item{display:flex;gap:12px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}" +
    ".cmai-plan-n{flex:none;width:24px;height:24px;border-radius:7px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:12px;color:#9aa0ad}" +
    ".cmai-plan-t{font-size:14px;color:#e9e9ee;font-family:var(--cm-font-sans,system-ui)}" +
    ".cmai-plan-p{font-size:12px;color:#8a90a0;margin-top:3px;font-family:var(--cm-font-sans,system-ui)}" +
    "@media(max-width:640px){.cmai-gen-cols{flex-direction:column}.cmai-gen-col+.cmai-gen-col{border-left:none;border-top:1px solid rgba(255,255,255,.08)}}";
  const st = el("style"); st.textContent = css; document.head.appendChild(st);
}
