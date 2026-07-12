const { chromium } = require('/workspace/treasurebox/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const D = '/tmp/claude-0/-home-user-keep2notion/5d702f46-8da6-5a3e-aca7-cac347b9c5fb/scratchpad/design-morandi';

// key -> {file, cap}
const SHOTS = {
  nessa:      {file:'name-final.png',   cap:'助理定名 · 念念 / Nessa 的身份、口吻与出场'},
  appearance: {file:'appearance.png',   cap:'外观设置 · 配色(4 皮肤) + 明暗(3)'},
  orbs:       {file:'orb-halo.png',     cap:'水晶球质感 · 哑光白核 + 淡彩光晕(日 / 夜)'},
  logo:       {file:'logo-original.jpeg',cap:'App 图标 · 现有玻璃立方体(沿用)'},
  cards:      {file:'memory-unify.png', cap:'统一卡片模板 + 6 来源徽章体系'},
  wheel:      {file:'mood-wheel2.png',  cap:'情绪盘(中心填色) + 首页取盘对应色'},
  moodlayers: {file:'mood.png',         cap:'心情四层 · 情绪盘 / 能量 / 一句话 / 历史'},
  naming:     {file:'naming.png',       cap:'命名系统(中文) · 定规则,只升级 6 个'},
  namingen:   {file:'naming-en.png',    cap:'命名系统(English)'},
  // pages gallery
  today:      {file:'mood-node.png',    cap:'今天 · 回顾 + 时间线,心情作「现在」第一拍'},
  memory:     {file:'memory-goods.png', cap:'记忆 · 记忆罐(3 球) + 收纳入口 + 卡片流'},
  insights:   {file:'insight-tab1.png', cap:'洞察'},
  mirror:     {file:'insight-tab2c.png',cap:'多面镜'},
  places:     {file:'insight-tab3c.png',cap:'足迹 · 地点 / 世界'},
  ask:        {file:'ask3.png',         cap:'念念 · 对话入口(原「问一问」)'},
  settings:   {file:'settings-clean.png',cap:'设置'},
  capture:    {file:'capture-final.png',cap:'记一笔 · 均匀弧 3 项(拍一下/说一句/收进来)'},
  decompose:  {file:'decompose.png',    cap:'任务 AI 细化 · 微步骤'},
};

const CAP_W = 900;   // max css width
const QUALITY = 78;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = {};
  for (const [key, s] of Object.entries(SHOTS)) {
    const fp = path.join(D, s.file);
    if (!fs.existsSync(fp)) { console.log('MISSING', s.file); continue; }
    const page = await browser.newPage();
    await page.goto('file://' + fp);
    const nat = await page.evaluate(() => {
      const img = document.querySelector('img');
      return img ? {w: img.naturalWidth, h: img.naturalHeight} : null;
    });
    const w = Math.min(nat.w, CAP_W);
    await page.addStyleTag({content: `img{width:${w}px!important;height:auto!important;image-rendering:auto}`});
    await page.waitForTimeout(120);
    const el = await page.$('img');
    const buf = await el.screenshot({type:'jpeg', quality: QUALITY});
    out[key] = 'data:image/jpeg;base64,' + buf.toString('base64');
    console.log(key, s.file, `${w}px`, Math.round(buf.length/1024) + 'KB');
    await page.close();
  }
  await browser.close();

  // inject into spec.html
  let html = fs.readFileSync(path.join(D, 'spec.html'), 'utf8');
  for (const [key, s] of Object.entries(SHOTS)) {
    const marker = `<!--SHOT:${key}-->`;
    const uri = out[key];
    const centered = (key === 'logo');
    const imgStyle = centered ? ' style="width:auto;max-width:180px;margin:22px auto"' : '';
    const fig = uri
      ? `<figure class="shot"><img src="${uri}" alt="${s.cap}"${imgStyle} loading="lazy"/><figcaption>${s.cap}</figcaption></figure>`
      : '';
    html = html.replace(marker, fig);
  }
  fs.writeFileSync(path.join(D, 'spec-final.html'), html);
  const kb = Math.round(fs.statSync(path.join(D,'spec-final.html')).size/1024);
  console.log('WROTE spec-final.html', kb + 'KB');
})();
