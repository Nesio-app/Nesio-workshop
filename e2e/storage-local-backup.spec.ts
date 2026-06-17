import { expect, test, type Page } from '@playwright/test';

const INVENTORY_DB_NAME = 'baohe_inventory_local_db_v01';

async function clearInventoryState(page: Page) {
  await page.evaluate(async (databaseName) => {
    localStorage.clear();

    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    registrations?.forEach((registration) => registration.unregister());

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
  test.setTimeout(60_000);

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

  await page.reload();
  await openMasterSpace(page);
  await expect(page.getByText('E2E 购买记忆物品')).toBeVisible();
  await returnHome(page);

  await page.locator('.hbtn[title="设置"]').click();
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出到文件 / iCloud Drive' }).click(),
  ]).then(([result]) => result);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '清空首发本地数据' }).click();
  await expect(page.getByText('E2E 购买记忆物品')).toBeHidden();

  await page.locator('#localBackupFile').setInputFiles(backupPath!);
  await page.locator('#sh-settings .shclose').click();
  await expect(page.locator('#sh-settings')).not.toHaveClass(/open/);
  await openMasterSpace(page);
  await expect(page.getByText('E2E 购买记忆物品')).toBeVisible();
  await returnHome(page);

  await page.reload();
  await openMasterSpace(page);
  await expect(page.getByText('E2E 购买记忆物品')).toBeVisible();
});
