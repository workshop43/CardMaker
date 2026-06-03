/* =============================================================
   入口：加载运行时（deck.js 自动初始化 [data-cardmaker]），
   实例就绪后挂上 AI 生成/修改面板。
   index.html / examples/*.html 用 <script type="module" src=".../app/main.js"> 引入。
   ============================================================= */
import { CardMaker } from "./deck.js";
import { mountAI } from "./ai/ui.js";

// deck.js 在模块加载时已 autoInit 并登记 ready 机制；这里等实例就绪后挂 AI 面板。
CardMaker.ready(function (app) { mountAI(app); });
