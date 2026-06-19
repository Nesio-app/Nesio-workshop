import { expect, test, type Page } from '@playwright/test';

async function markOnboardingDone(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('treasurebox-onboarding-v14-done', '1');
  });
  await page.reload();
}

test('mobile dashboard quote and widgets do not overlap', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);

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

test('V14 warm coach home exposes one primary next action and inventory pack', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('treasurebox-onboarding-v14-done', '1'));
  await page.reload();

  await expect(page.getByText('做不完也没关系')).toBeVisible();
  await expect(page.getByRole('button', { name: /开始 2 分钟/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /稍后提醒/ })).toBeVisible();
  await expect(page.locator('.portal-v13-primary-action')).toHaveCount(1);

  await expect(page.getByText('轻启动包')).toBeVisible();
  await expect(page.getByRole('button', { name: /待办.*粉碎任务/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /物品库.*购买记忆/ })).toBeVisible();
  await expect(page.getByText('健康 / 金融 / 心理 / 自动化')).toBeVisible();

  const primaryButtons = page.locator('.portal-v13-primary-action');
  await expect(primaryButtons).toHaveCount(1);
  const primaryBox = await primaryButtons.first().boundingBox();
  expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(46);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await primaryButtons.first().click();
  const crushSheet = page.getByRole('dialog', { name: /粉碎任务/ });
  await expect(crushSheet).toBeVisible();
  await expect(crushSheet.getByText(/先完成最小的一件事/)).toBeVisible();
  await expect(crushSheet.getByRole('button', { name: '完成这一步' })).toBeVisible();
  await expect(crushSheet.getByRole('button', { name: '再拆小一点' })).toBeVisible();
  await expect(crushSheet.getByRole('button', { name: '打开待办' })).toBeVisible();

  await crushSheet.getByRole('button', { name: '打开待办' }).click();
  await expect(page).toHaveURL(/\/adhd-flow\/?/);
});

test('V14 first launch onboarding saves local name and coach style', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('treasurebox-onboarding-v14-done');
    localStorage.removeItem('treasurebox-profile-name');
    localStorage.removeItem('treasurebox-coach-style');
  });
  await page.reload();

  await expect(page.getByRole('dialog', { name: /欢迎来到宝盒/ })).toBeVisible();
  await expect(page.getByText('不需要注册 · 稍后随时连接账号')).toBeVisible();
  await page.getByLabel('怎么称呼你').fill('Jing');
  await page.getByRole('button', { name: '温暖陪伴' }).click();
  await page.getByRole('button', { name: '继续' }).click();

  await expect(page.getByRole('dialog', { name: /欢迎来到宝盒/ })).toHaveCount(0);
  await expect(page.getByText('Jing')).toBeVisible();
  await expect(page.getByText('做不完也没关系')).toBeVisible();

  const stored = await page.evaluate(() => ({
    done: localStorage.getItem('treasurebox-onboarding-v14-done'),
    name: localStorage.getItem('treasurebox-profile-name'),
    style: localStorage.getItem('treasurebox-coach-style'),
  }));
  expect(stored).toEqual({ done: '1', name: 'Jing', style: 'warm' });
});

test('V14 bottom nav opens AI Friends as gated stable hub preview', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);

  const nav = page.getByRole('navigation', { name: /底部导航|Bottom navigation|宝盒导航/ });
  await expect(nav.getByRole('button', { name: '首页' })).toBeVisible();
  await expect(nav.getByRole('button', { name: '智友' })).toBeVisible();
  await expect(nav.getByRole('button', { name: '工具箱' })).toBeVisible();

  await nav.getByRole('button', { name: '智友' }).click();
  const dialog = page.getByRole('dialog', { name: /智友/ });
  await expect(dialog).toBeVisible();
  for (const text of ['群聊', '单聊', '记录', 'ChatGPT', 'Claude', 'Gemini', 'Flomo', '物品库', '待办']) {
    await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText(/外部 AI 自动化尚未启用/)).toBeVisible();
  await expect(page).not.toHaveURL(/\/secretary/);
});

test('shell toolbox opens, keeps its open state after refresh, and closes', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);
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
  const pack = popup.getByLabel('工具包发现');
  await expect(pack).toBeVisible();
  await expect(pack.getByText('轻启动包')).toBeVisible();
  await expect(pack.getByRole('button', { name: /待办.*粉碎任务/ })).toBeVisible();
  await expect(pack.getByRole('button', { name: /物品库.*购买记忆/ })).toBeVisible();
  await expect(pack.getByText(/健康 \/ 金融 \/ 心理 \/ 自动化仍需确认/)).toBeVisible();
  await expect(popup.getByRole('button', { name: /待办，/ })).toBeVisible();
  await expect(popup.getByRole('button', { name: /收纳，/ })).toBeVisible();

  await page.waitForTimeout(450);
  const popupBox = await popup.boundingBox();
  const viewport = page.viewportSize();
  expect(popupBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((popupBox?.x ?? 0) + (popupBox?.width ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(viewport?.width ?? 390);

  const toolButtons = popup.locator('.portal-tool-card');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBe(2);

  const firstToolBox = await toolButtons.first().boundingBox();
  expect(firstToolBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(firstToolBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  const packButtonBox = await pack.getByRole('button', { name: /待办.*粉碎任务/ }).boundingBox();
  expect(packButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

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

test('secretary public surface stays gated outside launch scope', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  await expect(page.locator('.portal-quick-chat-fab')).toHaveCount(0);
  const response = await page.goto('/secretary');
  expect(response?.status()).toBe(403);
  await expect(page.locator('body')).toContainText(/能力暂未开放|gated|暂未开放/);

  await page.goto('/');
  await page.getByRole('button', { name: /打开宝盒工具/ }).click({ force: true });
  await expect(page.locator('.portal-treasure-popup').getByRole('button', { name: /智友/ })).toHaveCount(0);
});

test('dashboard header actions keep aligned 44px hit targets', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);
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
  await markOnboardingDone(page);
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

test('settings exposes V14 connections and safety boundary', async ({ page }) => {
  await page.goto('/settings');
  const safety = page.getByRole('region', { name: '连接与安全' });
  await expect(safety).toBeVisible();
  await expect(safety.getByText('连接性强，但所有授权都要确认。')).toBeVisible();
  await expect(safety.getByText('Local-first')).toBeVisible();
  for (const text of ['Google Calendar', '智友 AI', '健康 / 金融 / 心理', '自动化与外部授权']) {
    await expect(safety.getByText(text)).toBeVisible();
  }
  await expect(safety.getByText(/外部 AI 自动化和文件\/语音\/Live 需要另行确认/)).toBeVisible();
  await expect(safety.getByText(/付费或连接不等于可以安全执行/)).toBeVisible();
});

test('personal lab toolbox exposes non-secretary registered tools for testing', async ({ page }) => {
  await page.goto('/?baohePersonalLab=1');
  await markOnboardingDone(page);
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
    await expect(popup.locator('.portal-tool-card', { hasText: name })).toBeVisible();
  }
});

test('personal lab mode persists after activation and can be cleared', async ({ page }) => {
  await page.goto('/?baohePersonalLab=1');
  await markOnboardingDone(page);
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
  await expect.poll(() => page.locator('.portal-treasure-popup .portal-tool-card').count()).toBe(2);
});
