/* =============================================================
   生成后检查器（checker）框架
   模型生成模板后，对【已渲染进 DOM 的真实卡片】做体检。可确定性修复的直接纠正，
   需要重排的反馈给模型。扩展方式：写一个 (card, ctx) => 修复数 的检查函数，加进 CHECKS。

   现状：字号交回模型自由设计；检查器只处理确定性版面安全问题。
   ============================================================= */
"use strict";

// 启用的检查项。
var CHECKS = [fitOverflow];

// 对一组卡片跑全部检查（卡片已进 DOM、完成布局后调用）。返回总修复数。
export function runChecks(cards, preset) {
  if (!CHECKS.length || !cards || !cards.length) return 0;
  var ctx = { preset: preset };
  var total = 0;
  for (var i = 0; i < cards.length; i++) {
    for (var j = 0; j < CHECKS.length; j++) {
      total += CHECKS[j](cards[i], ctx) || 0;
    }
  }
  return total;
}

// 基于真实 DOM 的溢出安全网：当正文区超过 .cm-main 可用高度时，确定性降低排版密度。
function fitOverflow(card, ctx) {
  var main = card && card.querySelector(".cm-main");
  if (!card || !main) return 0;
  if (!overflows(card, main)) {
    card.removeAttribute("data-overflow");
    return 0;
  }

  var changed = 0;
  for (var i = 0; i < 6 && overflows(card, main); i++) {
    var scale = fitScale(main);
    changed += scaleText(main, scale);
    changed += scaleSpacing(main, scale);
  }

  if (overflows(card, main)) card.setAttribute("data-overflow", "true");
  else card.removeAttribute("data-overflow");
  return changed;
}

function overflows(card, main) {
  return (main.scrollHeight > main.clientHeight + 2) || (card.scrollHeight > card.clientHeight + 2);
}

function fitScale(main) {
  if (!main.scrollHeight || !main.clientHeight) return 0.92;
  var ratio = main.clientHeight / main.scrollHeight;
  return Math.max(0.82, Math.min(0.96, Math.sqrt(ratio) * 0.98));
}

function scaleText(root, scale) {
  var changed = 0;
  var nodes = root.querySelectorAll("h1,h2,h3,p,li,span,strong,em,small,.cm-cell,.cm-feature-body,.cm-mini-card,.cm-lead,.cm-subtitle,.cm-title,.cm-display");
  Array.prototype.forEach.call(nodes, function (node) {
    var cs = getComputedStyle(node);
    var font = px(cs.fontSize);
    if (font) {
      var nextFont = Math.max(12, font * scale);
      if (Math.abs(nextFont - font) >= 0.5) {
        node.style.fontSize = round(nextFont) + "px";
        changed++;
      }
    }
    var lh = px(cs.lineHeight);
    if (lh) {
      var nextLine = Math.max(14, lh * Math.max(scale, 0.9));
      if (Math.abs(nextLine - lh) >= 0.5) {
        node.style.lineHeight = round(nextLine) + "px";
        changed++;
      }
    }
  });
  return changed;
}

function scaleSpacing(root, scale) {
  var changed = 0;
  var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll(".cm-grid,.cm-split,.cm-row,.cm-col,.cm-flow,.cm-cell,.cm-callout,.cm-band,.cm-bento,.cm-compare,.cm-process,.cm-step,.cm-insight,.cm-mini-card")));
  nodes.forEach(function (node) {
    var cs = getComputedStyle(node);
    ["gap", "rowGap", "columnGap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom"].forEach(function (prop) {
      var value = px(cs[prop]);
      if (!value || value < 4) return;
      var next = Math.max(prop.indexOf("padding") === 0 ? 4 : 0, value * scale);
      if (Math.abs(next - value) >= 0.5) {
        node.style[prop] = round(next) + "px";
        changed++;
      }
    });
  });
  return changed;
}

function px(value) {
  var n = parseFloat(String(value || ""));
  return isFinite(n) ? n : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
