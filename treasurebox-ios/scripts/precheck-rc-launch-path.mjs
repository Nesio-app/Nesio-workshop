import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  filterToolsForLaunchSurface,
  resolveLaunchSurfaceState,
} from '../../lib/portal/launch-surface.mjs';

const iosRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(iosRoot, '..');
const storageAppPath = join(iosRoot, 'www', 'storage', 'app.js');
const portalConfigPath = join(iosRoot, 'www', 'portal-config.json');

function createClassList() {
  const classes = new Set();
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
    toggle: (item, force) => {
      const next = force === undefined ? !classes.has(item) : Boolean(force);
      if (next) classes.add(item);
      else classes.delete(item);
      return next;
    },
  };
}

function createElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: {},
    classList: createClassList(),
    addEventListener: () => {},
    appendChild: () => {},
    remove: () => {},
    closest: () => null,
  };
}

function createStorage(seed = new Map()) {
  const map = new Map(seed);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    dump: () => new Map(map),
  };
}

function createHarness(seed) {
  const elements = new Map();
  const downloads = [];
  let fetchCallCount = 0;
  const localStorage = createStorage(seed);
  const document = {
    body: createElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => createElement(tag),
  };

  document.getElementById('app').appendChild = () => {};

  const context = vm.createContext({
    console,
    document,
    localStorage,
    window: {
      STORAGE_API: '',
      Capacitor: null,
      _lastAiEmoji: null,
    },
    structuredClone: globalThis.structuredClone,
    Date,
    Math,
    JSON,
    RegExp,
    URL: {
      createObjectURL: () => 'blob:rc-launch-path',
      revokeObjectURL: () => {},
    },
    Blob: class Blob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    Image: class Image {},
    FileReader: class FileReader {},
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => {
      if (typeof fn === 'function') fn();
      return 0;
    },
    confirm: () => true,
    alert: () => {},
    fetch: async () => {
      fetchCallCount += 1;
      throw new Error('network disabled in RC harness');
    },
  });

  context.window.document = document;
  context.window.localStorage = localStorage;
  context.window.URL = context.URL;
  context.window.Blob = context.Blob;
  context.window.fetch = context.fetch;

  const preloadScripts = ['config.js', 'qr.js', 'guard.js']
    .map((file) => readFileSync(join(iosRoot, 'www', 'storage', file), 'utf8'))
    .join('\n');
  const appJs = readFileSync(storageAppPath, 'utf8');
  const instrumented = `${appJs}
globalThis.__rc = {
  chooseFirstLaunchMode,
  saveManualItem,
  openDetail,
  saveEdit,
  deleteItem,
  exportInventory,
  exportAllLocalData,
  clearPersonalData,
  resetDemoData,
  deleteAllLocalLaunchData,
  liveSearch,
  analyzeImage,
  loadRootStore,
  getActiveDataMode,
  runLocalDataMigrationSmokeCheck,
};
`;
  vm.runInContext(preloadScripts, context, { filename: 'storage-preload.js' });
  vm.runInContext(instrumented, context, { filename: storageAppPath });

  context.document.createElement = (tag) => {
    const el = createElement(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'href', {
        get: () => el._href || '',
        set: (value) => { el._href = value; },
      });
      el.click = () => downloads.push({
        href: el.href,
        download: el.download,
      });
    }
    return el;
  };

  return {
    context,
    elements,
    downloads,
    localStorage,
    getRoot: () => JSON.parse(localStorage.getItem('baohe_inventory_v01')),
    getFetchCallCount: () => fetchCallCount,
  };
}

function setValue(harness, id, value) {
  harness.elements.get(id)?.value;
  harness.context.document.getElementById(id).value = value;
}

function personalItems(harness) {
  return harness.getRoot().stores.personal.items;
}

const harness = createHarness();
const rc = harness.context.__rc;

assert.equal(rc.getActiveDataMode(), 'demo', 'Inventory should boot in demo mode by default');
rc.chooseFirstLaunchMode('personal');
assert.equal(rc.getActiveDataMode(), 'personal', 'First launch blank start should switch to personal mode');
assert.equal(personalItems(harness).length, 0, 'Personal mode starts empty and isolated from demo fixtures');

setValue(harness, 'mName', 'RC 测试物品');
setValue(harness, 'mMemory', '在东京转机时买下，提醒自己不要重复购买。');
setValue(harness, 'mLoc', '玄关抽屉');
setValue(harness, 'mPrice', '19');
setValue(harness, 'mPurchased', '2026-06-17');
setValue(harness, 'mWorth', 'yes');
rc.saveManualItem();

let items = personalItems(harness);
assert.equal(items.length, 1, 'Create should persist one personal inventory item');
assert.equal(items[0].mode, 'personal', 'Created item should stay in personal namespace');
assert.equal(items[0].purchaseMemory.reason.includes('不要重复购买'), true, 'Purchase memory should persist as ordinary memory text');
assert.equal(items[0].purchaseMemory.worthIt, 'yes', 'Purchase memory worth marker should persist');
assert.equal(harness.getRoot().stores.demo.items.length > 0, true, 'Demo fixture data remains separate');
assert.deepEqual(Object.values(harness.getRoot().cloudFlags).filter(Boolean), [], 'Cloud flags must stay disabled');

const restartedHarness = createHarness(harness.localStorage.dump());
const restartedRc = restartedHarness.context.__rc;
assert.equal(restartedRc.getActiveDataMode(), 'personal', 'Restart should preserve active mode');
assert.equal(personalItems(restartedHarness).length, 1, 'Restart should preserve local personal item');

const itemId = personalItems(restartedHarness)[0].id;
restartedRc.openDetail(itemId);
setValue(restartedHarness, 'eName', 'RC 测试物品 Edited');
setValue(restartedHarness, 'eLoc', '玄关抽屉第二层');
setValue(restartedHarness, 'eMemory', '编辑后的购买记忆，只记录普通消费背景。');
setValue(restartedHarness, 'ePrice', '21');
setValue(restartedHarness, 'ePurchased', '2026-06-18');
setValue(restartedHarness, 'eWorth', 'mixed');
restartedRc.saveEdit();

items = personalItems(restartedHarness);
assert.equal(items[0].name, 'RC 测试物品 Edited', 'Edit should update item name');
assert.equal(items[0].purchaseMemory.worthIt, 'mixed', 'Edit should update purchase memory worth marker');
assert.equal(items[0].purchaseMemory.reason.includes('普通消费背景'), true, 'Edit should update purchase memory text');

restartedRc.liveSearch('Edited');
assert.match(restartedHarness.context.document.getElementById('searchOut').innerHTML, /RC 测试物品 Edited/, 'Search should find edited item');

restartedRc.exportInventory();
assert.equal(restartedHarness.downloads.length, 1, 'Export should create one local JSON download action');
assert.match(restartedHarness.downloads[0].download, /^baohe-inventory-personal-/, 'Export filename should identify personal mode');

await new Promise((resolve) => {
  restartedRc.analyzeImage('data:image/jpeg;base64,abc', 'image/jpeg', (result, err) => {
    assert.equal(
      JSON.stringify(result),
      JSON.stringify({ name: '', category: '', pao: '', expiry: '', spec: '', price: '' }),
      'Image AI disabled result should be empty',
    );
    assert.match(err, /暂不启用 AI 图片识别/, 'Image AI must be disabled in first launch');
    resolve();
  });
});
assert.equal(restartedHarness.getFetchCallCount(), 0, 'Disabled image AI must not call fetch/network');

restartedRc.deleteItem(itemId);
assert.equal(personalItems(restartedHarness).length, 0, 'Delete should remove local personal item');

restartedRc.resetDemoData();
assert.equal(restartedHarness.getRoot().stores.personal.items.length, 0, 'Demo reset must not repopulate personal data');
assert.equal(restartedHarness.getRoot().stores.demo.items.length > 0, true, 'Demo reset should restore demo fixture');

restartedRc.clearPersonalData();
assert.equal(restartedHarness.getRoot().stores.personal.items.length, 0, 'Personal delete should leave personal inventory empty');
assert.equal(restartedHarness.getRoot().stores.demo.items.length > 0, true, 'Personal delete must not delete demo fixture');

restartedRc.deleteAllLocalLaunchData();
assert.equal(restartedHarness.localStorage.getItem('baohe_inventory_first_launch_v01'), null, 'All-local reset should clear first-launch marker');
assert.equal(restartedHarness.getRoot().stores.personal.items.length, 0, 'All-local reset should recreate empty personal store');

const portalConfig = JSON.parse(readFileSync(portalConfigPath, 'utf8'));
const publicVisibleTools = filterToolsForLaunchSurface(portalConfig.tools, { viewerRole: 'public' });
assert.deepEqual(publicVisibleTools.map((tool) => tool.id), ['inventory'], 'Ordinary iOS public user should only see Inventory');

for (const id of ['secretary', 'psychoanalysis', 'health', 'finance']) {
  const tool = portalConfig.tools.find((item) => item.id === id);
  const state = resolveLaunchSurfaceState(tool, { viewerRole: 'public' });
  assert.equal(state.visible, false, `${id} must not be visible for ordinary public users`);
  assert.equal(state.blockedByApprovalGate, true, `${id} must remain approval-gated before paywall`);
}

const report = {
  ok: true,
  version: 'ios-rc-launch-path-v0',
  verified: {
    firstLaunchBlankStart: true,
    createInventoryItem: true,
    editInventoryItem: true,
    deleteInventoryItem: true,
    searchInventoryItem: true,
    exportLocalInventory: true,
    resetDemoData: true,
    restartPreservesLocalData: true,
    noNetworkImageAiDisabled: true,
    ordinaryUserSandboxHidden: true,
    demoPersonalSeparated: true,
    cloudSyncEnabled: false,
    externalAuthEnabled: false,
    realPaymentEnabled: false,
  },
  manualQaStillRecommended: [
    'visual screenshot pass on simulator',
    'tap-through confirmation on simulator or device',
    'offline airplane-mode smoke on physical device before TestFlight',
  ],
};

console.log(JSON.stringify(report, null, 2));
