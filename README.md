<div align="center">

# CardMaker

**用 HTML 设计卡片，像 PPT 一样放映，一键导出高清图片和 PDF。**

纯静态 · 零构建 · LLM 友好

[Cloudflare Pages 在线访问](https://cardmaker-450.pages.dev)

</div>

---

CardMaker 是一个轻量的卡片设计运行时。你（或 LLM）用 HTML/CSS 写出有设计感的卡片，它负责：

- 📐 **固定比例画布** — 小红书 3:4、方形 1:1、PPT 16:9，原生像素渲染
- 🎬 **放映** — 翻页、键盘控制、全屏，像演示一样展示
- 🖼️ **一键出图** — 单张 / 批量打包，导出 2x 高清 PNG；也可整套导出 PDF（基于 [html-to-image](https://github.com/bubkoo/html-to-image) / JSZip / jsPDF）
- 💾 **存档不丢** — 自动存本地，刷新自动恢复；「导出 HTML」可导出**自包含的单文件 deck**（运行时内联），双击即开放映、可分享；回到 CardMaker 点「导入 HTML」可导入再编辑
- 🤖 **为 AI 而生** — 把 [`PROMPT.md`](./PROMPT.md) 喂给 LLM，它就能直接产出整个 deck

没有构建步骤，没有依赖安装。`clone` 下来双击 HTML 就能用，也能直接挂 GitHub Pages。

## 快速开始

```bash
git clone https://github.com/yourname/cardmaker.git
cd cardmaker
```

**方式一：直接打开**
用浏览器打开 [`index.html`](./index.html)（项目主页，本身就是一个 deck），或 [`examples/xiaohongshu.html`](./examples/xiaohongshu.html) 看示例。双击本地文件即可放映与导出，**无需起服务器**。

**方式二：起本地服务器**（AI 直连大模型更稳，避免 `file://` 源被部分服务商 CORS 拒绝）
```bash
npm run dev          # → http://localhost:8765 （零依赖，内部调用 npx serve）
# 或任意静态服务器，例如：
python3 -m http.server 8765
```

> 本项目**纯静态、零构建**：没有需要安装的依赖，`npm run dev` 只是用 `npx serve` 起个静态服务器。

## 写一个 deck

一个 deck 就是一个 HTML 文件。引入运行时，写若干 `<section class="card">`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="cardmaker.css" />
</head>
<body>
  <div data-cardmaker data-preset="xiaohongshu" data-title="我的卡片">

    <section class="card" data-theme="gradient">
      <div class="cm-kicker">眉题</div>
      <h1 class="cm-display">大标题</h1>
      <p class="cm-lead">一句话副标题</p>
    </section>

    <section class="card" data-theme="dark">
      <h2>第二页</h2>
      <p>正文，<strong>重点</strong>自动高亮。</p>
    </section>

  </div>
  <script src="cardmaker.js"></script>
</body>
</html>
```

打开它 → 翻页浏览 → 点「打包导出 PNG」拿到图片。完整的写法见 [`PROMPT.md`](./PROMPT.md)。

## 导入 HTML

点击工具栏的「导入 HTML」，选择之前通过「导出 HTML」下载的 `.html` 文件，CardMaker 会自动提取文件里的 `[data-cardmaker]` deck，同步原来的比例、标题、字体和卡片内容。

## 上传 Markdown 生成当前模版内容

先在比例选择器里选好要生成的模版，再在右侧 AI 助手输入框附近点击「上传 MD」，选择 `.md` / `.markdown` 文件。AI 助手会按当前模版根据 Markdown 内容生成 deck。需要先配置 API Key。

## 让 AI 帮你做

### 方式一：内置 AI（填 Key 直接生成）

引入可选模块 [`cardmaker-ai.js`](./cardmaker-ai.js)（连同配置文件），工具栏会多出「**✦ AI 生成**」按钮：

```html
<script src="cardmaker.js"></script>
<script src="cardmaker.config.js"></script>
<script src="cardmaker-ai.js"></script>
```

点开后只需**选服务商、填 API Key**，再写主题、选比例页数，即可让大模型按脚手架直接产出整个 deck，生成后立刻放映、出图、还能在编辑器里微调。

- **纯前端直连**大模型，无后端；API Key 只存在你本地浏览器（可选「记住 API Key」存 localStorage）。
- 服务商的接口地址（base）与默认模型都写在配置文件 [`cardmaker.config.js`](./cardmaker.config.js) 里，用户界面不必填：

  | 服务商 | 默认模型 | Base URL |
  |---|---|---|
  | **DeepSeek**（默认） | `deepseek-v4-flash` | `https://api.deepseek.com/v1` |
  | **通义千问 Qwen** | `qwen3.5-flash` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
  | **MiniMax** | `minimax-m3` | `https://api.minimax.chat/v1` |

  想换模型、改地址或加新服务商，编辑 `cardmaker.config.js` 即可（需为 OpenAI 兼容接口）。
- 个别服务商若在浏览器端禁用了 CORS，需用支持跨域的端点或自行加一层代理。

### 方式二：把契约喂给任意 LLM

1. 把 [`PROMPT.md`](./PROMPT.md) 完整发给任意 LLM（Claude、GPT 等）；
2. 描述你的真实主题、比例和页数；
3. 把它产出的 HTML 存成文件，和 `cardmaker.css` / `cardmaker.js` 放在一起；
4. 浏览器打开，放映 + 出图。

脚手架给 LLM 一块尺寸精确、约束清晰的画布——它专注创意，运行时专注放映与出图。

## 比例预设

| `data-preset` | 比例 | 像素 | 场景 |
|---|---|---|---|
| `xiaohongshu` | 3:4 | 1080×1440 | 小红书（默认） |
| `square` | 1:1 | 1080×1080 | 通用社交卡片 |
| `ppt` | 16:9 | 1280×720 | 演示 / 宽屏 |

## 主题

`light` · `dark` · `warm` · `ink` · `mint` · `gradient` · `ocean` · `sky` · `sunset` · `forest` · `paper` · `bold` · `pastel` · `tech` · `cream` · `night`，写在卡片的 `data-theme` 上。建议整套统一一个主题。想要专属配色，在 section 上内联改 token：`style="--cm-accent:ACCENT_COLOR"`。

## 字体

默认用系统苹方（零加载、出图稳）。想要更有设计感的中文字体，在 deck 根或单卡加 `data-font`：

```html
<div data-cardmaker data-preset="xiaohongshu" data-font="song">
```

可选：`hei` 系统黑体 · `song` 系统宋体 · `kai` 霞鹜文楷 · `smiley` 得意黑 · `xiaowei` 文艺宋降级 · `kuaile` 活泼圆体降级 · `mao` 书法体降级。默认不依赖 Google Fonts；只有字体表里配置了 `css` 的字体才会按需加载。字体表见 [`app/deck.js`](./app/deck.js) 的 `FONTS`，可自行增删。

## 快捷键

| 键 | 作用 |
|---|---|
| `→` `←` / 空格 | 翻页 |
| `F` | 全屏放映 |
| `E` | 导出当前页 |
| `Esc` | 退出放映 |

## 工作原理

- 卡片用**原生像素尺寸**渲染，屏幕上靠父层 `transform: scale` 等比缩放——所以导出时按原生分辨率栅格化，保证高清。
- 出图依赖（html-to-image / JSZip / jsPDF）在你点导出时才从 CDN 懒加载，平时零负担。
- 默认系统字体栈，规避跨域 web 字体导出失败的坑。

## License

[MIT](./LICENSE)
