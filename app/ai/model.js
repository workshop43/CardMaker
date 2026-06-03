/* =============================================================
   LLM 通信层：流式调用 OpenAI 兼容 /chat/completions + API Key 本地存取。
   纯前端直连大模型（无后端）。Key 仅存在本地浏览器（localStorage）。
   ============================================================= */
import { PROVIDERS, DEFAULT_PROVIDER } from "../config.js";

// 只在本地保存「选了哪个服务商」和「Key」；base/model 来自配置文件，不存
const LS = { provider: "cm_ai_provider", key: "cm_ai_key", remember: "cm_ai_remember" };

export function listProviders() { return PROVIDERS; }
export function defaultProvider() {
  return PROVIDERS[DEFAULT_PROVIDER] ? DEFAULT_PROVIDER : Object.keys(PROVIDERS)[0];
}

// 上次成功配置 {base,model,key}，供「✦ 修改」复用，免得再填一次 Key
let _lastCfg = null;
export function setLastCfg(cfg) { _lastCfg = cfg; }

// 读已存的（服务商、Key、是否记住）
export function loadSaved() {
  const provider = localStorage.getItem(LS.provider) || defaultProvider();
  const remember = localStorage.getItem(LS.remember) === "1";
  return {
    provider: PROVIDERS[provider] ? provider : defaultProvider(),
    key: remember ? (localStorage.getItem(LS.key) || "") : "",
    remember,
  };
}

// 记住 / 清除本地配置
export function saveCfg(provider, key, remember) {
  if (remember) {
    localStorage.setItem(LS.remember, "1");
    localStorage.setItem(LS.provider, provider);
    localStorage.setItem(LS.key, key);
  } else {
    Object.keys(LS).forEach((k) => localStorage.removeItem(LS[k]));
  }
}

// 取一个可用配置：优先本次会话用过的，其次本地存档
export function resolveCfg() {
  if (_lastCfg && _lastCfg.key) return _lastCfg;
  const provider = localStorage.getItem(LS.provider) || defaultProvider();
  const p = PROVIDERS[provider];
  const key = localStorage.getItem(LS.key);
  if (p && key) return { base: p.base, model: p.model, key };
  return null;
}

// ---------- 大模型调用（OpenAI 兼容 /chat/completions，流式） ----------
// onDelta(fullContent)：正文增量；onThink(fullReasoning)：思考模式 reasoning_content 增量。
// 返回 Promise<完整正文字符串>。
export function callModel(cfg, sys, user, onDelta, onThink) {
  return fetch(cfg.base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      stream: true,
    }),
  }).then(function (res) {
    if (!res.ok) return parseJson(res); // 出错时按 JSON 解析并抛出
    const ct = res.headers.get("content-type") || "";
    // 服务端不支持流式（返回整段 JSON）时降级处理
    if (!res.body || ct.indexOf("text/event-stream") === -1) {
      return res.text().then(function (t) {
        const j = JSON.parse(t);
        const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
        if (onThink && msg.reasoning_content) onThink(msg.reasoning_content);
        const c = msg.content || "";
        if (onDelta) onDelta(c);
        return c;
      });
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    let reasoning = "";
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return full;
        buf += dec.decode(r.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (line.indexOf("data:") !== 0) return;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") return;
          try {
            const j = JSON.parse(data);
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (!delta) return;
            if (delta.reasoning_content) { reasoning += delta.reasoning_content; if (onThink) onThink(reasoning); }
            if (delta.content) { full += delta.content; if (onDelta) onDelta(full); }
          } catch (e) { /* 忽略不完整分片 */ }
        });
        return pump();
      });
    }
    return pump();
  });
}

function parseJson(res) {
  return res.text().then(function (t) {
    let data;
    try { data = JSON.parse(t); } catch (e) { throw new Error("响应非 JSON（HTTP " + res.status + "）：" + t.slice(0, 160)); }
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error.type)) || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return data;
  });
}

// ---------- HTML 提取小工具 ----------
// 从模型输出里提取干净的卡片 HTML（剥代码围栏，截取 <style>/<section> 到最后一个 </section>）
export function extractCards(text) {
  let s = text.trim();
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const sec = s.indexOf("<section");
  const sty = s.indexOf("<style");
  let first = sec;
  if (sty !== -1 && sty < sec) first = sty; // deck 级 <style> 在首个 <section> 之前则一并保留
  const last = s.lastIndexOf("</section>");
  if (first !== -1 && last !== -1) s = s.slice(first, last + "</section>".length);
  return s;
}

export function countCards(html) {
  const m = html.match(/<\/section>/g);
  return m ? m.length : 0;
}

// 抽出单个 <section>…</section>（render 阶段每页只回一张卡）
export function extractSection(text) {
  const s = text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
  const m = s.match(/<section[\s\S]*<\/section>/i);
  return m ? m[0] : "";
}

// 抽出一个 <style>…</style>（design 阶段的全局设计系统）
export function extractStyle(text) {
  const s = text.replace(/^```(?:css|html)?\s*/i, "").replace(/```\s*$/i, "");
  const m = s.match(/<style[\s\S]*<\/style>/i);
  return m ? m[0] : "";
}
