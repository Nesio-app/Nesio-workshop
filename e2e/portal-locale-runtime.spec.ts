import { expect, test, type Page } from '@playwright/test';

const BOTTOM_NAV_NAME = /Nesio 导航|Nesio navigation|底部导航|Bottom navigation|宝盒导航/;

async function bootWithLocale(page: Page, locale: string) {
  await page.goto('/');
  await page.evaluate((nextLocale) => {
    localStorage.setItem('treasurebox-onboarding-v14-done', '1');
    localStorage.setItem('treasurebox-locale', nextLocale);
  }, locale);
  await page.reload();
}

test('portal shell bottom nav and AI entry follow saved English locale', async ({ page }) => {
  await bootWithLocale(page, 'en');

  const nav = page.getByRole('navigation', { name: BOTTOM_NAV_NAME });
  await expect(nav.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'AI Friends' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Toolbox' })).toBeVisible();
  await expect(nav.getByRole('button', { name: '首页' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '智友' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '工具箱' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Break it down' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await expect(page.getByText('Gentle reminder')).toBeVisible();
  await expect(page.getByText('Inventory')).toBeVisible();
  await expect(page.getByText('Organize this week’s restock list')).toBeVisible();
  await expect(page.getByText('温馨提醒')).toHaveCount(0);
  await expect(page.getByText('粉碎任务')).toHaveCount(0);
  await expect(page.getByText('物品库')).toHaveCount(0);

  await nav.getByRole('button', { name: 'AI Friends' }).click();
  await expect(page.getByRole('region', { name: 'AI Friends' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI Friends' })).toBeVisible();
});
