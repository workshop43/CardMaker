/* =============================================================
   CardMaker AI — 可选模块：填 API Key，让大模型按脚手架生成 deck
   引入方式（放在 cardmaker.js 之后）：
     <script src="cardmaker.js"></script>
     <script src="cardmaker-ai.js"></script>

   纯前端直连大模型（无后端）。Key 仅存在本地浏览器（localStorage）。
   支持「OpenAI 兼容」(OpenAI / DeepSeek / Moonshot / OpenRouter / 本地…)
   与「Anthropic (Claude)」。
   ============================================================= */
(function (global) {
  "use strict";
  if (!global.CardMaker) {
    console.warn("[cardmaker-ai] 未找到 CardMaker，请先引入 cardmaker.js");
    return;
  }

  // 只在本地保存「选了哪个服务商」和「Key」；base/model 来自配置文件，不存
  var LS = {
    provider: "cm_ai_provider",
    key: "cm_ai_key",
    remember: "cm_ai_remember",
  };

  // 服务商的 base / model 来自配置文件 cardmaker.config.js（用户不填）
  var CFG = global.CardMakerConfig || {};
  var PROVIDERS = CFG.providers || {
    deepseek: { label: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-v4-flash" },
    qwen: { label: "通义千问 Qwen", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.5-flash" },
    minimax: { label: "MiniMax", base: "https://api.minimax.chat/v1", model: "minimax-m3" },
  };
  var DEFAULT_PROVIDER =
    CFG.defaultProvider && PROVIDERS[CFG.defaultProvider]
      ? CFG.defaultProvider
      : Object.keys(PROVIDERS)[0];

  // 各比例的画布取向（只讲这个比例适合怎么排，不规定用什么组件——布局你自由设计）
  var PRESET_TIP = {
    ppt: "16:9 横向演示稿（1280×720，纵向很矮）。文档型 keynote：每页讲清一个主题的多个侧面，标题领衔、要点/数据【横向铺开】，纵向克制别堆太高（放不下就拆页）。",
    story: "9:16 全屏竖版海报（高而窄）：纵向充裕，大字标题领衔，自上而下叙事，可承接多组结构化要点。",
    square: "1:1 方形卡片：构图均衡居中，内容精炼而充实。",
    xiaohongshu: "3:4 小红书竖版：干货信息卡，标题抓眼，正文给 3~5 条结构化干货，底部留署名——让人想截图收藏。",
  };

  // 一页 freeform 示例：展示「自带 <style> + 自定义布局 + 设计令牌」的自由度（供 LLM 理解结构，非模板）
  var FREEFORM_SAMPLE = [
    "<style>",
    ".s{display:flex;flex-direction:column;gap:30px;height:100%}",
    ".s-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}",
    ".s-card{background:rgba(255,255,255,.06);border:1px solid var(--cm-line);border-radius:20px;padding:28px}",
    ".s-l{font-size:64px;font-weight:900;color:var(--cm-accent);line-height:1}",
    "</style>",
    '<section class="card" data-theme="ocean">',
    '  <div class="s">',
    '    <div><h1>什么是 FAB？</h1><p style="color:var(--cm-muted)">把产品语言，翻译成用户买点</p></div>',
    '    <div class="s-grid">',
    '      <div class="s-card"><div class="s-l">F</div><h3>特征 Feature</h3><p style="color:var(--cm-muted)">客观存在的事实、参数、配置。</p></div>',
    '      <div class="s-card"><div class="s-l">A</div><h3>优势 Advantage</h3><p style="color:var(--cm-muted)">比竞品好在哪、性能提升。</p></div>',
    '      <div class="s-card"><div class="s-l">B</div><h3>利益 Benefit</h3><p style="color:var(--cm-muted)">对用户的价值与情感收益。</p></div>',
    "    </div>",
    "  </div>",
    "</section>",
  ].join("\n");

  // 系统提示词：给 LLM 完全的版式/视觉自由（自己写 HTML+CSS），引擎只兜底物理约束
  function systemPrompt(preset, pages) {
    var P = global.CardMaker.PRESETS[preset];
    var lines = [
      "你是世界顶尖的中文演示/卡片设计师。你对版式与视觉拥有【完全的创作自由】——自己写 HTML 结构和 CSS，不受任何固定组件限制。目标：一套读完即懂、信息充实、风格统一、视觉精致的卡片。",
      "",
      "【输出格式（只有这几条硬性要求）】",
      "- 先可选输出【一个】<style>…</style>（你的设计系统：自定义 class、布局、配色变量），随后按页顺序输出若干 <section class=\"card\" data-theme=\"主题\">…</section>，每页一个 section，共 " + pages + " 页。",
      "- 唯一结构约束：每页是一个 <section class=\"card\">；内部布局与样式完全由你设计。",
      "- 禁止 <html>/<head>/<body>、``` 代码围栏、任何解释文字；禁止 <script>、外链图片/字体/CSS。需要特殊字体用 data-font（运行时安全加载并在导出时嵌入）。",
      "- 卡内内容会被运行时包进一个自适配层，CSS 请用后代选择器（.card .x），不要用 .card > .x 直接子选择器。",
      "",
      "【画布与引擎保证 · 放心设计】",
      "- 画布固定为 " + P.label + "（" + P.w + "×" + P.h + "px），按此尺寸设计。",
      "- 运行时为你兜底三件事：① auto-fit——内容略超会自动等比缩小、绝不裁切；② 对比度护栏——即便自定义背景，文字也会保持可读；③ 一键导出高清图。",
      "- 所以大胆设计、不必像素级较真；但别在矮画布上疯狂堆内容（放不下就拆成更多页，而非硬塞到缩字）。",
      "",
      "【风格 · 选一种，贯穿全套】",
      "- 为整套选定【一种】视觉风格并贯穿每页：统一的配色、字体、间距节奏、装饰母题。按主题气质自选，例如：现代编辑/杂志风、科技暗黑、极简大留白、商务咨询、国风雅致、活泼潮流、数据看板、胶片复古……",
      "- 配色两种方式任选：(a) 直接用现成 data-theme 调色板：light dark warm ink mint gradient ocean sky sunset forest paper bold pastel tech cream night（深色风就选深色主题，背景+文字对比已配好）；(b) 在你的 <style>/内联里用设计令牌自定义。",
      "- ⚠ 自定义背景务必同时设文字色：深底配浅字、浅底配深字，别只改 --cm-card-bg 不改 --cm-fg。",
      "- 设计令牌（可引用/覆盖，已按比例调好，复用保证协调）：--cm-fg 文字 · --cm-bg/--cm-card-bg 背景 · --cm-accent 强调(其上文字 --cm-accent-fg) · --cm-muted 次要 · --cm-line 描边；字阶 --cm-h1/--cm-h2/--cm-h3/--cm-text；间距 --cm-pad/--cm-gap。",
      "- 字体 data-font：hei(现代黑) song(编辑宋) kai(文学楷) smiley(潮流标题) xiaowei(文艺) kuaile(活泼) mao(书法)。按气质选一款贯穿；不写则用系统苹方。",
      "",
      "【内容 · 文档级密度，逐页有层次】",
      "- 每个内容页 = 一个能独立读懂的小章节：清晰标题 + 结构化、有层级的内容（不是一句话一页）。信息充实但靠【结构与层级】组织，不堆长段落。",
      "- 逐页变换版式（分栏/网格/时间线/大数据/对比/引言…由你设计），善用留白、层级、强调色、数据、母题，让每页都有视觉重点。",
      "- 以『全字号放得下』为前提充实：放不下就拆页，绝不缩字硬塞。",
      "",
      "【本比例取向】" + (PRESET_TIP[preset] || PRESET_TIP.xiaohongshu),
      "",
      "【一页 freeform 示例 · 仅供理解自由度与结构；配色/风格请按主题另选，切勿照抄】",
      FREEFORM_SAMPLE,
    ];
    return lines.join("\n");
  }


  // ---------- 大模型调用（OpenAI 兼容 /chat/completions，流式） ----------
  // content 用字符串——DeepSeek V4 / OpenAI 标准格式（官方文档：content 为 string）。
  // onDelta(fullContent)：正文(卡片 HTML)增量；onThink(fullReasoning)：思考模式 reasoning_content 增量。
  function callModel(cfg, sys, user, onDelta, onThink) {
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
      var ct = res.headers.get("content-type") || "";
      // 服务端不支持流式（返回整段 JSON）时降级处理
      if (!res.body || ct.indexOf("text/event-stream") === -1) {
        return res.text().then(function (t) {
          var j = JSON.parse(t);
          var msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
          if (onThink && msg.reasoning_content) onThink(msg.reasoning_content);
          var c = msg.content || "";
          if (onDelta) onDelta(c);
          return c;
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      var full = "";
      var reasoning = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return full;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line.indexOf("data:") !== 0) return;
            var data = line.slice(5).trim();
            if (!data || data === "[DONE]") return;
            try {
              var j = JSON.parse(data);
              var delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (!delta) return;
              // 思考模式：DeepSeek V4 等先流式 reasoning_content（思维链），再流 content（正文）
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
      var data;
      try { data = JSON.parse(t); } catch (e) { throw new Error("响应非 JSON（HTTP " + res.status + "）：" + t.slice(0, 160)); }
      if (!res.ok) {
        var msg = (data.error && (data.error.message || data.error.type)) || ("HTTP " + res.status);
        throw new Error(msg);
      }
      return data;
    });
  }

  // 从模型输出里提取干净的卡片 HTML
  function extractCards(text) {
    var s = text.trim();
    s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
    var sec = s.indexOf("<section");
    var sty = s.indexOf("<style");
    var first = sec;
    if (sty !== -1 && sty < sec) first = sty; // deck 级 <style> 在首个 <section> 之前则一并保留
    var last = s.lastIndexOf("</section>");
    if (first !== -1 && last !== -1) s = s.slice(first, last + "</section>".length);
    return s;
  }

  // ---------- 面板 UI ----------
  injectStyles();

  function injectStyles() {
    var css =
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
      ".cmai footer{display:flex;align-items:center;gap:12px;padding:16px 24px;border-top:1px solid rgba(255,255,255,.08)}" +
      ".cmai .cmai-status{flex:1;font-size:13px;color:#9aa0ad;min-height:18px;display:flex;align-items:center;gap:9px}" +
      ".cmai .cmai-status.err{color:#f87171}" +
      ".cmai .cmai-hint{font-size:12px;color:#6b7280;line-height:1.5}" +
      ".cmai a{color:var(--cm-accent,#8b8bf5)}" +
      ".cmai-spin{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:var(--cm-accent,#8b8bf5);animation:cmai-rot .7s linear infinite}" +
      "@keyframes cmai-rot{to{transform:rotate(360deg)}}" +
      // 生成中：全屏蒙版 + 双栏（左构思内容 / 右生成排版）
      ".cmai-gen{position:fixed;inset:0;z-index:205;display:none;align-items:center;justify-content:center;background:rgba(8,8,12,.82);backdrop-filter:blur(6px);font-family:var(--cm-font-sans,system-ui);color:#e9e9ee}" +
      ".cmai-gen.is-show{display:flex}" +
      ".cmai-gen-box{width:min(900px,94vw);height:min(620px,86vh);background:#14151b;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}" +
      ".cmai-gen-head{position:relative;display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);font-size:15px}" +
      ".cmai-gen-title{font-weight:600}" +
      ".cmai-gen-count{margin-left:auto;color:#9aa0ad;font-variant-numeric:tabular-nums}" +
      ".cmai-gen-head .cmai-pbar{position:absolute;left:0;bottom:0;height:3px;width:0;background:var(--cm-accent,#8b8bf5);transition:width .3s}" +
      ".cmai-gen-cols{flex:1;display:flex;min-height:0}" +
      ".cmai-gen-col{flex:1;display:flex;flex-direction:column;min-width:0;padding:16px 20px}" +
      ".cmai-gen-col+.cmai-gen-col{border-left:1px solid rgba(255,255,255,.08)}" +
      ".cmai-gen-label{font-size:12px;color:#7c8190;letter-spacing:1px;margin-bottom:10px;flex:none}" +
      ".cmai-gen-stream{flex:1;overflow:auto;font-family:var(--cm-font-mono,monospace);font-size:12px;line-height:1.65;color:#9fb3c8;white-space:pre-wrap;word-break:break-all}" +
      ".cmai-gen-prevwrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}" +
      ".cmai-gen-prevwrap .cmai-prev{overflow:hidden;border-radius:10px;box-shadow:0 10px 36px rgba(0,0,0,.45)}" +
      "@media(max-width:640px){.cmai-gen-cols{flex-direction:column}.cmai-gen-col+.cmai-gen-col{border-left:none;border-top:1px solid rgba(255,255,255,.08)}}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  function field(label, inputHtml, hint) {
    return (
      '<div><label>' + label + "</label>" + inputHtml +
      (hint ? '<div class="cmai-hint" style="margin-top:6px">' + hint + "</div>" : "") +
      "</div>"
    );
  }

  function buildPanel(app) {
    var presets = global.CardMaker.PRESETS;
    var presetOpts = Object.keys(presets)
      .map(function (k) { return '<option value="' + k + '">' + presets[k].label + "</option>"; })
      .join("");
    var providerOpts = Object.keys(PROVIDERS)
      .map(function (k) { return '<option value="' + k + '">' + PROVIDERS[k].label + "</option>"; })
      .join("");
    var mask = document.createElement("div");
    mask.className = "cmai-mask";
    mask.innerHTML =
      '<div class="cmai" role="dialog">' +
      "<header><h3>AI 生成卡片</h3><button class=\"cmai-x\" data-close>×</button></header>" +
      '<div class="cmai-body">' +
      field("主题 / 要求", '<textarea data-topic placeholder="例：做一张讲「3 个时间管理技巧」的小红书卡，语气轻松。"></textarea>') +
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

    var $ = function (sel) { return mask.querySelector(sel); };
    var els = {
      mask: mask,
      topic: $("[data-topic]"),
      preset: $("[data-preset]"),
      pages: $("[data-pages]"),
      provider: $("[data-provider]"),
      modelinfo: $("[data-modelinfo]"),
      key: $("[data-key]"),
      remember: $("[data-remember]"),
      status: $("[data-status]"),
      go: $("[data-go]"),
    };

    // 载入已存配置（只恢复服务商与 Key，base/model 永远来自配置文件）
    var savedProvider = localStorage.getItem(LS.provider) || DEFAULT_PROVIDER;
    els.provider.value = PROVIDERS[savedProvider] ? savedProvider : DEFAULT_PROVIDER;
    els.remember.checked = localStorage.getItem(LS.remember) === "1";
    if (els.remember.checked) els.key.value = localStorage.getItem(LS.key) || "";
    els.preset.value = app.preset;
    showModelInfo(els);

    // 切换服务商时更新模型提示
    els.provider.onchange = function () { showModelInfo(els); };

    Array.prototype.forEach.call(mask.querySelectorAll("[data-close]"), function (b) {
      b.onclick = function () { mask.classList.remove("is-open"); };
    });
    mask.addEventListener("click", function (e) { if (e.target === mask) mask.classList.remove("is-open"); });

    els.go.onclick = function () { generate(app, els); };

    return els;
  }

  // 显示当前服务商将使用的模型（只读提示，取自配置文件）
  function showModelInfo(els) {
    var p = PROVIDERS[els.provider.value];
    els.modelinfo.textContent = p ? "模型：" + p.model : "";
  }

  function setStatus(els, msg, isErr) {
    els.status.textContent = msg || "";
    els.status.className = "cmai-status" + (isErr ? " err" : "");
  }

  // 浏览器里 performance.now / Date.now 均可用
  function nowTs() {
    return (window.performance && performance.now ? performance.now() : new Date().getTime());
  }

  function countCards(html) {
    var m = html.match(/<\/section>/g);
    return m ? m.length : 0;
  }

  // ---- 生成中蒙版：左「构思内容」流式文本 / 右「生成排版」实时预览 ----
  var _gen = null;
  function genEl() {
    if (_gen) return _gen;
    var el = document.createElement("div");
    el.className = "cmai-gen";
    el.innerHTML =
      '<div class="cmai-gen-box">' +
      '<div class="cmai-gen-head"><span class="cmai-spin"></span>' +
      '<span class="cmai-gen-title">正在生成排版…</span>' +
      '<span class="cmai-gen-count"></span><div class="cmai-pbar"></div></div>' +
      '<div class="cmai-gen-cols">' +
      '<div class="cmai-gen-col"><div class="cmai-gen-label">构思内容</div><div class="cmai-gen-stream" data-stream></div></div>' +
      '<div class="cmai-gen-col"><div class="cmai-gen-label">生成排版</div><div class="cmai-gen-prevwrap" data-prev></div></div>' +
      "</div></div>";
    document.body.appendChild(el);
    _gen = {
      el: el,
      stream: el.querySelector("[data-stream]"),
      prev: el.querySelector("[data-prev]"),
      count: el.querySelector(".cmai-gen-count"),
      bar: el.querySelector(".cmai-pbar"),
    };
    return _gen;
  }
  var WAIT_HINT = "正在等待模型响应…\n首字通常几秒到十几秒（取决于模型与网络），收到后会在这里实时刷出，请稍候。";
  function genShow() {
    var g = genEl();
    g._got = false; // 是否已收到首段内容
    g.stream.textContent = WAIT_HINT;
    g.stream.style.opacity = "0.55";
    g.prev.innerHTML = '<div style="color:#5b606e;font-size:13px">完成第一张卡片后在此预览</div>';
    g.count.textContent = "";
    g.bar.style.width = "0";
    g.el.classList.add("is-show");
  }
  function genHide() { if (_gen) _gen.el.classList.remove("is-show"); }
  function genStream(text) {
    var g = genEl();
    if (!text) return;
    if (!g._got) { g._got = true; g.stream.style.opacity = "1"; } // 首段到达，去掉占位的弱化
    g.stream.textContent = text;
    g.stream.scrollTop = g.stream.scrollHeight; // 自动滚到底
  }
  function genStatus(n, total, secs) {
    var g = genEl();
    g.count.textContent = (n ? n + "/" + total + " 张 · " : "构思中 · ") + secs + "s";
    g.bar.style.width = Math.round((total ? n / total : 0) * 100) + "%";
  }
  // 渲染最新一张完成的卡片作为缩略预览：复用引擎的 renderThumb，和主舞台渲染完全一致
  // （含 deck 级 <style> + fitbox 居中 + auto-fit + 对比度护栏，修复此前丢 <style>、内容错位的问题）
  function genPreview(html, preset) {
    var g = genEl();
    var boxW = Math.min(280, g.prev.clientWidth || 280);
    global.CardMaker.renderThumb(html, preset, g.prev, boxW);
  }

  function generate(app, els) {
    var topic = els.topic.value.trim();
    if (!topic) return setStatus(els, "请先填写主题。", true);
    var provider = els.provider.value;
    var p = PROVIDERS[provider];
    if (!p || !p.base || !p.model) return setStatus(els, "配置文件中未找到该服务商的 base/model。", true);
    var cfg = { base: p.base, model: p.model, key: els.key.value.trim() };
    if (!cfg.key) return setStatus(els, "请填写 API Key。", true);
    _lastCfg = cfg; // 记住本次配置，供「✦ 修改」复用

    if (els.remember.checked) {
      localStorage.setItem(LS.remember, "1");
      localStorage.setItem(LS.provider, provider);
      localStorage.setItem(LS.key, cfg.key);
    } else {
      Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
    }

    var preset = els.preset.value;
    var pages = parseInt(els.pages.value, 10) || 5;
    app.setPreset(preset);
    var sys = systemPrompt(preset, pages);

    // 关掉设置弹窗，打开全屏「生成中」蒙版（盖住下面的内容）
    els.mask.classList.remove("is-open");
    setStatus(els, "");
    genShow();

    var startTs = nowTs();
    var lastCount = 0;
    var timer = setInterval(function () {
      genStatus(lastCount, pages, Math.round((nowTs() - startTs) / 1000));
    }, 250);

    // 思考阶段（reasoning_content）先在左栏显示模型的思维链；正文一开始就切到正文
    var contentStarted = false;
    function onThink(reasoning) {
      if (!contentStarted) genStream(reasoning);
    }
    // 正文流：左栏显示正文增量；每出完一张就在右栏预览生成排版（不污染主舞台）
    function onDelta(full) {
      contentStarted = true;
      genStream(full);
      var html = extractCards(full);
      var n = countCards(html);
      if (n > lastCount) {
        lastCount = n;
        genPreview(html, preset);
      }
    }

    callModel(cfg, sys, topic, onDelta, onThink)
      .then(function (text) {
        var html = extractCards(text);
        if (html.indexOf("<section") === -1) throw new Error("模型未返回有效卡片，请调整主题或更换模型重试。");
        clearInterval(timer);
        app.setHTML(html); // 一次性灌入成品
        app.goTo(0);
        genHide(); // 蒙版淡出，露出成品 deck
      })
      .catch(function (err) {
        clearInterval(timer);
        genHide();
        // 出错：把设置弹窗重新打开，展示错误，便于调整重试
        setStatus(els, "失败：" + err.message, true);
        els.mask.classList.add("is-open");
      });
  }

  // ========== AI 修改：把整套 deck + 修改要求喂给模型，可改当页/某几页/整套风格 ==========
  var _lastCfg = null; // 上次成功配置 {base,model,key}，供「✦ 修改」复用

  function resolveCfg() {
    if (_lastCfg && _lastCfg.key) return _lastCfg;
    var provider = localStorage.getItem(LS.provider) || DEFAULT_PROVIDER;
    var p = PROVIDERS[provider];
    var key = localStorage.getItem(LS.key);
    if (p && key) return { base: p.base, model: p.model, key: key };
    return null;
  }

  function editSystemPrompt(preset, idx, total) {
    var P = global.CardMaker.PRESETS[preset];
    return (
      "你在修改一套已有的卡片 deck。下面给你【整套 deck 的当前 HTML】作为【只读上下文】——含一个可选的 deck 级 <style>，以及每页前都带页码注释 <!--PAGE n--> 的 <section>。\n" +
      "【最重要的规则：只输出你改动的部分，绝不重复未改动的页，也不要重输出整套。】\n" +
      "- 改某一页：输出 <!--PAGE n--> 紧跟那一页【修改后的完整 <section>…</section>】。n = 页码（从 1 起）。\n" +
      "- 改多页：每改一页就来一组「<!--PAGE n--> + <section>」。\n" +
      "- 改整套配色/风格/字体：优先改公共样式——输出 <!--STYLE--> 紧跟【修改后的完整 <style>…</style>】（它对所有页生效，通常不必逐页改）。\n" +
      "- 用户没说改哪页时，默认只改其当前停留的第 " + (idx + 1) + " / " + total + " 页（输出 <!--PAGE " + (idx + 1) + "--> + 这一页）。\n" +
      "- 没改到的页，一个字都不要输出。\n" +
      "你对要改的页有完全的版式/视觉自由（自由写 HTML、内联 CSS，或改 deck <style>），但保持与整套风格一致。画布 " + P.label + "（" + P.w + "×" + P.h + "px），运行时自动缩放兜底、保证文字对比度。\n" +
      "禁止解释文字、``` 代码围栏、<html>/<head>/<body>、<script>、外链资源；换字体用 data-font。\n" +
      "本比例取向：" + (PRESET_TIP[preset] || PRESET_TIP.xiaohongshu)
    );
  }

  // 给整套 deck 的每页前注入 <!--PAGE n--> 页码注释，作为修改时的只读上下文
  function editContext(app) {
    var n = 0;
    return app.getHTML().replace(/<section\b/g, function () { n++; return "<!--PAGE " + n + "-->\n<section"; });
  }

  // 解析「只输出改动部分」的结果：按 <!--PAGE n--> / <!--STYLE--> 标记拆出补丁
  // 返回 { style:null|"<style>…", pages:{ 索引: "<section>…" } }；没有标记时整段当作"改当前页"
  function parseEditOutput(text, defaultIdx) {
    var s = text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
    var patch = { style: null, pages: {} };
    var re = /<!--\s*(PAGE\s+(\d+)|STYLE)\s*-->/gi, marks = [], m;
    while ((m = re.exec(s))) marks.push({ start: m.index, end: re.lastIndex, page: m[2] ? parseInt(m[2], 10) : null });
    if (!marks.length) {
      var sec0 = (s.match(/<section[\s\S]*?<\/section>/i) || [])[0];
      if (sec0) patch.pages[defaultIdx] = sec0; // 没标记：当作只改当前页
      return patch;
    }
    for (var i = 0; i < marks.length; i++) {
      var seg = s.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : undefined);
      if (marks[i].page == null) {
        var st = (seg.match(/<style[\s\S]*?<\/style>/i) || [])[0]; if (st) patch.style = st;
      } else {
        var se = (seg.match(/<section[\s\S]*?<\/section>/i) || [])[0]; if (se) patch.pages[marks[i].page - 1] = se;
      }
    }
    return patch;
  }

  function buildEdit(app) {
    var mask = document.createElement("div");
    mask.className = "cmai-mask";
    mask.innerHTML =
      '<div class="cmai" role="dialog">' +
      "<header><h3>AI 修改</h3><button class=\"cmai-x\" data-close>×</button></header>" +
      '<div class="cmai-body">' +
      field("修改要求", '<textarea data-fb placeholder="例：这页改成左右两栏 / 第 2-4 页配色换成深色 / 整套换成杂志风 / 把所有标题再大一点"></textarea>',
        "AI 看得到整套内容,但【只改你要改的页】、不会重写整套。没说改哪页时默认改当前页;改整套风格会动公共样式、一次生效。") +
      "</div>" +
      "<footer><div class=\"cmai-status\" data-status></div>" +
      '<button class="cm-btn" data-close>取消</button>' +
      '<button class="cm-btn cm-primary" data-go>修改</button></footer>' +
      "</div>";
    document.body.appendChild(mask);
    var els = {
      mask: mask,
      fb: mask.querySelector("[data-fb]"),
      status: mask.querySelector("[data-status]"),
      go: mask.querySelector("[data-go]"),
    };
    Array.prototype.forEach.call(mask.querySelectorAll("[data-close]"), function (b) {
      b.onclick = function () { mask.classList.remove("is-open"); };
    });
    mask.addEventListener("click", function (e) { if (e.target === mask) mask.classList.remove("is-open"); });
    els.go.onclick = function () { applyEdit(app, els); };
    return els;
  }

  // 修改：把整套 deck 作【只读上下文】给模型，模型只回【改动的页/公共样式】，运行时局部打补丁。
  // 既快又不会动到没让改的页（不再整套重写）。
  function applyEdit(app, els) {
    if (!app.cards.length) return setStatus(els, "当前没有可修改的内容。", true);
    var cfg = resolveCfg();
    if (!cfg) return setStatus(els, "请先用「✦ AI 生成」设置好服务商与 API Key。", true);

    var idx = app.index, total = app.cards.length, preset = app.preset;
    var feedback = els.fb.value.trim() ||
      "优化当前这一页（第 " + (idx + 1) + " 页）的排版与设计，使其更专业、信息清晰、不溢出。";
    var sys = editSystemPrompt(preset, idx, total);
    var user =
      "整套 deck（只读上下文，每页前有 <!--PAGE n--> 页码注释）：\n" + editContext(app) +
      "\n\n修改要求：" + feedback +
      "\n\n只输出改动的部分：改某页 → <!--PAGE n--> + 该页 <section>；改公共样式 → <!--STYLE--> + <style>。没改到的页不要输出。";

    els.mask.classList.remove("is-open");
    genShow();
    var startTs = nowTs();
    var timer = setInterval(function () { genStatus(0, 1, Math.round((nowTs() - startTs) / 1000)); }, 250);

    var started = false;
    function onThink(r) { if (!started) genStream(r); }
    function onDelta(full) {
      started = true;
      genStream(full);
      var h = extractCards(full); // 流式预览改动的页
      if (h.indexOf("<section") !== -1) genPreview(h, preset);
    }
    callModel(cfg, sys, user, onDelta, onThink)
      .then(function (text) {
        var patch = parseEditOutput(text, idx);
        var nPages = Object.keys(patch.pages).length;
        if (!patch.style && nPages === 0) throw new Error("模型没返回可应用的改动，请把要求说得更具体后重试。");
        clearInterval(timer);
        app.patchDeck(patch); // 只替换改动的页/样式，其余原样保留
        genHide();
      })
      .catch(function (err) {
        clearInterval(timer);
        genHide();
        setStatus(els, "失败：" + err.message, true);
        els.mask.classList.add("is-open");
      });
  }

  // ---------- 接入运行时 ----------
  global.CardMaker.ready(function (app) {
    var els = null, editEls = null;
    function openPanel() {
      if (!els) els = buildPanel(app);
      els.preset.value = app.preset;
      els.mask.classList.add("is-open");
      setStatus(els, "");
      setTimeout(function () { els.topic.focus(); }, 50);
    }
    function openEdit() {
      if (!app.cards.length) return;
      if (!editEls) editEls = buildEdit(app);
      editEls.fb.value = "";
      setStatus(editEls, "");
      editEls.mask.classList.add("is-open");
      setTimeout(function () { editEls.fb.focus(); }, 50);
    }
    app.addToolButton("✦ 修改", openEdit, {});
    app.addToolButton("✦ AI 生成", openPanel, { primary: true });
  });
})(window);
