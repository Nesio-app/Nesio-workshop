import { expect, test } from '@playwright/test';

test('shell toolbox opens, keeps its open state after refresh, and closes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  const treasureButton = page.getByRole('button', { name: /打开宝盒工具/ });
  await expect(treasureButton).toBeVisible();

  const triggerBox = await treasureButton.boundingBox();
  expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await treasureButton.click({ force: true });

  const popup = page.locator('.portal-treasure-popup');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.portal-treasure-popup-title')).toContainText(/宝盒|工具/);

  const toolButtons = popup.locator('.portal-tool-card');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBeGreaterThanOrEqual(1);

  const firstToolBox = await toolButtons.first().boundingBox();
  expect(firstToolBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(firstToolBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.reload();
  await expect(page.locator('.portal-treasure-popup')).toBeVisible();

  const closeButton = page.locator('.portal-treasure-popup-close');
  const closeBox = await closeButton.boundingBox();
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await closeButton.click({ force: true });
  await expect(page.locator('.portal-treasure-popup')).toBeHidden();

  await page.reload();
  await expect(page.locator('.portal-treasure-popup')).toBeHidden();
});

test('personal lab toolbox exposes every registered tool for testing', async ({ page }) => {
  await page.goto('/?baohePersonalLab=1');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  const treasureButton = page.getByRole('button', { name: /打开宝盒工具/ });
  await expect(treasureButton).toBeVisible();
  await treasureButton.click({ force: true });

  const popup = page.locator('.portal-treasure-popup');
  await expect(popup).toBeVisible();
  const toolButtons = popup.locator('.portal-tool-card');
  await expect(toolButtons.first()).toBeVisible();
  await expect.poll(() => toolButtons.count()).toBeGreaterThanOrEqual(11);

  for (const name of ['智友', '待办', '刷题', '收纳', '咨询', '冥想', '阅读', '健身', '溯', '财务', '人生']) {
    await expect(popup.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
});
