import { expect, test, type Page } from '@playwright/test';

const INVENTORY_DB_NAME = 'baohe_inventory_local_db_v01';

async function clearInventoryState(page: Page) {
  await page.evaluate(async (databaseName) => {
    localStorage.clear();

    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map((registration) => registration.unregister()));

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, INVENTORY_DB_NAME);
}

async function openMasterSpace(page: Page) {
  const activeSpacePage = page.locator('#pg-space.active');
  if (await activeSpacePage.count()) return;
  await page.locator('.spcard', { hasText: /主卧/ }).click();
}

async function returnHome(page: Page) {
  const activeSpacePage = page.locator('#pg-space.active');
  if (await activeSpacePage.count()) {
    await activeSpacePage.locator('.back').click();
  }
}

test('storage PWA exports local data and restores it after clearing', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/storage');
  await expect(page.locator('#pg-home.active')).toBeVisible();
  await expect(page.locator('#homeSub')).toContainText(/Demo|Personal|Object Anchors/);
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.tab', { hasText: '主页' })).toBeVisible();
  await expect(page.locator('.portal-back-link')).toBeVisible();
  await expect(page.locator('#hsearch')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const tabs = document.querySelector('.tabbar');
    return tabs ? getComputedStyle(tabs).position : '';
  })).toBe('fixed');

  await page.goto('/storage/index.html');
  await clearInventoryState(page);
  await page.reload();

  await page.getByRole('button', { name: '空白开始' }).click();
  await expect(page.locator('#firstLaunch')).toBeHidden();

  await expect(page.locator('#sh-add')).toHaveClass(/open/);
  await page.locator('#sh-add').getByRole('button', { name: /手动填写/ }).click({ force: true });
  await expect(page.locator('#sadd-manual')).toBeVisible();
  await page.locator('#mName').fill('E2E 购买记忆物品');
  await page.locator('#mLoc').fill('E2E 本地位置');
  await page.locator('#mMemory').fill('这是 Playwright 验证用的购买记忆');
  await page.locator('#mPrice').fill('12');
  await page.locator('#mWorth').selectOption('yes');
  await page.getByRole('button', { name: /存档$/ }).click();

  await openMasterSpace(page);
  await expect(page.getByText('E2E 购买记忆物品')).toBeVisible();
  await returnHome(page);

  await page.locator('#hsearch').fill('E2E 购买记忆物品');
  await expect(page.locator('#searchOut')).toBeVisible();
  await expect(page.locator('#searchOut')).toContainText('E2E 购买记忆物品');
  await page.locator('#searchOut .icard', { hasText: 'E2E 购买记忆物品' }).click();
  await expect(page.locator('#pg-detail.active')).toBeVisible();

  await page.locator('#pg-detail .hbtn').click();
  await expect(page.locator('#sh-edit')).toHaveClass(/open/);
  await page.locator('#eName').fill('E2E 编辑后物品');
  await page.locator('#eMemory').fill('编辑后的购买记忆仍然只保存在本地');
  await page.locator('#eWorth').selectOption('mixed');
  await page.locator('#sh-edit').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('#pg-detail')).toContainText('E2E 编辑后物品');
  await expect(page.locator('#pg-detail')).toContainText('编辑后的购买记忆仍然只保存在本地');
  await page.locator('#pg-detail .back').click();
  await returnHome(page);

  await page.locator('#hsearch').fill('E2E 编辑后物品');
  await expect(page.locator('#searchOut')).toContainText('E2E 编辑后物品');

  await page.reload();
  await openMasterSpace(page);
  await expect(page.getByText('E2E 编辑后物品')).toBeVisible();
  await returnHome(page);

  await page.locator('.hbtn[title="设置"]').click();
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出到文件 / iCloud Drive' }).click(),
  ]).then(([result]) => result);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  await page.locator('#sh-settings .shclose').click();
  await expect(page.locator('#sh-settings')).not.toHaveClass(/open/);

  await openMasterSpace(page);
  await page.getByText('E2E 编辑后物品').click();
  await expect(page.locator('#pg-detail.active')).toBeVisible();
  const deleteDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page.locator('#pg-detail.active').getByRole('button', { name: '删除本地记录' }).click({ force: true });
  await deleteDialog;
  await expect.poll(async () => page.evaluate(() => {
    const root = JSON.parse(localStorage.getItem('baohe_inventory_v01') || '{}');
    return (root.stores?.personal?.items || []).filter((item: { name?: string }) => item.name === 'E2E 编辑后物品').length;
  })).toBe(0);
  await expect(page.locator('#spaceScroll .iname', { hasText: 'E2E 编辑后物品' })).toHaveCount(0);
  await returnHome(page);

  await page.locator('.hbtn[title="设置"]').click();
  const clearDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page.locator('#sh-settings').getByRole('button', { name: '清空首发本地数据' }).click({ force: true });
  await clearDialog;
  await expect(page.locator('#spaceScroll .iname', { hasText: 'E2E 编辑后物品' })).toHaveCount(0);

  await page.locator('#localBackupFile').setInputFiles(backupPath!);
  await page.locator('#sh-settings .shclose').click();
  await expect(page.locator('#sh-settings')).not.toHaveClass(/open/);
  await openMasterSpace(page);
  await expect(page.locator('#spaceScroll .iname', { hasText: 'E2E 编辑后物品' })).toBeVisible();
  await returnHome(page);

  await page.reload();
  await openMasterSpace(page);
  await expect(page.locator('#spaceScroll .iname', { hasText: 'E2E 编辑后物品' })).toBeVisible();
  await returnHome(page);

  const hasController = async () => page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (navigator.serviceWorker.controller) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
    });
  });
  if (!(await hasController())) {
    await page.reload();
  }
  await expect.poll(hasController, { timeout: 10_000 }).toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator('#pg-home.active')).toBeVisible();
  await expect(page.locator('#homeSub')).toContainText(/Demo|Personal|Object Anchors/);
  await page.context().setOffline(false);
});
