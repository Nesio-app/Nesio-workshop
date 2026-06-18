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
  await expect(popup.getByRole('button', { name: /智友/ })).toHaveCount(0);
  await expect(popup.getByRole('button', { name: /收纳/ })).toBeVisible();

  await page.waitForTimeout(450);
  const popupBox = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(popupBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((popupBox?.x ?? 0) + (popupBox?.width ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(viewport?.width ?? 390);

  const toolButtons = popup.locator('.portal-tool-card');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBe(1);

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

test('secretary floating button opens the restored secretary page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  await page.locator('.portal-quick-chat-fab').click({ force: true });
  await expect(page).toHaveURL(/\/secretary\/?$/);
  await expect(page.locator('body')).toContainText(/智友|Gemini|ChatGPT|豆包/);

  await page.goto('/');
  await page.getByRole('button', { name: /打开宝盒工具/ }).click({ force: true });
  await expect(page.locator('.portal-treasure-popup').getByRole('button', { name: /智友/ })).toHaveCount(0);
});

test('dashboard header actions keep aligned 44px hit targets', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.portal-dash-hero-end')).toBeVisible();
  const boxes = await page.evaluate(() => {
    const [noteButton, treasureButton] = Array.from(
      document.querySelectorAll('.portal-dash-hero-end button'),
    );
    const note = noteButton?.getBoundingClientRect();
    const treasure = treasureButton?.getBoundingClientRect();
    return note && treasure
      ? {
          noteTop: note.top,
          treasureTop: treasure.top,
          noteWidth: note.width,
          noteHeight: note.height,
          treasureWidth: treasure.width,
          treasureHeight: treasure.height,
        }
      : null;
  });

  expect(boxes).not.toBeNull();
  expect(Math.abs((boxes?.noteTop ?? 0) - (boxes?.treasureTop ?? 0))).toBeLessThanOrEqual(1);
  expect(boxes?.noteWidth ?? 0).toBeGreaterThanOrEqual(44);
  expect(boxes?.noteHeight ?? 0).toBeGreaterThanOrEqual(44);
  expect(boxes?.treasureWidth ?? 0).toBeGreaterThanOrEqual(44);
  expect(boxes?.treasureHeight ?? 0).toBeGreaterThanOrEqual(44);
});

test('daily quote settings can choose positive categories and frequency', async ({ page }) => {
  await page.goto('/');
  await page.locator('.portal-quote').click({ force: true });
  await expect(page.getByRole('dialog', { name: /金句设置/ })).toBeVisible();

  await page.getByRole('button', { name: '每天' }).click();
  await page.getByRole('button', { name: '诗意' }).click();
  await page.getByLabel('关闭金句设置').click();

  const stored = await page.evaluate(() => localStorage.getItem('treasurebox-quote-preferences-v1'));
  expect(stored).toContain('"frequency":"daily"');
  expect(stored).toContain('"classic"');
});

test('settings calendar link appears on dashboard calendar card', async ({ page }) => {
  await page.goto('/settings');
  const calendarUrl = 'https://calendar.google.com/calendar/u/0/r';
  await page.locator('#settings-calendar-url').fill(calendarUrl);
  await page.getByRole('button', { name: '保存日历链接' }).click();

  await page.goto('/');
  const openLink = page.locator('.portal-calendar-open-link', { hasText: '打开' });
  await expect(openLink).toBeVisible();
  await expect(openLink).toHaveAttribute('href', calendarUrl);
});

test('personal lab toolbox exposes non-secretary registered tools for testing', async ({ page }) => {
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
  await expect.poll(() => toolButtons.count()).toBeGreaterThanOrEqual(10);

  await expect(popup.getByRole('button', { name: /智友/ })).toHaveCount(0);
  for (const name of ['待办', '刷题', '收纳', '咨询', '冥想', '阅读', '健身', '溯', '财务', '人生']) {
    await expect(popup.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
});

test('personal lab mode persists after activation and can be cleared', async ({ page }) => {
  await page.goto('/?baohePersonalLab=1');
  await page.waitForFunction(() => window.localStorage.getItem('baohe_personal_lab') === '1');
  await page.goto('/');
  await page.getByRole('button', { name: /打开宝盒工具/ }).click({ force: true });
  await expect.poll(() => page.locator('.portal-treasure-popup .portal-tool-card').count()).toBeGreaterThanOrEqual(10);

  await page.goto('/?baohePublic=1');
  await page.waitForFunction(() => window.localStorage.getItem('baohe_personal_lab') !== '1');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.getByRole('button', { name: /打开宝盒工具/ }).click({ force: true });
  await expect.poll(() => page.locator('.portal-treasure-popup .portal-tool-card').count()).toBe(1);
});
