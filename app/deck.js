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
"use strict";
const global = window; // 保留内部 global.xxx 引用；ES module 顶层无 IIFE 包裹

  var PRESETS = {
    xiaohongshu: { w: 1080, h: 1440, label: "小红书 3:4" },
    square: { w: 1080, h: 1080, label: "方形 1:1" },
    ppt: { w: 1280, h: 720, label: "PPT 16:9" },
    story: { w: 1080, h: 1920, label: "竖屏 9:16" },
  };

  // 各比例的内置示例已拆到 examples/<preset>.html（运行时不再内嵌示例内容）。
  // 切比例时按需 fetch 注入；示例路径相对本模块（app/deck.js）解析，指向 ../examples/。
  // 注意：需经 http 服务（本地 serve / Pages）访问，file:// 下浏览器禁止 fetch 本地文件；失败时仅切画布尺寸并告警。
  var SELF_SRC = import.meta.url; // ES module 里没有 document.currentScript，用模块自身 URL
  function demoURL(preset) {
    try { return new URL("../examples/" + preset + ".html", SELF_SRC).href; }
    catch (e) { return "../examples/" + preset + ".html"; }
  }
  // 从一段完整 deck 文档里抽出 [data-cardmaker] 容器的内部 HTML（卡片 + 可选 deck 级 <style>）
  function extractDeck(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var deck = doc.querySelector("[data-cardmaker]");
    return deck ? deck.innerHTML : "";
  }

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
    // 只读浏览模式（导出的成品 HTML 用）：只翻页，不渲染工具栏/编辑器，不读写本地存档
    this.view = (opts.mode || this.source.getAttribute("data-mode")) === "view";
    this.store = "cardmaker:" + location.pathname; // 自动存档键（按页面区分）
    this.index = 0;
    this.cards = [];
    this._build();
    if (!this.view) this._restore(); // 浏览模式用文件里的内容，不恢复本地存档
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
      document.fonts.addEventListener("loadingdone", function () { self._fit(); });
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
    if (!this.view) { // 浏览模式不要这些编辑/导出按钮
      bar.appendChild(this.btnEdit);
      bar.appendChild(this.btnPresent);
      bar.appendChild(this.btnSave);
      bar.appendChild(this.btnExport);
      bar.appendChild(this.btnExportAll);
    }

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

    if (!this.view) body.appendChild(this.editor);
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

    if (!this.view) app.appendChild(bar); // 浏览模式无工具栏，只留舞台 + 翻页导航
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
      // 不再自动注入平台页码——页码交给作者/AI 自行设计，避免和内容里的页码重复。
      // （若作者主动写了 <div class="cm-page">，_render 仍会把它填成「页/总」，作为可选功能。）
    });
    this._applyFonts();
    this._render();
    this._fit();
    this._save();
  };

  // ---------- 存档：自动存到 localStorage，刷新自动恢复 ----------
  CardMaker.prototype._save = function () {
    if (this.view) return; // 浏览模式不写本地存档
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
    var cssJobs = links.map(function (l) {
      if (l.href && sameOrigin(l.href)) {
        return fetchText(l.href).then(function (t) { return "<style>\n" + t + "\n</style>"; })
          .catch(function () { return '<link rel="stylesheet" href="' + l.href + '">'; });
      }
      return Promise.resolve('<link rel="stylesheet" href="' + l.href + '">');
    });
    // 导出成品自包含 + 极简：只内联【只读 viewer】（翻页/缩放/字体），剥掉编辑器/出图/AI/切比例/
    // 存档等成品用不到的代码——导出文件干净得多。viewer.js 是普通 IIFE（非 module），与 deck.js 同目录。
    // 转义源码里字面 </script> 避免提前闭合脚本标签。
    var viewerURL = new URL("./viewer.js", SELF_SRC).href;
    var jsJobs = [
      fetchText(viewerURL).then(function (t) {
        return "<scr" + "ipt>\n" + t.replace(/<\/(script)/gi, "<\\/$1") + "\n</scr" + "ipt>";
      }).catch(function () { return '<scr' + 'ipt src="' + viewerURL + '"></scr' + "ipt>"; }),
    ];

    this._toast("正在打包 HTML…");
    Promise.all([Promise.all(cssJobs), Promise.all(jsJobs)]).then(function (res) {
      var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
      var deck = '<div data-cardmaker data-mode="view" data-preset="' + self.preset + '"' +
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

  // 静态：把一段 deck HTML 的【最后一张卡】渲染成等比缩略图（含 deck 级 <style> + 各比例字号），
  // 用于「生成中」实时预览，确保和主舞台渲染一致。无运行时缩放——卡片是什么样就预览什么样。
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

  // 当前卡片的源码（去掉运行时角标，还原成作者写的干净 HTML）
  CardMaker.prototype._cardHTML = function (card) {
    var k = card.cloneNode(true);
    var pg = k.querySelector(".cm-page");
    if (pg) pg.remove();
    k.classList.remove("is-active");
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
    // 串联 cardsWrap 的全部直接子节点：卡片还原成干净源码，其它元素（如 deck 级 <style>）原样保留
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

  // 切到某比例并载入其示例（示例独立存放在 examples/<preset>.html，按需 fetch 注入）
  CardMaker.prototype.loadExample = function (preset) {
    if (!PRESETS[preset]) return;
    this.setPreset(preset);
    var self = this, url = demoURL(preset);
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (html) {
        var inner = extractDeck(html);
        if (!inner) throw new Error("示例里没有 [data-cardmaker] 容器");
        self.setHTML(inner);
        self.goTo(0);
      })
      .catch(function (e) {
        console.warn("[CardMaker] 载入示例失败（" + url + "）：" + e.message +
          "；已仅切换画布比例。file:// 下请改用本地服务（http）打开。");
      });
  };

  // 设置整个 deck 的默认字体（"" 恢复系统字体）
  CardMaker.prototype.setFont = function (key) {
    this.font = key && FONTS[key] ? key : "";
    this._applyFonts();
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

export { CardMaker };
