/* =============================================================
   CardMaker 运行时
   把页面里的 <section class="card"> 变成可放映、可一键出图的 deck。

   用法（一个 deck = 一个 HTML 文件）：
     <link rel="stylesheet" href="cardmaker.css">
     <div data-cardmaker data-preset="xiaohongshu">
       <section class="card" data-theme="gradient">...</section>
       <section class="card">...</section>
     </div>
     <script src="cardmaker.js"></script>

   也可手动初始化：const app = new CardMaker({ root, preset });
   ============================================================= */
(function (global) {
  "use strict";

  var PRESETS = {
    xiaohongshu: { w: 1080, h: 1440, label: "小红书 3:4" },
    square: { w: 1080, h: 1080, label: "方形 1:1" },
    ppt: { w: 1280, h: 720, label: "PPT 16:9" },
    story: { w: 1080, h: 1920, label: "竖屏 9:16" },
  };

  // 各比例的内置示例（左上角比例选择器切换时载入，方便预览不同比例的效果）
  var DEMOS = {
    xiaohongshu: `
      <section class="card cm-middle" data-theme="sunset" data-font="song">
        <div class="cm-kicker">每日精进</div>
        <h1 class="cm-display">3 个<br>高效习惯</h1>
        <p class="cm-lead cm-mt">把自律，变成肌肉记忆。</p>
        <div class="cm-footer"><span>@CardMaker</span><span>← 滑动 →</span></div>
      </section>
      <section class="card" data-theme="sunset" data-font="song">
        <div class="cm-kicker">行动清单</div><h2>今天就试</h2>
        <ul class="cm-checklist cm-mt">
          <li><strong>晨间三件事</strong>：起床先列今天最重要的三件事。</li>
          <li><strong>专注 25 分钟</strong>：番茄钟起步，先做最难的。</li>
          <li><strong>睡前一句话</strong>：写下今天的收获与明天第一步。</li>
        </ul>
        <div class="cm-footer"><span>@CardMaker</span><span>收藏 + 关注</span></div>
      </section>`,
    square: `
      <section class="card cm-middle cm-text-center" data-theme="mint">
        <div class="cm-kicker">数据说话</div>
        <div class="cm-stat-num" style="font-size:200px">21<span style="font-size:.4em">天</span></div>
        <p class="cm-lead">一个习惯成型的周期。</p>
        <div class="cm-footer"><span>@CardMaker</span><span>每日精进</span></div>
      </section>
      <section class="card cm-middle" data-theme="mint">
        <div class="cm-quote-mark">"</div>
        <div class="cm-quote-text">你如何度过一天，<br>就如何度过一生。</div>
        <p class="cm-muted cm-mt">— 安妮·迪拉德</p>
      </section>`,
    ppt: `
      <style>.d-g{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
      .d-c{background:rgba(255,255,255,.06);border:1px solid var(--cm-line);border-radius:18px;padding:26px}
      .d-l{font-size:56px;font-weight:900;color:var(--cm-accent);line-height:1}</style>
      <section class="card cm-middle cm-text-center" data-theme="night">
        <div class="cm-kicker">营销方法论</div>
        <h1 class="cm-display">FAB 卖点拆解法</h1>
        <p class="cm-lead cm-mt">把产品语言，翻译成用户买点。</p>
      </section>
      <section class="card" data-theme="night">
        <div class="cm-header"><div>FAB 黄金结构</div><div class="cm-sm">核心框架</div></div>
        <div class="d-g">
          <div class="d-c"><div class="d-l">F</div><h3>特征 Feature</h3><p style="color:var(--cm-muted)">客观存在的功能、参数、配置。</p></div>
          <div class="d-c"><div class="d-l">A</div><h3>优势 Advantage</h3><p style="color:var(--cm-muted)">比竞品好在哪、相对优势。</p></div>
          <div class="d-c"><div class="d-l">B</div><h3>利益 Benefit</h3><p style="color:var(--cm-muted)">对用户的价值与情感收益。</p></div>
        </div>
        <div class="cm-footer"><span>FAB 拆解法</span><span>2 / 2</span></div>
      </section>`,
    story: `
      <section class="card cm-middle" data-theme="gradient" data-font="smiley">
        <div class="cm-kicker">招聘海报</div>
        <h1 class="cm-display">我们<br>在找你</h1>
        <p class="cm-lead cm-mt">前端工程师 · 远程优先 · 弹性工作。</p>
        <div class="cm-mt-lg"><span class="cm-tag">投递 → hi@cardmaker.dev</span></div>
        <div class="cm-footer"><span>@CardMaker</span><span>扫码了解 ↓</span></div>
      </section>
      <section class="card" data-theme="gradient" data-font="smiley">
        <div class="cm-kicker">你将拥有</div><h2>三件好东西</h2>
        <ul class="cm-checklist cm-mt">
          <li><strong>有意思的活</strong>：做让百万人用的产品。</li>
          <li><strong>说人话的团队</strong>：扁平、透明、少开会。</li>
          <li><strong>能成长</strong>：预算管够的学习与设备。</li>
        </ul>
        <div class="cm-footer"><span>@CardMaker</span><span>← 滑动 →</span></div>
      </section>`,
  };

  // 出图依赖按需从 CDN 懒加载，零构建。
  var CDN = {
    htmlToImage: "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js",
    jszip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  };

  // CodeMirror 5（编辑器，打开编辑面板时才懒加载；失败则退回 textarea）
  var CM_VER = "5.65.16";
  var CM_BASE = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/" + CM_VER + "/";
  var CM_CSS = [CM_BASE + "codemirror.min.css", CM_BASE + "theme/material-darker.min.css"];
  var CM_CORE = CM_BASE + "codemirror.min.js";
  var CM_MODES = [
    CM_BASE + "mode/xml/xml.min.js",
    CM_BASE + "mode/javascript/javascript.min.js",
    CM_BASE + "mode/css/css.min.js",
  ];
  var CM_HTMLMIXED = CM_BASE + "mode/htmlmixed/htmlmixed.min.js";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("加载失败: " + src)); };
      document.head.appendChild(s);
    });
  }

  function loadCss(href) {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }

  // 可选中文 web 字体注册表。deck 或单卡用 data-font="key" 选用，按需从 CDN 懒加载。
  // family 为 CSS font-family；css 为字体样式表地址（均 CORS 友好，可被 html-to-image 嵌入导出）。
  var FONTS = {
    hei:     { label: "思源黑体（现代）", family: "'Noto Sans SC', sans-serif",  css: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap" },
    song:    { label: "思源宋体（编辑）", family: "'Noto Serif SC', serif",     css: "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700;900&display=swap" },
    kai:     { label: "霞鹜文楷（文学）", family: "'LXGW WenKai', serif",        css: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont/style.css" },
    smiley:  { label: "得意黑（潮流标题）", family: "'Smiley Sans', sans-serif",  css: "https://cdn.jsdelivr.net/npm/smiley-sans/index.css" },
    xiaowei: { label: "站酷小薇（文艺宋）", family: "'ZCOOL XiaoWei', serif",     css: "https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap" },
    kuaile:  { label: "站酷快乐体（活泼）", family: "'ZCOOL KuaiLe', cursive",    css: "https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap" },
    mao:     { label: "马善政（毛笔书法）", family: "'Ma Shan Zheng', cursive",   css: "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap" },
  };
  var _fontLoaded = {};
  function ensureFont(key) {
    if (_fontLoaded[key] || !FONTS[key] || !FONTS[key].css) return;
    _fontLoaded[key] = true;
    loadCss(FONTS[key].css);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function CardMaker(opts) {
    opts = opts || {};
    this.source =
      typeof opts.root === "string"
        ? document.querySelector(opts.root)
        : opts.root || document.querySelector("[data-cardmaker]");
    if (!this.source) throw new Error("CardMaker: 找不到 [data-cardmaker] 容器");

    this.preset = opts.preset || this.source.getAttribute("data-preset") || "xiaohongshu";
    if (!PRESETS[this.preset]) this.preset = "xiaohongshu";
    this.title = opts.title || this.source.getAttribute("data-title") || document.title || "deck";
    this.font = opts.font || this.source.getAttribute("data-font") || ""; // deck 级默认字体
    this.store = "cardmaker:" + location.pathname; // 自动存档键（按页面区分）
    this.index = 0;
    this.cards = [];
    this._build();
    this._restore(); // 有上次的存档则恢复（刷新不丢失）
    this.refresh();

    var self = this;
    window.addEventListener("resize", function () { self._fit(); });
    // 舞台尺寸变化（开/关编辑器、分栏宽度变化等，不一定触发 window.resize）也要重新适配，
    // 否则 scale 会残留上一个布局的值，导致卡片偏大/偏位（看起来"跑到展示区下面"）。
    if (window.ResizeObserver && self.stage) {
      new ResizeObserver(function () { self._fit(); }).observe(self.stage);
    }
    document.addEventListener("keydown", function (e) { self._onKey(e); });
    // web 字体异步加载完成后，重新测量缩放（字体会影响排版尺寸）
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener("loadingdone", function () { self._autoFit(); });
    }
  }

  CardMaker.prototype._build = function () {
    var self = this;

    var app = el("div", "cm-app");
    app.setAttribute("data-preset", this.preset);

    // 工具栏：品牌 + 比例选择器（切换即载入该比例的内置示例）
    var bar = el("div", "cm-toolbar");
    var presetOpts = Object.keys(PRESETS).map(function (k) {
      return '<option value="' + k + '"' + (k === self.preset ? " selected" : "") + ">" + PRESETS[k].label + "</option>";
    }).join("");
    bar.innerHTML =
      '<div class="cm-brand"><b>CardMaker</b><select class="cm-preset" title="切换比例 · 预览各比例示例">' + presetOpts + "</select></div>";
    this.presetSel = bar.querySelector(".cm-preset");
    this.presetSel.onchange = function () { self.loadExample(self.presetSel.value); };
    this.btnEdit = el("button", "cm-btn", "编辑");
    this.btnPresent = el("button", "cm-btn", "放映");
    this.btnSave = el("button", "cm-btn", "保存 HTML");
    this.btnExport = el("button", "cm-btn", "导出本页");
    this.btnExportAll = el("button", "cm-btn cm-primary", "导出全部");
    bar.appendChild(this.btnEdit);
    bar.appendChild(this.btnPresent);
    bar.appendChild(this.btnSave);
    bar.appendChild(this.btnExport);
    bar.appendChild(this.btnExportAll);

    // 主体（编辑器 + 舞台）
    var body = el("div", "cm-body");
    this.editor = el("div", "cm-editor");
    this.textarea = el("textarea");
    this.textarea.spellcheck = false;
    this.editor.appendChild(this.textarea);

    var stage = el("div", "cm-stage");
    this.scaler = el("div", "cm-scaler");
    this.cardsWrap = el("div", "cm-cards");
    this.scaler.appendChild(this.cardsWrap);
    stage.appendChild(this.scaler);

    body.appendChild(this.editor);
    body.appendChild(stage);

    // 导航
    var nav = el("div", "cm-nav");
    this.btnPrev = el("button", "cm-btn", "‹");
    this.btnNext = el("button", "cm-btn", "›");
    this.counter = el("div", "cm-counter");
    this.dots = el("div", "cm-dots");
    nav.appendChild(this.btnPrev);
    nav.appendChild(this.dots);
    nav.appendChild(this.btnNext);
    nav.appendChild(this.counter);

    app.appendChild(bar);
    app.appendChild(body);
    app.appendChild(nav);

    this.toast = el("div", "cm-toast");
    app.appendChild(this.toast);

    // 把源容器替换为应用外壳，源卡片迁入 cardsWrap
    var parent = this.source.parentNode;
    parent.insertBefore(app, this.source);
    while (this.source.firstChild) this.cardsWrap.appendChild(this.source.firstChild);
    this.source.remove();

    this.app = app;
    this.stage = stage;

    var self = this;
    this.btnPrev.onclick = function () { self.prev(); };
    this.btnNext.onclick = function () { self.next(); };
    this.btnPresent.onclick = function () { self.present(); };
    this.btnExport.onclick = function () { self.exportCurrent(); };
    this.btnExportAll.onclick = function () { self.exportAll(); };
    this.btnEdit.onclick = function () { self.toggleEditor(); };
    this.btnSave.onclick = function () { self.downloadHTML(); };
    this.textarea.addEventListener("input", function () { self._applyEditor(); });
  };

  // 重新收集卡片（编辑后或初始化时调用）
  CardMaker.prototype.refresh = function () {
    this.cards = Array.prototype.slice.call(this.cardsWrap.querySelectorAll(".card"));
    if (this.index >= this.cards.length) this.index = Math.max(0, this.cards.length - 1);

    // 重建小圆点
    this.dots.innerHTML = "";
    var self = this;
    this.cards.forEach(function (c, i) {
      var dot = el("button", "cm-dot");
      dot.onclick = function () { self.goTo(i); };
      self.dots.appendChild(dot);
      // 先把作者内容包进 fitbox（装饰层留在外面垫底）
      self._ensureFitbox(c);
      // 不再自动注入平台页码——页码交给作者/AI 自行设计，避免和内容里的页码重复。
      // （若作者主动写了 <div class="cm-page">，_render 仍会把它填成「页/总」，作为可选功能。）
    });
    this._applyFonts();
    this._render();
    this._fixContrast(); // 同步先保证文字可读（不依赖 rAF，导出场景也稳）
    this._fit();
    this._autoFit();
    this._save();
  };

  // ---------- 存档：自动存到 localStorage，刷新自动恢复 ----------
  CardMaker.prototype._save = function () {
    var self = this;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(function () {
      try {
        var html = self.getHTML();
        if (!html || html.indexOf("<section") === -1) return;
        localStorage.setItem(self.store, JSON.stringify({
          preset: self.preset, font: self.font, title: self.title, html: html,
        }));
      } catch (e) { /* localStorage 不可用则忽略 */ }
    }, 400);
  };

  CardMaker.prototype._restore = function () {
    var raw;
    try { raw = localStorage.getItem(this.store); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.html || data.html.indexOf("<section") === -1) return;
    if (data.preset && PRESETS[data.preset]) {
      this.preset = data.preset;
      this.app.setAttribute("data-preset", data.preset);
      var sel = this.app.querySelector(".cm-preset");
      if (sel) sel.value = data.preset;
    }
    if (typeof data.font === "string") this.font = data.font;
    if (data.title) this.title = data.title;
    this.cardsWrap.innerHTML = data.html;
    this.index = 0;
  };

  // 应用内确认弹窗（替代原生 confirm：必定可见、风格统一、不受浏览器抑制）
  CardMaker.prototype._confirm = function (msg, onYes) {
    var mask = el("div", "cm-confirm-mask");
    var box = el("div", "cm-confirm");
    var p = el("p");
    p.textContent = msg;
    var btns = el("div", "cm-confirm-btns");
    var cancel = el("button", "cm-btn", "取消");
    var ok = el("button", "cm-btn cm-primary", "确定");
    btns.appendChild(cancel);
    btns.appendChild(ok);
    box.appendChild(p);
    box.appendChild(btns);
    mask.appendChild(box);
    this.app.appendChild(mask);
    function close() { mask.remove(); }
    cancel.onclick = close;
    mask.onclick = function (e) { if (e.target === mask) close(); };
    ok.onclick = function () { close(); onYes(); };
  };

  // 保存为自包含 HTML 文件：同源的 cardmaker.css/js 内联进去，双击即可打开、再编辑、再出图
  CardMaker.prototype.downloadHTML = function () {
    var self = this;
    function sameOrigin(url) {
      try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
    }
    function fetchText(url) {
      return fetch(url).then(function (r) { if (!r.ok) throw 0; return r.text(); });
    }
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    var scripts = Array.prototype.slice.call(document.querySelectorAll("script[src]"));
    var cssJobs = links.map(function (l) {
      if (l.href && sameOrigin(l.href)) {
        return fetchText(l.href).then(function (t) { return "<style>\n" + t + "\n</style>"; })
          .catch(function () { return '<link rel="stylesheet" href="' + l.href + '">'; });
      }
      return Promise.resolve('<link rel="stylesheet" href="' + l.href + '">');
    });
    var jsJobs = scripts.map(function (s) {
      if (s.src && sameOrigin(s.src)) {
        return fetchText(s.src).then(function (t) {
          // 转义源码里字面量的 </script>（注释/字符串里常有），否则会提前关闭内联脚本、
          // 后面的源码被浏览器当成正文渲染（导出 HTML 第一页出现一堆"代码乱码"）。
          // JS 字符串里 <\/script 的值仍是 </script，行为不变。
          return "<scr" + "ipt>\n" + t.replace(/<\/(script)/gi, "<\\/$1") + "\n</scr" + "ipt>";
        }).catch(function () { return '<scr' + 'ipt src="' + s.src + '"></scr' + "ipt>"; });
      }
      return Promise.resolve('<scr' + 'ipt src="' + s.src + '"></scr' + "ipt>");
    });

    this._toast("正在打包 HTML…");
    Promise.all([Promise.all(cssJobs), Promise.all(jsJobs)]).then(function (res) {
      var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
      var deck = '<div data-cardmaker data-preset="' + self.preset + '"' +
        (self.font ? ' data-font="' + self.font + '"' : "") +
        ' data-title="' + esc(self.title) + '">\n' + self.getHTML() + "\n</div>";
      var doc = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        "<title>" + esc(self.title) + "</title>\n" + res[0].join("\n") +
        "\n</head>\n<body>\n" + deck + "\n" + res[1].join("\n") + "\n</body>\n</html>\n";
      download(URL.createObjectURL(new Blob([doc], { type: "text/html" })), slug(self.title) + ".html");
      self._toast("已保存为 " + slug(self.title) + ".html");
    }).catch(function (e) { self._toast("保存失败：" + (e && e.message || e)); });
  };

  // 应用字体：每卡按 data-font（优先）或 deck 级默认，懒加载并设到 --cm-font-sans
  CardMaker.prototype._applyFonts = function () {
    var self = this;
    this.cards.forEach(function (c) {
      var key = c.getAttribute("data-font") || self.font;
      if (key && FONTS[key]) {
        ensureFont(key);
        c.style.setProperty("--cm-font-sans", FONTS[key].family);
      } else {
        c.style.removeProperty("--cm-font-sans");
      }
    });
  };

  // 取卡片下「直接子级」的 fitbox
  function fitboxOf(card) {
    for (var n = card.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.classList.contains("cm-fitbox")) return n;
    }
    return null;
  }

  // 取卡片下指定类名的「直接子级」（排除 fitbox 内部）
  function directChildByClass(card, cls) {
    for (var n = card.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.classList.contains(cls) && !n.classList.contains("cm-fitbox")) return n;
    }
    return null;
  }

  // 给卡片注入内容层：绝对铺满、复刻卡片 flex 布局，承载除装饰层外的全部作者内容
  // （抽成模块函数，主舞台与「生成预览缩略图」共用，保证两边渲染一致）
  function ensureFitbox(card) {
    if (fitboxOf(card)) return;
    var box = el("div", "cm-fitbox");
    var nodes = Array.prototype.slice.call(card.childNodes);
    nodes.forEach(function (n) {
      if (n.nodeType === 1 && (n.classList.contains("cm-deco") || n.classList.contains("cm-page") || n.classList.contains("cm-footer") || n.classList.contains("cm-header"))) return;
      box.appendChild(n); // 正文移入 fitbox；装饰层/页码/footer/header 留在卡片上、不缩放
    });
    // 把卡片上的对齐类（cm-middle/cm-center/cm-text-center…）带到 fitbox（它才是 flex 容器）
    Array.prototype.forEach.call(card.classList, function (c) {
      if (c !== "card" && c !== "is-active" && c !== "cm-fitted") box.classList.add(c);
    });
    card.classList.add("cm-fitted");
    card.appendChild(box);
  }
  CardMaker.prototype._ensureFitbox = function (card) { ensureFitbox(card); };

  // ---- 对比度护栏：背景被改深/改浅但文字色没跟着改时（LLM 常犯），自动翻成可读色 ----
  function _relLum(r, g, b) { // WCAG 相对亮度
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function _colorsIn(str) { // 从字符串里抠出所有 rgb/rgba（忽略近乎透明的）
    var out = [], m, re = /rgba?\(([^)]+)\)/g;
    while ((m = re.exec(str))) {
      var p = m[1].split(",").map(parseFloat);
      if (p.length >= 3 && (p[3] === undefined || p[3] > 0.1)) out.push(p);
    }
    return out;
  }
  function _avgLum(str) {
    var cols = _colorsIn(str);
    if (!cols.length) return null;
    var s = 0;
    cols.forEach(function (c) { s += _relLum(c[0], c[1], c[2]); });
    return s / cols.length;
  }
  function _contrast(a, b) { var hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); }

  // 逐卡体检：背景与文字对比度过低就改 --cm-fg/--cm-muted（只在真有问题时介入，不动配好的主题）
  function fixContrastCard(c) {
    var cs = getComputedStyle(c);
    var bgL = _avgLum(cs.backgroundColor + " " + cs.backgroundImage);
    if (bgL == null) return; // 完全透明：交给导出底色，跳过
    var fg = _colorsIn(cs.color)[0];
    if (!fg) return;
    var fgL = _relLum(fg[0], fg[1], fg[2]);
    if (_contrast(fgL, bgL) >= 3) return; // 够清晰，别碰
    var dark = bgL < 0.4; // 文字看不清：深底配浅字、浅底配深字
    c.style.setProperty("--cm-fg", dark ? "#ffffff" : "#141414");
    c.style.setProperty("--cm-muted", dark ? "rgba(255,255,255,.72)" : "rgba(20,20,20,.62)");
  }
  CardMaker.prototype._fixContrast = function () { this.cards.forEach(fixContrastCard); };

  // 内容溢出时只缩放 fitbox，保证不裁切；缩得过小则标记提示精简
  // 单卡自适配：内容溢出时只缩放 fitbox，保证不裁切；缩得过小则标记提示精简
  function fitCard(c) {
    var box = fitboxOf(c);
    if (!box) return;
    // 用 inset 精确框定内容区（页眉之下、页脚之上），并对 fitbox 开 overflow:hidden：
    // 内容再多也只会在「页脚之上」被干净裁切，绝不与 footer/header 重叠。
    var basePad = parseFloat(getComputedStyle(c).getPropertyValue("--cm-pad")) || 64;
    var gap = Math.max(36, Math.round(basePad * 0.5));
    var footer = directChildByClass(c, "cm-footer");
    var header = directChildByClass(c, "cm-header");
    function chromeReserve(node, edge) {
      if (!node) return basePad;
      var off = parseFloat(getComputedStyle(node)[edge]) || basePad; // footer 的 bottom / header 的 top 偏移
      return off + node.offsetHeight + gap;
    }
    var botInset = chromeReserve(footer, "bottom");
    box.style.padding = "0"; // 边距改由 inset 提供，避免双重边距
    box.style.left = basePad + "px";
    box.style.right = basePad + "px";
    box.style.top = chromeReserve(header, "top") + "px";
    box.style.bottom = botInset + "px";
    // 量取内容自然高度：取消缩放 + 顶对齐，并让 fitbox 暂时按内容自然高度撑开。
    //（关键：居中布局会让 scrollHeight 少算超出部分；用 bottom:auto 撑开来测准，避免误判“放得下”而截断）
    box.style.transform = "none";
    var prevJ = box.style.justifyContent;
    var availH = box.clientHeight, availW = box.clientWidth; // 内容区尺寸（含 inset）
    box.style.justifyContent = "flex-start";
    box.style.bottom = "auto";
    var needH = box.scrollHeight, needW = box.scrollWidth; // 内容自然总高/宽
    box.style.bottom = botInset + "px"; // 还原内容区
    box.style.justifyContent = prevJ;
    var s = 1;
    if (needH > availH + 1) s = Math.min(s, availH / needH);
    if (needW > availW + 1) s = Math.min(s, availW / needW);
    // 内容放不下就缩小字号，但不低于最小字号（中文可读底线 22px）。
    var MIN_BODY = 22;
    var bodyPx = parseFloat(getComputedStyle(box).fontSize) || 30;
    var floor = Math.min(1, MIN_BODY / bodyPx);
    var needed = s; // 真正需要的缩放（可能小于下限）
    if (s < 1) {
      s = Math.max(s * 0.97, floor); // 留安全余量；不小于最小字号对应的缩放
      box.style.transform = "scale(" + s + ")";
    } else {
      box.style.transform = "none";
    }
    // 连最小字号都放不下 → 该页内容过多（会截断），编辑态标红提示精简或用「✦ 修改」
    if (needed < floor - 0.01) c.setAttribute("data-overflow", "");
    else c.removeAttribute("data-overflow");
  }
  CardMaker.prototype._autoFit = function () {
    var cards = this.cards;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () {
      cards.forEach(function (c) { fixContrastCard(c); fitCard(c); }); // 先保证可读，再缩放
    });
  };

  // 静态：把一段 deck HTML 的【最后一张卡】渲染成等比缩略图（含 deck 级 <style> + fitbox 居中 +
  // auto-fit 缩放 + 对比度护栏 + 各比例字号），用于「生成中」实时预览，确保和主舞台渲染一致。
  CardMaker.renderThumb = function (deckHTML, preset, mount, widthPx) {
    if (!mount) return;
    var P = PRESETS[preset] || PRESETS.xiaohongshu;
    var tmp = el("div");
    tmp.innerHTML = deckHTML;
    var list = tmp.querySelectorAll(".card");
    var card = list[list.length - 1];
    if (!card) return;
    var scale = widthPx / P.w;
    // 作用域层：带 .cm-app[data-preset] 才能拿到该比例的字号令牌；用行内样式中和 app 外壳布局
    var scope = el("div", "cm-app");
    scope.setAttribute("data-preset", preset);
    scope.style.cssText = "position:relative;inset:auto;display:block;background:none;overflow:hidden;width:" +
      widthPx + "px;height:" + Math.round(P.h * scale) + "px";
    var inner = el("div");
    inner.style.cssText = "width:" + P.w + "px;height:" + P.h + "px;transform-origin:top left;transform:scale(" + scale + ")";
    // 关键：带上 deck 级 <style>（freeform 自定义 CSS），否则布局会错位
    Array.prototype.forEach.call(tmp.querySelectorAll("style"), function (s) { inner.appendChild(s.cloneNode(true)); });
    card.classList.remove("is-active");
    card.style.width = P.w + "px";
    card.style.height = P.h + "px";
    inner.appendChild(card);
    scope.appendChild(inner);
    mount.innerHTML = "";
    mount.appendChild(scope);
    // 复刻主舞台：fitbox + 对比度 + auto-fit（需在 DOM 中测量，放到下一帧）
    ensureFitbox(card);
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { fixContrastCard(card); fitCard(card); });
  };

  CardMaker.prototype._render = function () {
    var self = this;
    this.cards.forEach(function (c, i) {
      c.classList.toggle("is-active", i === self.index);
      var pg = c.querySelector(".cm-page");
      if (pg) pg.textContent = i + 1 + " / " + self.cards.length;
    });
    Array.prototype.forEach.call(this.dots.children, function (d, i) {
      d.classList.toggle("is-active", i === self.index);
    });
    this.counter.textContent = this.cards.length ? this.index + 1 + " / " + this.cards.length : "0";
    this.btnPrev.disabled = this.index <= 0;
    this.btnNext.disabled = this.index >= this.cards.length - 1;
  };

  // 等比缩放，让当前卡片铺满舞台
  CardMaker.prototype._fit = function () {
    var p = PRESETS[this.preset];
    var availW = this.stage.clientWidth - 48;
    var availH = this.stage.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return;
    var scale = Math.min(availW / p.w, availH / p.h);
    this.scaler.style.transform = "scale(" + scale + ")";
  };

  CardMaker.prototype.goTo = function (i) {
    if (i < 0 || i >= this.cards.length) return;
    this.index = i;
    this._render();
    // 切到该页后立即重新适配它：初次 _autoFit 时非活动页是隐藏/绝对定位的，
    // height:100% / flex:1 这类布局在隐藏态测量不准，导致"第一页对、第二页起错位"。
    // _render 已把它设为活动（可见/在流中），此处同步测量即准确，无需等 rAF。
    var card = this.cards[i];
    if (card) { fixContrastCard(card); fitCard(card); }
    this._syncEditor(); // 编辑中时，切换卡片同步编辑器内容
  };
  CardMaker.prototype.next = function () { this.goTo(this.index + 1); };
  CardMaker.prototype.prev = function () { this.goTo(this.index - 1); };

  CardMaker.prototype._onKey = function (e) {
    // Esc 优先处理：即使焦点在编辑器输入框里，也要能关掉编辑界面（故放在 textarea 早退之前）
    if (e.key === "Escape") {
      if (this.app.classList.contains("is-editing")) { e.preventDefault(); this.toggleEditor(); return; }
      this.app.classList.remove("is-present"); // 否则：退出放映
      return;
    }
    if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault(); this.next();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault(); this.prev();
    } else if (e.key === "f" || e.key === "F") {
      this.present();
    } else if (e.key === "e" || e.key === "E") {
      this.exportCurrent();
    }
  };

  CardMaker.prototype.present = function () {
    var self = this;
    this.app.classList.add("is-present");
    var stage = this.stage;
    var fn = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (fn) fn.call(stage).catch(function () {});
    var onExit = function () {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        self.app.classList.remove("is-present");
      }
    };
    document.addEventListener("fullscreenchange", onExit);
    document.addEventListener("webkitfullscreenchange", onExit);
  };

  CardMaker.prototype.toggleEditor = function () {
    var self = this;
    var on = this.app.classList.toggle("is-editing");
    if (on) {
      var html = this._currentCardHTML();
      this.textarea.value = html;
      this._ensureEditor(); // 懒加载 CodeMirror（失败则用 textarea）
      this._setEditorText(html);
    }
    setTimeout(function () {
      self._fit();
      if (self.cm) self.cm.refresh();
    }, 220);
  };

  // 当前卡片的源码（拆掉运行时注入的 fitbox/角标，还原成作者写的干净 HTML）
  CardMaker.prototype._cardHTML = function (card) {
    var k = card.cloneNode(true);
    var pg = k.querySelector(".cm-page");
    if (pg) pg.remove();
    k.classList.remove("is-active");
    k.classList.remove("cm-fitted");
    // 拆 fitbox：把其中的作者内容移回卡片，删除 fitbox 本身
    var box = fitboxOf(k);
    if (box) {
      while (box.firstChild) k.appendChild(box.firstChild);
      box.remove();
    }
    return k.outerHTML;
  };
  CardMaker.prototype._currentCardHTML = function () {
    var card = this.cards[this.index];
    return card ? this._cardHTML(card) : "";
  };

  // 编辑中时，把编辑器内容同步成当前卡片（翻页、AI 生成后调用）
  CardMaker.prototype._syncEditor = function () {
    if (this.app.classList.contains("is-editing")) {
      this._setEditorText(this._currentCardHTML());
    }
  };

  // 取/写编辑器文本，自动适配 CodeMirror 或 textarea
  CardMaker.prototype._getEditorText = function () {
    return this.cm ? this.cm.getValue() : this.textarea.value;
  };
  CardMaker.prototype._setEditorText = function (text) {
    this.textarea.value = text;
    if (this.cm) {
      this._silent = true;
      this.cm.setValue(text);
      this._silent = false;
    }
  };

  // 懒加载并初始化 CodeMirror（仅一次；任何失败都静默退回 textarea）
  CardMaker.prototype._ensureEditor = function () {
    if (this.cm || this._cmLoading) return;
    if (window.CodeMirror) return this._initCM();
    this._cmLoading = true;
    var self = this;
    CM_CSS.forEach(loadCss);
    loadScript(CM_CORE)
      .then(function () { return Promise.all(CM_MODES.map(loadScript)); })
      .then(function () { return loadScript(CM_HTMLMIXED); })
      .then(function () { self._initCM(); })
      .catch(function (e) { console.warn("[CardMaker] CodeMirror 加载失败，使用纯文本编辑：", e); })
      .finally(function () { self._cmLoading = false; });
  };

  CardMaker.prototype._initCM = function () {
    var self = this;
    this.cm = window.CodeMirror.fromTextArea(this.textarea, {
      mode: "htmlmixed",
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      autoCloseTags: false,
      extraKeys: { Esc: function () { self.toggleEditor(); } }, // CM 内按 Esc 也能关编辑器
    });
    this.cm.on("change", function () {
      if (!self._silent) self._applyEditor();
    });
    setTimeout(function () { self.cm.refresh(); }, 0);
  };

  // 用编辑器内容替换「当前这一张」卡片，其余不动
  CardMaker.prototype._applyEditor = function () {
    var card = this.cards[this.index];
    if (!card) return;
    // innerHTML 不会执行 <script>，本地工具场景安全
    var tmp = document.createElement("div");
    tmp.innerHTML = this._getEditorText();
    var next = tmp.querySelector(".card");
    if (!next) return; // 输入到一半还不是合法卡片，先不动，避免误删
    card.replaceWith(next);
    this.refresh(); // index 不变，重新激活同一位置
  };

  // ---------- 出图 ----------
  CardMaker.prototype._ensureLibs = function (needZip) {
    var jobs = [];
    if (!global.htmlToImage) jobs.push(loadScript(CDN.htmlToImage));
    if (needZip && !global.JSZip) jobs.push(loadScript(CDN.jszip));
    // 等 web 字体加载完成，确保导出时能正确嵌入（否则出图会回退系统字体）
    if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready);
    return Promise.all(jobs);
  };

  CardMaker.prototype._snap = function (card) {
    var p = PRESETS[this.preset];
    this.app.classList.add("cm-exporting");
    // 临时显示该卡片（导出非当前页时）
    var wasActive = card.classList.contains("is-active");
    card.classList.add("is-active");
    // 导出前按"可见态"重新适配该卡：否则非当前页可能用的是初次隐藏态测出的错误 fit。
    fixContrastCard(card); fitCard(card);
    var opts = {
      width: p.w,
      height: p.h,
      pixelRatio: 2,
      cacheBust: true,
      style: { opacity: "1", visibility: "visible", position: "relative", transform: "none" },
    };
    var self = this;
    return global.htmlToImage.toPng(card, opts).finally(function () {
      if (!wasActive) card.classList.remove("is-active");
      self.app.classList.remove("cm-exporting");
    });
  };

  function download(dataUrl, name) {
    var a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  CardMaker.prototype._toast = function (msg) {
    this.toast.textContent = msg;
    this.toast.classList.add("is-show");
    clearTimeout(this._toastT);
    var self = this;
    this._toastT = setTimeout(function () { self.toast.classList.remove("is-show"); }, 2200);
  };

  CardMaker.prototype.exportCurrent = function () {
    var self = this;
    var card = this.cards[this.index];
    if (!card) return;
    this._toast("正在出图…");
    this._ensureLibs(false)
      .then(function () { return self._snap(card); })
      .then(function (url) {
        download(url, slug(self.title) + "-" + (self.index + 1) + ".png");
        self._toast("已导出第 " + (self.index + 1) + " 页");
      })
      .catch(function (err) { self._toast("导出失败：" + err.message); });
  };

  CardMaker.prototype.exportAll = function () {
    var self = this;
    if (!this.cards.length) return;
    this._toast("正在打包 " + this.cards.length + " 张…");
    this._ensureLibs(true)
      .then(function () {
        var zip = new global.JSZip();
        var seq = Promise.resolve();
        self.cards.forEach(function (card, i) {
          seq = seq
            .then(function () { return self._snap(card); })
            .then(function (url) {
              zip.file(slug(self.title) + "-" + (i + 1) + ".png", url.split(",")[1], { base64: true });
              self._toast("已渲染 " + (i + 1) + "/" + self.cards.length);
            });
        });
        return seq.then(function () { return zip.generateAsync({ type: "blob" }); });
      })
      .then(function (blob) {
        download(URL.createObjectURL(blob), slug(self.title) + ".zip");
        self._toast("已导出全部，共 " + self.cards.length + " 张");
      })
      .catch(function (err) { self._toast("导出失败：" + err.message); });
  };

  function slug(s) {
    return String(s).trim().replace(/\s+/g, "-").replace(/[^\w一-龥-]/g, "").slice(0, 40) || "deck";
  }

  // ---------- 公开 API（供扩展模块如 cardmaker-ai.js 使用） ----------

  // 在工具栏动作区前插入一个按钮
  CardMaker.prototype.addToolButton = function (label, handler, opts) {
    opts = opts || {};
    var b = el("button", "cm-btn" + (opts.primary ? " cm-primary" : ""), label);
    b.onclick = handler;
    this.btnEdit.parentNode.insertBefore(b, this.btnEdit);
    return b;
  };

  // 用一段 HTML 替换全部卡片
  CardMaker.prototype.setHTML = function (html) {
    this.cardsWrap.innerHTML = html;
    this.index = 0;
    this.refresh();
    this._syncEditor();
  };

  // 取整个 deck 的源码（去掉运行时角标）
  CardMaker.prototype.getHTML = function () {
    var self = this;
    // 串联 cardsWrap 的全部直接子节点：卡片拆掉 fitbox 还原，其它元素（如 deck 级 <style>）原样保留
    var parts = [];
    Array.prototype.forEach.call(this.cardsWrap.childNodes, function (n) {
      if (n.nodeType !== 1) return;
      if (n.classList.contains("card")) parts.push(self._cardHTML(n));
      else parts.push(n.outerHTML);
    });
    return parts.join("\n\n");
  };

  // 当前页的干净源码（供「单页重绘」读取）
  CardMaker.prototype.currentCardHTML = function () {
    return this._currentCardHTML();
  };

  // 用一段 HTML 替换指定页（用于单页重绘）；i 默认当前页
  CardMaker.prototype.replaceCardAt = function (i, html) {
    if (i == null) i = this.index;
    var card = this.cards[i];
    if (!card) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var next = tmp.querySelector(".card");
    if (!next) return;
    card.replaceWith(next);
    this.refresh();
    this.goTo(i);
  };

  // 局部打补丁：只替换改动的页和/或 deck 级 <style>，其余页原样保留（供「✦ 修改」用，
  // 避免整套重建——既快又不会动到没让改的页）。patch = { style?:"<style>…</style>", pages?:{ 索引: "<section>…</section>" } }
  CardMaker.prototype.patchDeck = function (patch) {
    if (!patch) return false;
    var self = this, changed = false;
    if (patch.style) {
      var t0 = el("div"); t0.innerHTML = patch.style;
      var ns = t0.querySelector("style");
      if (ns) {
        var old = this.cardsWrap.querySelector("style");
        if (old) old.replaceWith(ns); else this.cardsWrap.insertBefore(ns, this.cardsWrap.firstChild);
        changed = true;
      }
    }
    if (patch.pages) {
      Object.keys(patch.pages).forEach(function (k) {
        var card = self.cards[parseInt(k, 10)];
        if (!card) return;
        var t = el("div"); t.innerHTML = patch.pages[k];
        var next = t.querySelector(".card");
        if (next) { card.replaceWith(next); changed = true; }
      });
    }
    if (changed) {
      this.refresh();
      this.goTo(Math.min(this.index, this.cards.length - 1));
    }
    return changed;
  };

  // 切换比例预设
  CardMaker.prototype.setPreset = function (preset) {
    if (!PRESETS[preset]) return;
    this.preset = preset;
    this.app.setAttribute("data-preset", preset);
    var sel = this.app.querySelector(".cm-preset");
    if (sel) sel.value = preset;
    this._fit();
  };

  // 切到某比例并载入其内置示例（供左上角比例选择器使用）
  CardMaker.prototype.loadExample = function (preset) {
    if (!PRESETS[preset]) return;
    this.setPreset(preset);
    if (DEMOS[preset]) { this.setHTML(DEMOS[preset]); this.goTo(0); }
  };

  // 设置整个 deck 的默认字体（"" 恢复系统字体）
  CardMaker.prototype.setFont = function (key) {
    this.font = key && FONTS[key] ? key : "";
    this._applyFonts();
    this._autoFit();
  };

  CardMaker.PRESETS = PRESETS;
  CardMaker.FONTS = FONTS;

  // 就绪回调：扩展模块用 CardMaker.ready(fn) 等待实例可用
  var readyCbs = [];
  CardMaker.ready = function (fn) {
    if (global.cardmaker) fn(global.cardmaker);
    else readyCbs.push(fn);
  };

  // 自动初始化
  function autoInit() {
    var root = document.querySelector("[data-cardmaker]");
    if (root && !root.__cmInited) {
      root.__cmInited = true;
      try {
        global.cardmaker = new CardMaker({ root: root });
        readyCbs.forEach(function (fn) { fn(global.cardmaker); });
        readyCbs = [];
      } catch (e) {
        console.error(e);
      }
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  global.CardMaker = CardMaker;
})(window);
