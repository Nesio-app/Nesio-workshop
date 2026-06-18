import { expect, test } from '@playwright/test';

test('mobile dashboard quote and widgets do not overlap', async ({ page }) => {
  await page.goto('/');

  const quote = page.locator('.portal-quote');
  const widgets = page.locator('.portal-widget');
  await expect(quote).toBeVisible();
  await expect(widgets).toHaveCount(2);

  const layout = await page.evaluate(() => {
    type Box = {
      className: string;
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    };

    const boxes = Array.from(document.querySelectorAll<HTMLElement>('.portal-quote, .portal-widget'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      });

    const [quoteBox, firstWidget, secondWidget] = boxes;
    const overlaps = (a: Box, b: Box) => {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    };

    if (!quoteBox || !firstWidget || !secondWidget) {
      return {
        boxes,
        quoteOverlapsFirstWidget: true,
        firstWidgetOverlapsSecondWidget: true,
        hasHorizontalOverflow: true,
      };
    }

    return {
      boxes,
      quoteOverlapsFirstWidget: overlaps(quoteBox, firstWidget),
      firstWidgetOverlapsSecondWidget: overlaps(firstWidget, secondWidget),
      widgetsShareRow: Math.abs(firstWidget.top - secondWidget.top) <= 2,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  expect(layout.quoteOverlapsFirstWidget).toBe(false);
  expect(layout.firstWidgetOverlapsSecondWidget).toBe(false);
  expect(layout.widgetsShareRow).toBe(true);
  expect(layout.hasHorizontalOverflow).toBe(false);
});

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
  await expect(popup.getByRole('button', { name: /智友/ })).toBeVisible();
  await expect(popup.getByRole('button', { name: /收纳/ })).toBeVisible();

  await page.waitForTimeout(450);
  const popupBox = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(popupBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((popupBox?.x ?? 0) + (popupBox?.width ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(viewport?.width ?? 390);

  const toolButtons = popup.locator('.portal-tool-card');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBeGreaterThanOrEqual(2);

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

test('secretary entry points open quick chat without leaving shell', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  await page.locator('.portal-secretary-fab').click({ force: true });
  await expect(page.locator('.portal-quick-chat--open')).toBeVisible();
  await expect(page).not.toHaveURL(/\/secretary\/?$/);

  await page.reload();

  const treasureButton = page.getByRole('button', { name: /打开宝盒工具/ });
  await treasureButton.click({ force: true });
  const popup = page.locator('.portal-treasure-popup');
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: /智友/ }).click({ force: true });
  await expect(page.locator('.portal-quick-chat--open')).toBeVisible();
  await expect(page).not.toHaveURL(/\/secretary\/?$/);
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
