/* =============================================================
   AI 对话面板：右侧固定侧栏，生成 / 编辑 / 风格修改全在对话里进行，
   不再使用模态框覆盖画布。
   ============================================================= */
import { CardMaker } from "../deck.js";
import { listProviders, defaultProvider, loadSaved, saveCfg, resolveCfg, setLastCfg } from "./model.js";
import { extractStyle } from "./model.js";
import { makePlan, makeDesignSample, renderPage, editPage, editStyle } from "./pipeline.js";

// ─── 状态 ─────────────────────────────────────────────────────────────────────
let P = null;   // 面板 DOM 引用 { msgs, input, send, preset, pages, opts }
let S = null;   // 生成会话 { app,cfg,preset,PSet,plan,designStyle,sections,nextIdx,sampleIdx,sampleSection,aborted }

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
      '<button class="cm-btn cm-ai-new" title="新建对话">新建</button>' +
      '<button class="cm-btn cm-ai-cfg" title="API 设置">⚙</button>' +
    "</div>" +
    '<div class="cm-ai-msgs"></div>' +
    '<div class="cm-ai-foot">' +
      '<div class="cm-ai-opts">' +
        '<select class="cm-select cm-ai-preset"></select>' +
        '<input class="cm-ai-pages" type="text" inputmode="numeric" value="6" title="页数（如 6）" />' +
      "</div>" +
      '<div class="cm-ai-input-wrap">' +
        '<textarea class="cm-ai-input" placeholder="描述你想做的卡片，或输入修改意见…\n⌘/Ctrl + Enter 发送" rows="3"></textarea>' +
        '<button class="cm-btn cm-primary cm-ai-send">↑</button>' +
      "</div>" +
    "</div>";
  body.appendChild(wrap);

  // 填充比例选项
  const presetSel = wrap.querySelector(".cm-ai-preset");
  Object.entries(CardMaker.PRESETS).forEach(([k, v]) => {
    const o = document.createElement("option");
    o.value = k; o.textContent = v.label; presetSel.appendChild(o);
  });
  presetSel.value = app.preset;
  presetSel.onchange = () => app.setPreset(presetSel.value);

  P = {
    wrap, msgs: wrap.querySelector(".cm-ai-msgs"),
    input: wrap.querySelector(".cm-ai-input"), send: wrap.querySelector(".cm-ai-send"),
    preset: presetSel, pages: wrap.querySelector(".cm-ai-pages"),
    opts: wrap.querySelector(".cm-ai-opts"),
  };

  wrap.querySelector(".cm-ai-new").onclick = () => newConversation(app);
  wrap.querySelector(".cm-ai-cfg").onclick = () => openSettings(app);
  P.send.onclick = () => handleSend(app);
  P.input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSend(app); }
  });

  addAIMsg("你好！描述你想做的卡片，或在画布里选好页数和比例，直接发送主题开始生成。");
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

// ─── 发送处理 ─────────────────────────────────────────────────────────────────
function handleSend(app) {
  const text = P.input.value.trim();
  if (!text) return;
  const cfg = resolveCfg();
  if (!cfg) { addAIMsg("请先点击右上角 ⚙ 配置 API Key。"); openSettings(app); return; }
  P.input.value = "";
  addUserMsg(text);
  // 有卡片且已完成生成 → 编辑模式；否则 → 新生成
  if (app.cards.length && S && S.plan) {
    runEdit(app, cfg, text);
  } else {
    runGenerate(app, cfg, text);
  }
}

function newConversation(app) {
  S = null;
  addAIMsg("好的，开始新对话。描述你想做的卡片主题。");
}

// ─── 生成流程（三步确认） ─────────────────────────────────────────────────────
async function runGenerate(app, cfg, topic) {
  const preset = P.preset.value;
  const pages = parseInt(P.pages.value, 10) || 6;
  app.setPreset(preset);
  const PSet = CardMaker.PRESETS[preset];

  S = { app, cfg, preset, PSet, topic, plan: null, designStyle: "", sections: [], nextIdx: 0, aborted: false, sampleIdx: 0, sampleSection: "" };

  // 第1步：构思内容
  const m1 = streamMsg();
  m1.setText("正在构思内容大纲…");
  try {
    S.plan = await makePlan(cfg, preset, pages, topic);
  } catch (e) { m1.done(); m1.setHtml('<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>"); return; }
  m1.done();

  // 显示大纲
  const planHtml = formatPlan(S.plan);
  m1.setHtml(planHtml);
  setLastCfg(cfg);

  m1.addActions([
    { label: "重新构思", onClick: () => { S = null; addUserMsg("（重新构思）"); runGenerate(app, cfg, topic); } },
    { label: "开始设计样式", primary: true, onClick: () => runDesign(app) },
  ]);
}

async function runDesign(app) {
  S.aborted = false;
  const m = streamMsg();
  m.setText("正在设计风格 + 排样板页，请稍候…");
  try {
    S.sampleIdx = pickSampleIdx(S.plan);
    const r = await makeDesignSample(S.cfg, S.preset, S.PSet, S.plan, S.plan.pages[S.sampleIdx],
      (txt, thinking) => { if (!thinking) m.setText("正在设计风格…"); });
    S.designStyle = r.style;
    S.sampleSection = r.section;
    m.done();
    if (S.sampleSection) { app.setHTML(S.designStyle + "\n" + S.sampleSection); app.goTo(0); }
    m.setHtml("风格样板已就绪，请查看左侧画布。");
    m.addActions([
      { label: "重做样式", onClick: () => runDesign(app) },
      { label: "排全部页", primary: true, onClick: () => runRender(app) },
    ]);
  } catch (e) { m.done(); m.setHtml('<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>"); }
}

async function runRender(app) {
  const total = S.plan.pages.length;
  if (S.sampleSection) S.sections[S.sampleIdx] = S.sampleSection;
  S.nextIdx = 0; S.aborted = false;
  const m = streamMsg();

  const updateProgress = () => {
    const done = S.sections.filter(Boolean).length;
    m.setText("正在排版：" + done + " / " + total + " 页…");
  };
  updateProgress();
  m.addActions([{ label: "停止", onClick: () => { S.aborted = true; } }]);

  try {
    for (let i = S.nextIdx; i < total; i++) {
      if (S.aborted) break;
      if (S.sections[i]) { updateProgress(); applySections(app); continue; }
      const prev = S.sections[i - 1] || "";
      const sec = await renderPage(S.cfg, S.preset, S.PSet, S.plan, S.designStyle, S.plan.pages[i], prev, i + 1, total);
      S.sections[i] = sec;
      S.nextIdx = i + 1;
      applySections(app);
      updateProgress();
    }
    m.done();
    const done = S.sections.filter(Boolean).length;
    m.setHtml(done + " / " + total + " 页已生成。可在输入框描述修改意见，或点「新建」开始新主题。");
    setMsgActions(m.el, [
      { label: "改整套风格", onClick: () => promptStyleEdit(app) },
    ]);
  } catch (e) { m.done(); m.setHtml('<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>"); }
}

// ─── 编辑流程 ─────────────────────────────────────────────────────────────────
async function runEdit(app, cfg, feedback) {
  const idx = app.index, total = app.cards.length, preset = app.preset;
  const PSet = CardMaker.PRESETS[preset];
  const designStyle = S ? S.designStyle : extractStyleFromDeck(app);
  const m = streamMsg();
  m.setText("正在修改第 " + (idx + 1) + " / " + total + " 页…");
  try {
    const sec = await editPage(cfg, preset, PSet, designStyle, app.currentCardHTML(), feedback, idx + 1, total);
    app.patchDeck({ pages: { [idx]: sec } }); app.goTo(idx);
    if (S) S.sections[idx] = sec;
    m.done(); m.setHtml("第 " + (idx + 1) + " 页已修改，请查看画布。");
  } catch (e) { m.done(); m.setHtml('<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>"); }
}

// 触发整套风格修改
function promptStyleEdit(app) {
  addAIMsg("好的，请在输入框描述想要的风格调整（如：换成深色系、强调色改橙色、整体换宋体）。", []);
  P.input.focus();
  // 下一次发送强制走整套风格
  const origSend = P.send.onclick;
  P.send.onclick = () => {
    const text = P.input.value.trim();
    if (!text) return;
    P.input.value = "";
    P.send.onclick = origSend; // 恢复
    addUserMsg(text);
    doStyleEdit(app, text);
  };
}

async function doStyleEdit(app, feedback) {
  const cfg = resolveCfg(); if (!cfg) return;
  const preset = app.preset, PSet = CardMaker.PRESETS[preset];
  const curStyle = S ? S.designStyle : extractStyleFromDeck(app);
  if (!curStyle) { addAIMsg("当前 deck 没有可改的全局 <style>。"); return; }
  const m = streamMsg(); m.setText("正在修改整套风格…");
  try {
    const r = await editStyle(cfg, preset, PSet, curStyle, feedback);
    app.patchDeck({ style: r.style }); if (r.font) app.setFont(r.font);
    if (S) S.designStyle = r.style;
    m.done(); m.setHtml("整套风格已更新，请查看画布。");
  } catch (e) { m.done(); m.setHtml('<span class="cm-err">失败：' + escapeHtml(String(e.message || e)) + "</span>"); }
}

// ─── 辅助 ─────────────────────────────────────────────────────────────────────
function applySections(app) {
  const html = (S.designStyle || "") + "\n" + S.sections.filter(Boolean).join("\n");
  app.setHTML(html);
  app.goTo(Math.max(0, S.sections.filter(Boolean).length - 1));
}

function pickSampleIdx(plan) {
  const ps = plan.pages || [];
  let i = ps.findIndex((p) => p.role === "content" || p.role === "data");
  return i >= 0 ? i : (ps.length > 1 ? 1 : 0);
}

function extractStyleFromDeck(app) {
  return extractStyle(app.getHTML());
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
    ".cm-ai-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07)}" +
    ".cm-ai-brand{font-weight:600;font-size:14px;flex:1}" +
    ".cm-ai-head .cm-btn{padding:5px 10px;font-size:12px}" +
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
    ".cm-ai-opts{display:flex;gap:8px}" +
    ".cm-ai-opts .cm-select{flex:1;font-size:12px;padding:5px 8px}" +
    ".cm-ai-pages{width:56px;background:#0a0b0e;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:5px 8px;font:inherit;font-size:12px;outline:none;text-align:center}" +
    ".cm-ai-input-wrap{display:flex;gap:8px;align-items:flex-end}" +
    ".cm-ai-input{flex:1;background:#0a0b0e;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 11px;font:inherit;font-size:13px;line-height:1.5;resize:none;outline:none;min-height:60px}" +
    ".cm-ai-input:focus{border-color:var(--cm-accent,#6d6df0)}" +
    ".cm-ai-send{flex:none;padding:9px 13px;font-size:16px;line-height:1}" +
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
