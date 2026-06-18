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
