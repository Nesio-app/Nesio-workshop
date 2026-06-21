import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const screenshotDir = join(process.cwd(), 'outputs/v14-runtime-screenshots');
const BOTTOM_NAV_NAME = /Nesio 导航|底部导航|Bottom navigation|宝盒导航/;

async function saveShot(page: Page, name: string) {
  await page.screenshot({
    path: join(screenshotDir, `${name}.png`),
    fullPage: true,
  });
}

test('capture V14 mobile runtime screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotDir, { recursive: true });

  const manifest: Array<{ name: string; path: string; note: string }> = [];
  const capture = async (name: string, note: string) => {
    await saveShot(page, name);
    manifest.push({ name, path: `outputs/v14-runtime-screenshots/${name}.png`, note });
  };
  const captureLocator = async (selector: string, name: string, note: string) => {
    await page.locator(selector).screenshot({
      path: join(screenshotDir, `${name}.png`),
    });
    manifest.push({ name, path: `outputs/v14-runtime-screenshots/${name}.png`, note });
  };

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('treasurebox-onboarding-v14-done');
    localStorage.removeItem('treasurebox-onboarding-v13-done');
    localStorage.removeItem('treasurebox-profile-name');
    localStorage.removeItem('treasurebox-coach-style');
    localStorage.removeItem('treasurebox-personalization-insight-shown-day');
    localStorage.removeItem('treasurebox-personalization-insight-feedback:insight-friday-productivity');
    localStorage.removeItem('treasurebox-personalization-insight-suppressed-until:insight-friday-productivity');
  });
  await page.reload();
  await expect(page.getByRole('dialog', { name: /欢迎来到 Nesio/ })).toBeVisible();
  await capture('01-onboarding-name', 'Onboarding display name frame.');

  await page.getByLabel('怎么称呼你').fill('Jing');
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByText('选择一种陪伴风格')).toBeVisible();
  await capture('02-onboarding-coach-style', 'Onboarding coach style frame.');

  await page.getByRole('button', { name: '温暖陪伴' }).click();
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByText('温馨提醒')).toBeVisible();
  await expect(page.getByText('物品库')).toBeVisible();
  await capture('03-home-warm-coach', 'Home warm coach with V14 insight-aware launch surface.');

  await page.getByRole('button', { name: /粉碎任务/ }).click();
  await expect(page.getByRole('dialog', { name: /粉碎任务/ })).toBeVisible();
  await capture('04-crush-task-sheet', 'Task-crushing bottom sheet.');
  await page.locator('.portal-crush-sheet-close').click();

  await page.getByRole('navigation', { name: BOTTOM_NAV_NAME }).getByRole('button', { name: '智友' }).click();
  await expect(page.getByRole('heading', { name: '智友' })).toBeVisible();
  await expect(page.getByText(/一个输入框，后台自动调度 AI 与工具/)).toHaveCount(0);
  await expect(page.getByLabel('智友集合输入框')).toBeVisible();
  await capture('05-ai-friends-unified-chat', 'AI Friends unified chat workspace with one composer and multi-agent messages.');

  await page.getByLabel('智友集合输入框').fill('@');
  await expect(page.getByRole('listbox', { name: '@ 调度候选' })).toBeVisible();
  await capture('05b-ai-friends-mention-menu', 'AI Friends @ routing menu for AI and tool context.');
  await page.getByRole('listbox', { name: '@ 调度候选' }).getByRole('option', { name: /@Claude/ }).click();

  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByRole('region', { name: '智友搜索' })).toBeVisible();
  const searchInput = page.getByPlaceholder(/搜索对话、笔记、AI 建议/);
  await expect(searchInput).toBeVisible();
  await expect(page.getByRole('button', { name: /AI 建议/ })).toHaveCount(0);
  await searchInput.focus();
  await expect(page.getByRole('button', { name: /AI 建议/ })).toBeVisible();
  await capture('05c-ai-friends-search', 'AI Friends search surface with shortcut grid and recent conversations.');
  await page.getByRole('button', { name: '返回智友' }).click();

  await page.getByRole('button', { name: '通话' }).click();
  await expect(page.getByRole('dialog', { name: 'Live 通话' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Live 通话' }).getByText('虚拟形象')).toHaveCount(0);
  await capture('05d-ai-friends-live-call-sheet', 'Live call sheet with video/audio only; video implies avatar call.');
  await page.getByRole('dialog', { name: 'Live 通话' }).getByRole('button', { name: /视频通话/ }).click();
  await expect(page.getByRole('dialog', { name: 'AI 虚拟形象视频通话' })).toBeVisible();
  await capture('05e-ai-friends-video-call-mock', 'Mock AI avatar video call surface.');
  await page.getByRole('button', { name: '结束' }).click();

  await page.getByRole('navigation', { name: BOTTOM_NAV_NAME }).getByRole('button', { name: '工具箱' }).click();
  await expect(page.getByRole('heading', { name: '工具箱' })).toBeVisible();
  await expect(page.getByLabel('我的工具')).toBeVisible();
  await expect(page.getByLabel('可添加')).toBeVisible();
  await expect(page.getByLabel('个性化推荐')).toBeVisible();
  await expect(page.getByLabel('工具包')).toBeVisible();
  await expect(page.getByLabel('数据深度')).toHaveCount(0);
  await page.waitForTimeout(500);
  await capture('06-tool-packs-discovery', 'Toolbox screen with V14 data cards, personalized recommendation, addable tools, and packs.');

  await page.goto('/settings');
  await expect(page.getByText('Nesio 学到的')).toBeVisible();
  await expect(page.getByText('个性化偏好')).toBeVisible();
  await capture('08-me-personal-data', 'Profile analysis and learned memories without app settings mixed in.');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '软件设置' })).toBeVisible();
  await expect(page.getByRole('region', { name: '连接与安全' })).toBeVisible();
  await capture('09-software-settings', 'Software settings page with connections and safety boundary.');

  await page.goto('/storage');
  const firstLaunch = page.locator('#firstLaunch');
  if (await firstLaunch.isVisible()) {
    await page.getByRole('button', { name: '使用 Demo 体验' }).click();
  }
  await expect(page.getByLabel('物品库首发能力')).toBeVisible();
  await capture('07-inventory-purchase-memory', 'Inventory purchase-memory first-launch surface.');

  writeFileSync(
    join(screenshotDir, 'manifest.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      viewport: { width: 390, height: 844 },
      sourceSpec: '/Users/jing/Downloads/treasureboxredesign 14.html',
      screenshots: manifest,
    }, null, 2),
  );
});
