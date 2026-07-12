# 设计规范 v1(莫兰迪)—— 宝盒/Nesio

> 来源:另一 agent 的设计轮次成果。原推到 `keep2notion` 仓库(推错库),
> 本目录是搬进宝盒主库的副本,作为后续 UI 改造的落地依据。合并批次:批次 97。

## 目录

- **`design-morandi/design-spec.html`** — 完整设计规范(自包含,内嵌全部截图,浏览器直接打开)
- **`design-morandi/mockups/`** — 各页最终设计稿(HTML 源 + PNG):今天 / 记忆 / 洞察 / 多面镜 / 足迹 / 念念 / 心情 / 设置 / 记一笔 / 卡片 / 水晶球 / 命名 / 定名 …
- **`design-morandi/spec.html` + `embed.js` + `shot.js`** — 规范源文件与生成脚本
- **`design-morandi/PATCH-4palettes-lab.md`** — 4 色卡落地补丁说明(待落到代码)
- **`design-morandi/README.md`** — 关键决定速查(助理念念/Nessa、默认皮肤、命名、图标沿用、心情 12 色)
- **`screens-svg/`** — 各屏 SVG 设计稿
- **`treasurebox-review.md` / `treasurebox-tech-spec.md` / `treasurebox-redesign.html`** — 软件评测 + 技术规范 + 重设计稿

## 关键决定(速查)

- 助理定名:**念念 / Nessa**
- 配色:莫兰迪色系,默认皮肤 + 4 色卡(见 PATCH-4palettes-lab.md)
- 心情系统:12 色
- 命名/图标:沿用既有约定,详见 design-spec.html

> 落地方式:后续 UI 批次按 design-spec.html 逐页对齐;`PATCH-4palettes-lab.md`
> 里的色卡先落到 CSS token,再逐面套用。
