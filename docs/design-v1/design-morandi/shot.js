const { chromium } = require('/workspace/treasurebox/node_modules/playwright');
(async () => {
  const file = process.argv[2];
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto('file://' + file);
  await page.waitForTimeout(700);
  const out = file.replace(/\.html$/, '.png');
  const body = await page.$('body');
  await body.screenshot({ path: out });
  await browser.close();
  console.log('WROTE', out);
})();
