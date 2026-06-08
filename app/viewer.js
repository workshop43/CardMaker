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
  // data-font 中文字体：优先系统字体栈；只有 css 非空的字体才按需懒加载。
  var FONTS = {
    hei:     { family: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif", css: "" },
    song:    { family: "'Songti SC', 'STSong', 'SimSun', serif", css: "" },
    kai:     { family: "'LXGW WenKai', serif",        css: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont/style.css" },
    smiley:  { family: "'Smiley Sans', sans-serif",  css: "https://cdn.jsdelivr.net/npm/smiley-sans/index.css" },
    xiaowei: { family: "'Songti SC', 'STSong', 'SimSun', serif", css: "" },
    kuaile:  { family: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif", css: "" },
    mao:     { family: "'Songti SC', 'STKaiti', 'KaiTi', serif", css: "" },
  };
  var _fontLoaded = {};
  function ensureFont(key) {
    if (_fontLoaded[key] || !FONTS[key] || !FONTS[key].css) return;
    _fontLoaded[key] = true;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = FONTS[key].css;
    document.head.appendChild(l);
  }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // deck <style> 作用域隔离（与 deck.js 同款）：把规则限定到 .cm-cards，杜绝 body{}/*{}/.card{}
  // 等全局选择器泄漏污染页面；:root/html/body 映射到 .cm-cards（承载令牌覆盖与页面级背景）。
  var CARD_SCOPE = ".cm-cards";
  function _readBlock(css, open) {
    var depth = 0, i = open, n = css.length;
    for (; i < n; i++) { var c = css[i]; if (c === "{") depth++; else if (c === "}" && --depth === 0) { i++; break; } }
    return { inner: css.slice(open + 1, i - 1), end: i };
  }
  function _splitTop(sel) {
    var parts = [], buf = "", p = 0, b = 0;
    for (var i = 0; i < sel.length; i++) { var c = sel[i];
      if (c === "(") p++; else if (c === ")") p--; else if (c === "[") b++; else if (c === "]") b--;
      if (c === "," && !p && !b) { parts.push(buf); buf = ""; } else buf += c; }
    parts.push(buf); return parts;
  }
  function _scopeSel(sel, scope) {
    return _splitTop(sel).map(function (s) { var t = s.trim();
      if (!t) return t;
      if (/^(:root|html|body)$/i.test(t)) return scope;
      if (t === scope || t.indexOf(scope + " ") === 0) return t;
      return scope + " " + t;
    }).join(", ");
  }
  function _scopeBlock(css, scope) {
    var out = "", i = 0, n = css.length;
    while (i < n) {
      while (i < n && /\s/.test(css[i])) i++;
      if (i >= n) break;
      if (css[i] === "@") {
        var j = i; while (j < n && css[j] !== "{" && css[j] !== ";") j++;
        var prelude = css.slice(i, j).trim();
        var name = (prelude.match(/^@([\w-]+)/) || [])[1] || "";
        if (j >= n || css[j] === ";") { out += prelude + ";\n"; i = j + 1; continue; }
        var ab = _readBlock(css, j);
        out += /^(media|supports|container|layer)$/i.test(name)
          ? prelude + " {\n" + _scopeBlock(ab.inner, scope) + "}\n"
          : prelude + " {" + ab.inner + "}\n";
        i = ab.end; continue;
      }
      var k = i; while (k < n && css[k] !== "{" && css[k] !== "}") k++;
      if (k >= n || css[k] === "}") { i = k + 1; continue; }
      var blk = _readBlock(css, k);
      out += _scopeSel(css.slice(i, k), scope) + " {" + blk.inner + "}\n";
      i = blk.end;
    }
    return out;
  }
  function scopeDeckCss(css, scope) {
    return _scopeBlock(String(css).replace(/\/\*[\s\S]*?\*\//g, ""), scope || CARD_SCOPE);
  }

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

  // 把每个 deck 级 <style> 限定到 .cm-cards 作用域（杜绝全局选择器污染 + :root 令牌就近生效）。幂等。
  Viewer.prototype._scopeDeckStyles = function () {
    Array.prototype.forEach.call(this.cardsWrap.querySelectorAll("style"), function (st) {
      if (st.__cmSrc == null) st.__cmSrc = st.textContent;
      var scoped = scopeDeckCss(st.__cmSrc, CARD_SCOPE);
      if (st.textContent !== scoped) st.textContent = scoped;
    });
  };
  Viewer.prototype.refresh = function () {
    this._scopeDeckStyles();
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

  // deck 级 data-font 是整套字体契约；没有 deck 字体时才允许单卡 data-font。
  Viewer.prototype._applyFonts = function () {
    var self = this;
    this.cards.forEach(function (c) {
      var key = self.font || c.getAttribute("data-font") || "";
      if (key && FONTS[key]) {
        ensureFont(key);
        c.setAttribute("data-cm-font-lock", key);
        c.style.setProperty("--cm-font-sans", FONTS[key].family, "important");
        c.style.setProperty("--cm-font-serif", FONTS[key].family, "important");
      } else {
        c.removeAttribute("data-cm-font-lock");
        c.style.removeProperty("--cm-font-sans");
        c.style.removeProperty("--cm-font-serif");
      }
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

  // 等比缩放：普通 deck 按画布完整适配；公众号长文只按宽度适配，允许纵向滚动阅读。
  Viewer.prototype._fit = function () {
    var p = PRESETS[this.preset];
    var aw = this.stage.clientWidth - 48, ah = this.stage.clientHeight - 48;
    if (aw <= 0 || ah <= 0) return;
    var scale = this.preset === "story" ? Math.min(1, aw / p.w) : Math.min(aw / p.w, ah / p.h);
    this.scaler.style.transform = "scale(" + scale + ")";
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
