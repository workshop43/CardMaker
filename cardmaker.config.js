/* =============================================================
   CardMaker AI 配置
   在这里维护服务商：base(接口地址) 与 model(默认模型)。
   用户在界面上只需「选服务商 + 填 API Key」，不必关心这些。
   新增服务商：照下面格式加一项即可（需为 OpenAI 兼容的 /chat/completions 接口）。
   ============================================================= */
window.CardMakerConfig = {
  // 面板默认选中的服务商
  defaultProvider: "deepseek",

  providers: {
    deepseek: {
      label: "DeepSeek",
      base: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    },
    qwen: {
      label: "通义千问 Qwen",
      base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.5-flash",
    },
    minimax: {
      label: "MiniMax",
      base: "https://api.minimax.chat/v1",
      model: "minimax-m3",
    },
  },
};
