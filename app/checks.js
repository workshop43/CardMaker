/* =============================================================
   生成后检查器（checker）框架
   模型生成模板后，对【已渲染进 DOM 的真实卡片】做体检。可确定性修复的直接纠正，
   需要重排的反馈给模型。扩展方式：写一个 (card, ctx) => 修复数 的检查函数，加进 CHECKS。

   现状：字号检查（fixTinyText 自动放大）已按用户要求【移除】——不再用令牌/检查器限制字号，
   字号交回模型自由设计。框架保留，预留给「重合检测」「大片空白检测」等（检测→反馈模型重排）。
   ============================================================= */
"use strict";

// 启用的检查项；目前为空（字号检查已移除）。
var CHECKS = [];

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
