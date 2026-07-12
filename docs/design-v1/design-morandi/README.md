# 宝盒 / Nesio 设计规范 v1

莫兰迪低饱和视觉体系的完整设计交付。冷静而温暖、回溯不预测、少即是多。

## 主要文件

- **`design-spec.html`** — 完整设计规范(自包含,内嵌全部截图)。浏览器直接打开即可。
  涵盖:设计原则 · 品牌与念念 · 色彩系统(4 皮肤 + 明暗) · 字体 · 图标 · 标志性元素(水晶球/心情波纹/App 图标) · 卡片与来源体系 · 心情系统(12 色 + 落位) · 命名(中/英) · 页面布局 · 语气。
- `spec.html` — 规范源文件(不含图,图位为 `<!--SHOT:key-->` 占位)。
- `embed.js` — 用 Playwright 压缩 mockup 截图并注入 `spec.html` → 生成 `design-spec.html`。
- `shot.js` — 把任一 mockup HTML 渲染成 PNG。
- `mockups/` — 各页最终设计稿(HTML 源 + PNG)。
- `labpreview.html` / `PATCH-4palettes-lab.md` — 4 套低饱和色卡在实验板块的预览 + 落地补丁。

## 关键决定速查

- **助理**:念念 / Nessa(对话入口直接以她命名,原「问一问」)。
- **默认皮肤**:蓝灰·灰粉(brand `#C07F79` / deep `#B06F68`)。
- **命名**:拍一下 / 说一句 / 收进来 · 今天 / 记忆 / 念念 / 洞察 / 多面镜 / 足迹 · 收纳 / 收藏 / 核心记忆 / 项目。
- **App 图标**:沿用现有玻璃立方体(`mockups/logo-original.jpeg`),不改。
- **心情**:12 色定稿;落位为今天页时间线「现在」第一拍,专属圆角方块 + 波纹符号,文字取盘对应色(低饱和)。

## 重新生成规范

```bash
node shot.js mockups/<name>.html      # 渲染单张 mockup
node embed.js                          # 压缩注入 → design-spec.html
```
