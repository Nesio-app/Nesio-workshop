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
  await expect(page.getByRole('button', { name: /粉碎任务/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /下一条/ })).toBeVisible();
  await expect(page.locator('.portal-v13-primary-action')).toHaveCount(1);
  await expect(page.getByText('物品库')).toBeVisible();
  await expect(page.locator('.portal-widgets')).toBeHidden();
  await expect(page.locator('.portal-calendar')).toBeHidden();

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
  await page.getByRole('button', { name: '继续' }).click();
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
  const aiPage = page.getByRole('region', { name: '智友' });
  await expect(aiPage).toBeVisible();
  await expect(aiPage.getByRole('heading', { name: '智友' })).toBeVisible();
  for (const text of ['产品脑暴群', 'ChatGPT', 'Claude', 'Gemini', '豆包']) {
    await expect(aiPage.locator('.portal-ai-conversation-title').filter({ hasText: text }).first()).toBeVisible();
  }
  await aiPage.getByRole('button', { name: /^ChatGPT / }).click();
  await expect(page.getByLabel('当前对话').getByText('ChatGPT')).toBeVisible();
  await expect(page.getByLabel('当前对话').getByPlaceholder(/发消息/)).toBeVisible();
  await expect(aiPage.getByLabel('智友能力').getByRole('button', { name: /Live/ })).toBeVisible();
  await expect(page).not.toHaveURL(/\/secretary/);
});

test('shell toolbox opens as V14 screen, returns home, and does not reopen after refresh', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.reload();

  const nav = page.getByRole('navigation', { name: /宝盒导航/ });
  const treasureButton = nav.getByRole('button', { name: '工具箱' });
  await expect(treasureButton).toBeVisible();

  const triggerBox = await treasureButton.boundingBox();
  expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await treasureButton.click({ force: true });

  const toolbox = page.getByRole('region', { name: '工具箱' });
  await expect(toolbox).toBeVisible();
  await expect(toolbox.getByRole('heading', { name: '工具箱' })).toBeVisible();
  await expect(toolbox.getByRole('region', { name: '我的工具' })).toBeVisible();
  await expect(toolbox.getByRole('region', { name: '可添加' })).toBeVisible();
  await expect(toolbox.getByRole('region', { name: '个性化推荐' })).toBeVisible();
  await expect(toolbox.getByRole('region', { name: '工具包' })).toBeVisible();
  await expect(toolbox.getByText(/健康 \/ 金融 \/ 心理 \/ 自动化仍需确认/)).toBeVisible();
  await expect(toolbox.getByRole('button', { name: /智友/ })).toHaveCount(0);
  await expect(toolbox.getByRole('button', { name: /家居物品/ })).toBeVisible();
  await expect(toolbox.getByRole('button', { name: /任务清单/ })).toBeVisible();

  await page.waitForTimeout(450);
  const toolboxBox = await toolbox.boundingBox();
  const viewport = page.viewportSize();
  expect(toolboxBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((toolboxBox?.x ?? 0) + (toolboxBox?.width ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(viewport?.width ?? 390);

  const toolButtons = toolbox.locator('.portal-treasure-data-card');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBeGreaterThanOrEqual(6);

  const firstToolBox = await toolButtons.first().boundingBox();
  expect(firstToolBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(firstToolBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  const packButtonBox = await toolbox.getByRole('button', { name: /效率日常包/ }).boundingBox();
  expect(packButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await nav.getByRole('button', { name: '首页' }).click();
  await expect(page.getByRole('region', { name: '工具箱' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: '工具箱' })).toHaveCount(0);
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
  await page.getByRole('navigation', { name: /宝盒导航/ }).getByRole('button', { name: '工具箱' }).click();
  await expect(page.getByRole('region', { name: '工具箱' }).getByRole('button', { name: /智友/ })).toHaveCount(0);
});

test('dashboard V14 header stays compact and hides legacy widgets', async ({ page }) => {
  await page.goto('/');
  await markOnboardingDone(page);
  await expect(page.locator('.portal-dash-hero-time')).toBeVisible();
  await expect(page.locator('.portal-dash-hero-time small')).toContainText(/,\s*[A-Z]{2}/);
  await expect(page.locator('.portal-widgets')).toBeHidden();
  await expect(page.locator('.portal-calendar')).toBeHidden();
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

test('settings calendar link lives in software settings, not homepage calendar card', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('进入软件设置').click();
  const calendarUrl = 'https://calendar.google.com/calendar/u/0/r';
  await page.locator('#settings-calendar-url').fill(calendarUrl);
  await page.getByRole('button', { name: '保存日历链接' }).click();

  await page.goto('/');
  await expect(page.locator('.portal-calendar')).toBeHidden();
  const stored = await page.evaluate(() => localStorage.getItem('treasurebox-calendar-links-v1'));
  expect(stored).toContain(calendarUrl);
});

test('settings exposes V14 connections and safety boundary', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '个人数据' })).toBeVisible();
  await expect(page.getByText('宝盒学到的')).toBeVisible();
  await page.getByLabel('进入软件设置').click();
  await expect(page.getByRole('heading', { name: '软件设置' })).toBeVisible();
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

  const treasureButton = page.getByRole('navigation', { name: /宝盒导航/ }).getByRole('button', { name: '工具箱' });
  await expect(treasureButton).toBeVisible();
  await treasureButton.click({ force: true });

  const toolbox = page.getByRole('region', { name: '工具箱' });
  await expect(toolbox).toBeVisible();
  const toolButtons = toolbox.locator('.portal-treasure-data-card, .portal-treasure-screen-grid button, .portal-treasure-package-list button');
  await expect(toolButtons.first()).toBeVisible();
  await expect.poll(() => toolButtons.count()).toBeGreaterThanOrEqual(10);

  await expect(toolbox.getByRole('button', { name: /智友/ })).toHaveCount(0);
  for (const name of ['任务清单', '家居物品', '阅读追踪', '健身记录', '健康档案', '效率日常包', 'AI 助理包']) {
    await expect(toolbox.getByText(name)).toBeVisible();
  }
});

test('personal lab mode persists after activation and can be cleared', async ({ page }) => {
  await page.goto('/?baohePersonalLab=1');
  await markOnboardingDone(page);
  await page.waitForFunction(() => window.localStorage.getItem('baohe_personal_lab') === '1');
  await page.goto('/');
  await page.getByRole('navigation', { name: /宝盒导航/ }).getByRole('button', { name: '工具箱' }).click();
  await expect.poll(() => page.locator('.portal-treasure-screen button').count()).toBeGreaterThanOrEqual(10);

  await page.goto('/?baohePublic=1');
  await page.waitForFunction(() => window.localStorage.getItem('baohe_personal_lab') !== '1');
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: /宝盒导航/ }).getByRole('button', { name: '工具箱' }).click();
  await expect(page.getByRole('region', { name: '工具箱' })).toBeVisible();
  await expect(page.locator('.portal-treasure-screen button').first()).toBeVisible();
});
