/* =============================================================
   CardMaker 只读 viewer —— 导出的成品 HTML 内联这一个文件。
   只做：把 [data-cardmaker] 里的 <section class="card"> 变成可左右翻页的舞台
   + 等比缩放适配屏幕 + 按 data-font 懒加载中文字体。
   不含编辑器 / 出图 / AI / 切比例 / 存档（成品用不到）。自包含、无依赖、普通 IIFE，
   配合内联的 cardmaker.css 工作。翻页/缩放/字体的行为与 deck.js 保持一致。
   ============================================================= */
(function () {
  "use strict";

  var PRESETS = {
    xiaohongshu: { w: 1080, h: 1440 },
    square: { w: 1080, h: 1080 },
    ppt: { w: 1280, h: 720 },
    story: { w: 1080, h: 1920 },
  };
  // data-font 中文 web 字体（key → CSS font-family + 样式表地址），按需懒加载
  var FONTS = {
    hei:     { family: "'Noto Sans SC', sans-serif", css: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap" },
    song:    { family: "'Noto Serif SC', serif",     css: "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700;900&display=swap" },
    kai:     { family: "'LXGW WenKai', serif",        css: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont/style.css" },
    smiley:  { family: "'Smiley Sans', sans-serif",  css: "https://cdn.jsdelivr.net/npm/smiley-sans/index.css" },
    xiaowei: { family: "'ZCOOL XiaoWei', serif",     css: "https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap" },
    kuaile:  { family: "'ZCOOL KuaiLe', cursive",    css: "https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap" },
    mao:     { family: "'Ma Shan Zheng', cursive",   css: "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap" },
  };
  var _fontLoaded = {};
  function ensureFont(key) {
    if (_fontLoaded[key] || !FONTS[key]) return;
    _fontLoaded[key] = true;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = FONTS[key].css;
    document.head.appendChild(l);
  }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function Viewer(root) {
    this.root = root;
    var p = root.getAttribute("data-preset");
    this.preset = PRESETS[p] ? p : "xiaohongshu";
    this.font = root.getAttribute("data-font") || "";
    this.index = 0;
    this._build();
    this.refresh();
    var self = this;
    window.addEventListener("resize", function () { self._fit(); });
    if (window.ResizeObserver) new ResizeObserver(function () { self._fit(); }).observe(this.stage);
    document.addEventListener("keydown", function (e) { self._onKey(e); });
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener("loadingdone", function () { self._fit(); });
    }
  }

  Viewer.prototype._build = function () {
    var app = el("div", "cm-app");
    app.setAttribute("data-preset", this.preset);
    var stage = el("div", "cm-stage");
    this.scaler = el("div", "cm-scaler");
    this.cardsWrap = el("div", "cm-cards");
    this.scaler.appendChild(this.cardsWrap);
    stage.appendChild(this.scaler);
    var nav = el("div", "cm-nav");
    this.btnPrev = el("button", "cm-btn"); this.btnPrev.textContent = "‹";
    this.btnNext = el("button", "cm-btn"); this.btnNext.textContent = "›";
    this.dots = el("div", "cm-dots");
    this.counter = el("div", "cm-counter");
    nav.appendChild(this.btnPrev);
    nav.appendChild(this.dots);
    nav.appendChild(this.btnNext);
    nav.appendChild(this.counter);
    app.appendChild(stage);
    app.appendChild(nav);
    // 用 cm-app 外壳替换源容器，源卡片（含 deck 级 <style>）迁入 cardsWrap
    this.root.parentNode.insertBefore(app, this.root);
    while (this.root.firstChild) this.cardsWrap.appendChild(this.root.firstChild);
    this.root.remove();
    this.app = app;
    this.stage = stage;
    var self = this;
    this.btnPrev.onclick = function () { self.prev(); };
    this.btnNext.onclick = function () { self.next(); };
  };

  Viewer.prototype.refresh = function () {
    this.cards = Array.prototype.slice.call(this.cardsWrap.querySelectorAll(".card"));
    if (this.index >= this.cards.length) this.index = Math.max(0, this.cards.length - 1);
    this.dots.innerHTML = "";
    var self = this;
    this.cards.forEach(function (c, i) {
      var d = el("button", "cm-dot");
      d.onclick = function () { self.goTo(i); };
      self.dots.appendChild(d);
    });
    this._applyFonts();
    this._render();
    this._fit();
  };

  // 每卡按 data-font（优先）或 deck 级默认懒加载并设到 --cm-font-sans
  Viewer.prototype._applyFonts = function () {
    var self = this;
    this.cards.forEach(function (c) {
      var key = c.getAttribute("data-font") || self.font;
      if (key && FONTS[key]) { ensureFont(key); c.style.setProperty("--cm-font-sans", FONTS[key].family); }
    });
  };

  Viewer.prototype._render = function () {
    var self = this;
    this.cards.forEach(function (c, i) { c.classList.toggle("is-active", i === self.index); });
    Array.prototype.forEach.call(this.dots.children, function (d, i) { d.classList.toggle("is-active", i === self.index); });
    this.counter.textContent = this.cards.length ? (this.index + 1) + " / " + this.cards.length : "0";
    this.btnPrev.disabled = this.index <= 0;
    this.btnNext.disabled = this.index >= this.cards.length - 1;
  };

  // 等比缩放，让当前卡片铺满舞台
  Viewer.prototype._fit = function () {
    var p = PRESETS[this.preset];
    var aw = this.stage.clientWidth - 48, ah = this.stage.clientHeight - 48;
    if (aw <= 0 || ah <= 0) return;
    this.scaler.style.transform = "scale(" + Math.min(aw / p.w, ah / p.h) + ")";
  };

  Viewer.prototype.goTo = function (i) { if (i < 0 || i >= this.cards.length) return; this.index = i; this._render(); };
  Viewer.prototype.next = function () { this.goTo(this.index + 1); };
  Viewer.prototype.prev = function () { this.goTo(this.index - 1); };

  Viewer.prototype._onKey = function (e) {
    if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); this.next(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); this.prev(); }
  };

  function init() {
    var root = document.querySelector("[data-cardmaker]");
    if (root && !root.__cmv) { root.__cmv = true; try { new Viewer(root); } catch (e) { console.error(e); } }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
