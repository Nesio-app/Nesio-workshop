/* 大后方 · Object Anchors + Impulse Guard */

const LEGACY_STORAGE_KEYS = ['rearbase_v2', 'rearbase_v1'];
const STORAGE_ROOT_KEY = 'baohe_inventory_v01';
const LOCAL_PROFILE_STORAGE_KEY = 'baohe_local_profile_v01';
const LOCAL_BACKUP_METADATA_KEY = 'baohe_local_backup_meta_v01';
const INVENTORY_INDEXEDDB_NAME = 'baohe_inventory_local_db_v01';
const INVENTORY_INDEXEDDB_STORE = 'local_root_store';
const INVENTORY_INDEXEDDB_ROOT_ID = 'baohe-local-root';
const INVENTORY_MODE_KEY = 'baohe_inventory_mode_v01';
const INVENTORY_FIRST_LAUNCH_KEY = 'baohe_inventory_first_launch_v01';
const INVENTORY_MODES = ['demo', 'personal'];
const LOCAL_BACKUP_REMINDER_DAYS = 7;
const LOCAL_PROFILE_SCHEMA_VERSION = 'LocalProfile@v1';
const LOCAL_INVENTORY_ITEM_SCHEMA_VERSION = 'LocalInventoryItem@v1';
const LOCAL_INVENTORY_STORE_SCHEMA_VERSION = 'LocalInventoryStore@v1';
const LOCAL_DATA_ROOT_SCHEMA_VERSION = 'BaoheLocalDataRoot@v1';
const LOCAL_DATA_VERSION = 'baohe-local-data-v1';
const LOCAL_TABLE_SCHEMA_VERSIONS = {
  local_profile: LOCAL_PROFILE_SCHEMA_VERSION,
  inventory_items: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
  inventory_containers: 'LocalInventoryContainer@v1',
  inventory_spaces: 'LocalInventorySpace@v1',
  inventory_backups: 'LocalInventoryBackup@v1',
  demo_seed: 'InventoryDemoSeed@v1',
};
const LAUNCH_CLOUD_FLAGS = Object.freeze({
  cloudEnabled: false,
  cloudSyncEnabled: false,
  realCloudProviderConnected: false,
  writesCloudData: false,
  readsCloudData: false,
});
const INVENTORY_TABLE_NAMES = ['items', 'containers', 'spaces', 'analytics', 'frozen', 'widgets'];

const DEFAULT_STATE = {
  pts: 650,
  savedTotal: 284,
  declines: 3,
  currentSpaceId: 'master',
  currentItemId: null,
  activeContainerCode: null,
  analytics: [
    { name: 'Sony WH-1000XM5', price: 349, result: 'saved', pts: 350, ago: '3周前' },
    { name: 'Dyson 吹风机', price: 430, result: 'saved', pts: 430, ago: '1月前' },
    { name: 'AirPods Pro 2', price: 249, result: 'dopamine', pts: 0, ago: '6周前' },
    { name: 'Lululemon 瑜伽裤', price: 128, result: 'saved', pts: 128, ago: '2月前' },
  ],
  frozen: [
    { id: 'f1', emoji: '💻', name: 'iPad Pro M4 11寸', price: 1099, source: 'Apple Store', frozenAt: Date.now() - 44 * 3600000, hoursTotal: 24, duplicate: '书桌区已有 iPad mini 存档' },
    { id: 'f2', emoji: '👟', name: 'Nike Air Max 97 白银', price: 180, source: 'Nike.com', frozenAt: Date.now() - 6 * 3600000, hoursTotal: 24 },
  ],
  spaces: [
    { id: 'master', emoji: '🛏️', name: '主卧', items: 12, containers: 3, confidence: 82 },
    { id: 'kitchen', emoji: '🍳', name: '厨房', items: 8, containers: 2, confidence: 91 },
    { id: 'desk', emoji: '📚', name: '书桌区', items: 7, containers: 1, confidence: 78 },
  ],
  widgets: [
    { emoji: '🧼', name: '无菌枕巾', sub: '主卧 · 剩 9 张' },
    { emoji: '🥑', name: '纯奶酪条', sub: '冰箱 2 层 · 3 根' },
    { emoji: '🫙', name: 'MCT 油', sub: '厨房 · 84% 置信' },
    { emoji: '🐾', name: 'Maple 雨衣', sub: '玄关 · 顶层' },
  ],
  containers: [
    { id: 'c1', code: 'RB-MS-001', spaceId: 'master', emoji: '🪞', name: '主卧镜柜后层', loc: '主卧·镜柜后层', layer: '后层', items: 3, confirmed: '3天前' },
    { id: 'c2', code: 'RB-MS-002', spaceId: 'master', emoji: '👗', name: '主卧衣柜第三格', loc: '主卧·衣柜第三格', layer: '第三格', items: 2, confirmed: '今天' },
    { id: 'c3', code: 'RB-KT-001', spaceId: 'kitchen', emoji: '🧊', name: '厨房冰箱第二层', loc: '厨房·冰箱第二层', layer: '第二层', items: 2, confirmed: '1天前' },
    { id: 'c4', code: 'RB-DS-001', spaceId: 'desk', emoji: '📒', name: '书桌右侧抽屉', loc: '书桌·右侧抽屉', layer: '上层', items: 3, confirmed: '2天前' },
  ],
  items: [
    { id: 'i1', spaceId: 'master', containerId: 'c1', containerCode: 'RB-MS-001', container: 'RB-MS-001 · 镜柜后层', emoji: '🌬️', name: 'Maple 止痒喷雾', loc: '镜子后第二层·底层被压', category: '护理', price: 18, expiry: '2026-06-14', pao: '12M', confidence: 73, spec: '100ml · 喷雾瓶', purchased: '2026-04-10', note: '被压在护手霜下面，左侧那瓶', kw: ['止痒', '喷雾', 'maple', '狗'] },
    { id: 'i2', spaceId: 'master', containerId: 'c1', containerCode: 'RB-MS-001', container: 'RB-MS-001 · 镜柜后层', emoji: '🧴', name: 'Innisfree 视黄醇精华', loc: '镜柜第一层', category: '护肤', price: 42, expiry: '2026-06-10', pao: '6M', confidence: 65, kw: ['精华', '视黄醇', '护肤'] },
    { id: 'i3', spaceId: 'master', containerId: 'c2', containerCode: 'RB-MS-002', container: 'RB-MS-002 · 衣柜第三格', emoji: '🧼', name: '无菌枕巾（备用）', loc: '衣柜第三格·顶层', category: '寝具', qty: 9, confidence: 96, kw: ['枕巾', '无菌'] },
    { id: 'i4', spaceId: 'master', containerId: 'c2', containerCode: 'RB-MS-002', container: 'RB-MS-002 · 衣柜第三格', emoji: '💊', name: '维生素 D3+K2', loc: '衣柜第三格·中层', category: '补剂', price: 28, expiry: '2026-09-01', confidence: 88, kw: ['维生素', 'd3', 'k2'] },
    { id: 'i5', spaceId: 'kitchen', containerId: 'c3', containerCode: 'RB-KT-001', container: 'RB-KT-001 · 冰箱第二层', emoji: '🧀', name: '纯奶酪条', loc: '冰箱 2 层', category: '食品', confidence: 90, kw: ['奶酪', '食品'] },
    { id: 'i6', spaceId: 'desk', containerId: 'c4', containerCode: 'RB-DS-001', container: 'RB-DS-001 · 书桌右侧抽屉', emoji: '📒', name: 'CFA 草稿本', loc: '书桌右侧抽屉·上层', category: '文具', confidence: 82, kw: ['cfa', '草稿', '笔记'] },
  ],
};

let state = loadState();
let selectedLayer = '顶层';
let qrScanning = false;

function cloneDefaultState() {
  return structuredClone(DEFAULT_STATE);
}

function createPersonalState() {
  const s = cloneDefaultState();
  s.pts = 0;
  s.savedTotal = 0;
  s.declines = 0;
  s.currentSpaceId = 'master';
  s.currentItemId = null;
  s.activeContainerCode = null;
  s.analytics = [];
  s.frozen = [];
  s.widgets = [];
  s.containers = [];
  s.items = [];
  s.spaces = s.spaces.map((space) => ({ ...space, items: 0, containers: 0, confidence: 0 }));
  ensureGuard(s);
  return s;
}

function createStateForMode(mode) {
  return mode === 'personal' ? createPersonalState() : cloneDefaultState();
}

function normalizeInventoryMode(mode) {
  return INVENTORY_MODES.includes(mode) ? mode : 'demo';
}

function assertLaunchCloudFlagsDisabled(flags = LAUNCH_CLOUD_FLAGS) {
  const enabled = Object.entries(flags).filter(([, value]) => value === true).map(([key]) => key);
  if (enabled.length) throw new Error(`Launch cloud flags must stay disabled: ${enabled.join(', ')}`);
  return true;
}

function createLocalProfile(source = {}, options = {}) {
  const activeMode = normalizeInventoryMode(options.activeMode || source.activeMode || getActiveDataMode());
  const now = new Date().toISOString();
  return {
    schemaVersion: LOCAL_PROFILE_SCHEMA_VERSION,
    profileId: 'local_profile',
    profileKind: 'local_profile',
    displayName: source.displayName || '本机用户',
    deviceLabel: source.deviceLabel || '此设备',
    activeMode,
    accountSystemEnabled: false,
    serverUserId: null,
    cloudEnabled: false,
    cloudSyncEnabled: false,
    serverAccountEnabled: false,
    createdAt: source.createdAt || now,
    updatedAt: now,
    lastSavedAt: source.lastSavedAt || now,
  };
}

function loadLocalProfile(options = {}) {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
    return createLocalProfile(raw ? JSON.parse(raw) : {}, options);
  } catch (_) {
    return createLocalProfile({}, options);
  }
}

function saveLocalProfile(profile) {
  const nextProfile = createLocalProfile(profile, { activeMode: profile?.activeMode });
  try {
    localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
  } catch (_) { /* ignore */ }
  return nextProfile;
}

function loadLocalBackupMetadata() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_METADATA_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      lastBackupExportedAt: parsed.lastBackupExportedAt || null,
      lastBackupImportedAt: parsed.lastBackupImportedAt || null,
      lastBackupFileName: parsed.lastBackupFileName || null,
      reminderDays: LOCAL_BACKUP_REMINDER_DAYS,
    };
  } catch (_) {
    return {
      lastBackupExportedAt: null,
      lastBackupImportedAt: null,
      lastBackupFileName: null,
      reminderDays: LOCAL_BACKUP_REMINDER_DAYS,
    };
  }
}

function saveLocalBackupMetadata(next = {}) {
  const current = loadLocalBackupMetadata();
  const metadata = {
    ...current,
    ...next,
    reminderDays: LOCAL_BACKUP_REMINDER_DAYS,
  };
  try {
    localStorage.setItem(LOCAL_BACKUP_METADATA_KEY, JSON.stringify(metadata));
  } catch (_) { /* ignore */ }
  return metadata;
}

function formatLocalDateTime(value) {
  if (!value) return '尚无';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '尚无';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function backupReminderStatus(metadata = loadLocalBackupMetadata()) {
  const last = metadata.lastBackupExportedAt || metadata.lastBackupImportedAt;
  if (!last) return '建议现在导出一次备份';
  const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays >= LOCAL_BACKUP_REMINDER_DAYS) {
    return `超过 ${LOCAL_BACKUP_REMINDER_DAYS} 天未备份`;
  }
  return '备份状态正常';
}

function openInventoryIndexedDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(INVENTORY_INDEXEDDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INVENTORY_INDEXEDDB_STORE)) {
        db.createObjectStore(INVENTORY_INDEXEDDB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function saveRootStoreToIndexedDb(root) {
  openInventoryIndexedDb().then((db) => {
    if (!db) return;
    const tx = db.transaction(INVENTORY_INDEXEDDB_STORE, 'readwrite');
    tx.objectStore(INVENTORY_INDEXEDDB_STORE).put({
      id: INVENTORY_INDEXEDDB_ROOT_ID,
      savedAt: new Date().toISOString(),
      root,
      boundary: {
        indexedDbMirrorEnabled: true,
        localStorageCompatibility: true,
        cloudSyncEnabled: false,
      },
    });
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  }).catch(() => undefined);
}

function restoreRootStoreFromIndexedDb() {
  return openInventoryIndexedDb().then((db) => new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = db.transaction(INVENTORY_INDEXEDDB_STORE, 'readonly');
    const request = tx.objectStore(INVENTORY_INDEXEDDB_STORE).get(INVENTORY_INDEXEDDB_ROOT_ID);
    request.onsuccess = () => {
      db.close();
      resolve(request.result?.root || null);
    };
    request.onerror = () => {
      db.close();
      resolve(null);
    };
  })).catch(() => null);
}

function deleteRootStoreFromIndexedDb() {
  openInventoryIndexedDb().then((db) => {
    if (!db) return;
    const tx = db.transaction(INVENTORY_INDEXEDDB_STORE, 'readwrite');
    tx.objectStore(INVENTORY_INDEXEDDB_STORE).delete(INVENTORY_INDEXEDDB_ROOT_ID);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  }).catch(() => undefined);
}

function bootstrapRootStoreFromIndexedDb() {
  try {
    if (localStorage.getItem(STORAGE_ROOT_KEY)) return;
  } catch (_) {
    return;
  }
  restoreRootStoreFromIndexedDb().then((root) => {
    if (!root) return;
    try {
      localStorage.setItem(STORAGE_ROOT_KEY, JSON.stringify(root));
      if (root.activeMode) localStorage.setItem(INVENTORY_MODE_KEY, normalizeInventoryMode(root.activeMode));
    } catch (_) {
      return;
    }
    state = loadState();
    rerenderInventoryApp();
    showFirstLaunchIfNeeded();
    showToast('已从本机 IndexedDB 恢复本地数据');
  }).catch(() => undefined);
}

function versionInventoryItem(item, mode) {
  const now = new Date().toISOString();
  const locationHint = item.locationHint || item.loc || '';
  const notes = item.notes || item.note || item.purchaseMemory?.memoryNote || item.purchaseMemory?.reason || '';
  return {
    ...item,
    schemaVersion: item.schemaVersion || LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    locationHint,
    notes,
    status: item.status || 'active',
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
    mode: item.mode || mode,
  };
}

function activeItems(items = state.items) {
  return items.filter((item) => item.status !== 'archived');
}

function readInventoryTable(root, mode, tableName) {
  if (!INVENTORY_TABLE_NAMES.includes(tableName)) return [];
  const store = migrateState(root?.stores?.[normalizeInventoryMode(mode)], mode);
  return Array.isArray(store[tableName]) ? structuredClone(store[tableName]) : [];
}

function writeInventoryTable(root, mode, tableName, rows) {
  if (!INVENTORY_TABLE_NAMES.includes(tableName)) return root;
  const nextMode = normalizeInventoryMode(mode);
  const store = migrateState(root.stores[nextMode], nextMode);
  store[tableName] = Array.isArray(rows) ? structuredClone(rows) : [];
  root.stores[nextMode] = migrateState(store, nextMode);
  return root;
}

function buildMigrationSmokeResult(root) {
  const schemaOk = root.schemaVersion === LOCAL_DATA_ROOT_SCHEMA_VERSION &&
    root.dataVersion === LOCAL_DATA_VERSION &&
    Object.entries(LOCAL_TABLE_SCHEMA_VERSIONS).every(([table, version]) => root.schemaVersions?.[table] === version);
  const modesOk = INVENTORY_MODES.every((mode) => root.stores?.[mode]?.schemaVersion === LOCAL_INVENTORY_STORE_SCHEMA_VERSION);
  const cloudOk = assertLaunchCloudFlagsDisabled(root.cloudFlags);
  return {
    status: schemaOk && modesOk && cloudOk ? 'pass' : 'fail',
    checkedAt: new Date().toISOString(),
    schemaOk,
    modesOk,
    cloudOk,
    canRefreshWithoutDataLoss: true,
    canReinstallFromEmptyLocalStorage: true,
  };
}

function runLocalDataMigrationSmokeCheck(root = null) {
  const candidate = root || loadRootStore();
  return buildMigrationSmokeResult(candidate);
}

function getActiveDataMode() {
  try {
    return normalizeInventoryMode(localStorage.getItem(INVENTORY_MODE_KEY) || 'demo');
  } catch (_) {
    return 'demo';
  }
}

function setActiveDataMode(mode) {
  const nextMode = normalizeInventoryMode(mode);
  try {
    localStorage.setItem(INVENTORY_MODE_KEY, nextMode);
  } catch (_) { /* ignore */ }
  return nextMode;
}

function hasCompletedFirstLaunch() {
  try {
    return localStorage.getItem(INVENTORY_FIRST_LAUNCH_KEY) === 'done';
  } catch (_) {
    return false;
  }
}

function markFirstLaunchDone() {
  try {
    localStorage.setItem(INVENTORY_FIRST_LAUNCH_KEY, 'done');
  } catch (_) { /* ignore */ }
}

function showFirstLaunchIfNeeded() {
  const el = document.getElementById('firstLaunch');
  if (!el) return;
  el.classList.toggle('show', !hasCompletedFirstLaunch());
}

function chooseFirstLaunchMode(mode) {
  switchDataMode(mode);
  markFirstLaunchDone();
  document.getElementById('firstLaunch')?.classList.remove('show');
  if (mode === 'personal' && state.items.length === 0) openSheet('sh-add');
}

function migrateState(raw, mode = 'demo') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = createStateForMode(mode);
  const s = {
    ...base,
    ...source,
    schemaVersion: LOCAL_INVENTORY_STORE_SCHEMA_VERSION,
    dataVersion: LOCAL_DATA_VERSION,
    mode,
  };
  s.items = (Array.isArray(source.items) ? source.items : base.items).map((item) => versionInventoryItem(item, mode));
  const sourceContainers = Array.isArray(source.containers) ? source.containers : base.containers;
  s.containers = sourceContainers.map((c, i) => {
    const base = DEFAULT_STATE.containers[i] || {};
    return {
      ...base,
      ...c,
      id: c.id || base.id || 'c' + (i + 1),
      code: c.code || base.code || nextContainerCode(c.spaceId || 'master', s.containers.slice(0, i)),
      spaceId: c.spaceId || base.spaceId || 'master',
    };
  });
  s.items = s.items.map((it) => {
    const versioned = versionInventoryItem(it, mode);
    if (versioned.containerCode) return versioned;
    const c = s.containers.find((x) => versioned.container?.includes(x.name) || versioned.loc?.includes(x.name?.slice(0, 4)));
    if (c) {
      return { ...versioned, containerId: c.id, containerCode: c.code, container: `${c.code} · ${c.name}` };
    }
    return versioned;
  });
  ensureGuard(s);
  return s;
}

function createRootStore() {
  const activeMode = getActiveDataMode();
  const localProfile = loadLocalProfile({ activeMode });
  return {
    version: LOCAL_DATA_VERSION,
    schemaVersion: LOCAL_DATA_ROOT_SCHEMA_VERSION,
    dataVersion: LOCAL_DATA_VERSION,
    schemaVersions: { ...LOCAL_TABLE_SCHEMA_VERSIONS },
    cloudFlags: { ...LAUNCH_CLOUD_FLAGS },
    localProfile,
    activeMode,
    stores: {
      demo: migrateState(createStateForMode('demo'), 'demo'),
      personal: migrateState(createStateForMode('personal'), 'personal'),
    },
    backups: [],
    migrationSmokeCheck: {
      status: 'not_run',
      checkedAt: null,
    },
  };
}

function loadLegacyInventoryState() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) return migrateState(JSON.parse(raw), 'personal');
    }
  } catch (_) { /* ignore */ }
  return null;
}

function loadRootStore() {
  try {
    const raw = localStorage.getItem(STORAGE_ROOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const root = {
        ...createRootStore(),
        ...parsed,
        stores: {
          demo: migrateState(parsed?.stores?.demo, 'demo'),
          personal: migrateState(parsed?.stores?.personal, 'personal'),
        },
        backups: Array.isArray(parsed?.backups) ? parsed.backups.slice(-5) : [],
      };
      root.activeMode = normalizeInventoryMode(root.activeMode);
      root.version = LOCAL_DATA_VERSION;
      root.schemaVersion = LOCAL_DATA_ROOT_SCHEMA_VERSION;
      root.dataVersion = LOCAL_DATA_VERSION;
      root.schemaVersions = { ...(parsed?.schemaVersions || {}), ...LOCAL_TABLE_SCHEMA_VERSIONS };
      root.cloudFlags = { ...LAUNCH_CLOUD_FLAGS, ...(parsed?.cloudFlags || {}) };
      assertLaunchCloudFlagsDisabled(root.cloudFlags);
      root.localProfile = saveLocalProfile(createLocalProfile(parsed?.localProfile, { activeMode: root.activeMode }));
      root.migrationSmokeCheck = buildMigrationSmokeResult(root);
      return root;
    }
  } catch (_) { /* ignore */ }

  const root = createRootStore();
  const legacy = loadLegacyInventoryState();
  if (legacy) root.stores.personal = legacy;
  root.migrationSmokeCheck = buildMigrationSmokeResult(root);
  return root;
}

function saveRootStore(root) {
  assertLaunchCloudFlagsDisabled(root.cloudFlags || LAUNCH_CLOUD_FLAGS);
  root.schemaVersion = LOCAL_DATA_ROOT_SCHEMA_VERSION;
  root.dataVersion = LOCAL_DATA_VERSION;
  root.schemaVersions = { ...(root.schemaVersions || {}), ...LOCAL_TABLE_SCHEMA_VERSIONS };
  root.cloudFlags = { ...LAUNCH_CLOUD_FLAGS, ...(root.cloudFlags || {}) };
  root.localProfile = saveLocalProfile(createLocalProfile(root.localProfile, { activeMode: root.activeMode }));
  root.localProfile.lastSavedAt = new Date().toISOString();
  root.migrationSmokeCheck = buildMigrationSmokeResult(root);
  localStorage.setItem(STORAGE_ROOT_KEY, JSON.stringify(root));
  saveRootStoreToIndexedDb(root);
}

function loadState() {
  const mode = setActiveDataMode(getActiveDataMode());
  const root = loadRootStore();
  root.activeMode = mode;
  const nextState = migrateState(root.stores[mode], mode);
  root.stores[mode] = nextState;
  root.localProfile = createLocalProfile(root.localProfile, { activeMode: mode });
  saveRootStore(root);
  return nextState;
}

function persist() {
  const mode = getActiveDataMode();
  syncContainerCounts();
  const root = loadRootStore();
  root.activeMode = mode;
  root.localProfile = createLocalProfile(root.localProfile, { activeMode: mode });
  writeInventoryTable(root, mode, 'items', state.items);
  writeInventoryTable(root, mode, 'containers', state.containers);
  writeInventoryTable(root, mode, 'spaces', state.spaces);
  root.stores[mode] = migrateState({ ...root.stores[mode], ...state }, mode);
  saveRootStore(root);
  refreshPtsUI();
  refreshBinUI();
}

function snapshotLocalData(action) {
  const root = loadRootStore();
  root.backups.push({
    action,
    createdAt: new Date().toISOString(),
    activeMode: getActiveDataMode(),
    stores: structuredClone(root.stores),
  });
  root.backups = root.backups.slice(-5);
  saveRootStore(root);
}

function buildLocalBackupPayload(root = loadRootStore()) {
  const exportedAt = new Date().toISOString();
  return {
    backupKind: 'baohe-local-backup-v1',
    exported: exportedAt,
    version: root.version,
    dataBoundary: {
      modes: INVENTORY_MODES,
      demoPersonalSeparated: true,
      networkRequired: false,
      sourceOfTruth: 'device-local-storage',
      userManagedFileBackup: true,
      restoreSupported: true,
      filesAppRecommended: true,
      indexedDbMirrorEnabled: true,
      localStorageCompatibility: true,
      readsRealData: false,
      writesRealData: false,
      cloudSyncEnabled: false,
      externalAuthEnabled: false,
      serverAccountEnabled: false,
      paymentIntegrationEnabled: false,
    },
    schemaVersions: root.schemaVersions,
    localProfile: root.localProfile,
    backupMetadata: loadLocalBackupMetadata(),
    cloudFlags: root.cloudFlags,
    migrationSmokeCheck: runLocalDataMigrationSmokeCheck(root),
    activeMode: getActiveDataMode(),
    stores: root.stores,
  };
}

function validateLocalBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('备份文件无效');
  if (payload.backupKind !== 'baohe-local-backup-v1') throw new Error('不是宝盒本地备份文件');
  if (!payload.stores || typeof payload.stores !== 'object') throw new Error('备份缺少本地数据');
  if (!payload.stores.demo || !payload.stores.personal) throw new Error('备份缺少 demo/personal 隔离数据');
  if (payload.dataBoundary?.cloudSyncEnabled === true || payload.dataBoundary?.externalAuthEnabled === true) {
    throw new Error('备份边界不符合首发本地模式');
  }
  return true;
}

function importAllLocalDataPayload(payload) {
  validateLocalBackupPayload(payload);
  snapshotLocalData('import-all-local-backup');
  const nextRoot = createRootStore();
  nextRoot.version = LOCAL_DATA_VERSION;
  nextRoot.schemaVersion = LOCAL_DATA_ROOT_SCHEMA_VERSION;
  nextRoot.dataVersion = LOCAL_DATA_VERSION;
  nextRoot.schemaVersions = { ...(payload.schemaVersions || {}), ...LOCAL_TABLE_SCHEMA_VERSIONS };
  nextRoot.cloudFlags = { ...LAUNCH_CLOUD_FLAGS };
  nextRoot.activeMode = normalizeInventoryMode(payload.activeMode);
  nextRoot.localProfile = createLocalProfile(payload.localProfile, { activeMode: nextRoot.activeMode });
  nextRoot.stores = {
    demo: migrateState(payload.stores.demo, 'demo'),
    personal: migrateState(payload.stores.personal, 'personal'),
  };
  nextRoot.backups = Array.isArray(payload.backups) ? payload.backups.slice(-5) : [];
  saveRootStore(nextRoot);
  setActiveDataMode(nextRoot.activeMode);
  saveLocalBackupMetadata({
    lastBackupImportedAt: new Date().toISOString(),
    lastBackupFileName: payload.fileName || '本地备份 JSON',
  });
  state = loadState();
  rerenderInventoryApp();
  showFirstLaunchIfNeeded();
  return true;
}

function rerenderInventoryApp() {
  syncContainerCounts();
  renderHome();
  renderContainers();
  refreshPtsUI();
  refreshBinUI();
  renderGuardUI();
  const activePage = document.querySelector('.page.active')?.id;
  if (activePage === 'pg-stats') renderStats();
  if (document.getElementById('sh-settings')?.classList.contains('open')) renderSettings();
}

function switchDataMode(mode) {
  const nextMode = setActiveDataMode(mode);
  state = loadState();
  rerenderInventoryApp();
  showToast(`已切换到 ${nextMode === 'personal' ? 'Personal' : 'Demo'} 数据`);
}

function exportAllLocalData() {
  const root = loadRootStore();
  const payload = buildLocalBackupPayload(root);
  const filename = `baohe-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadJson(payload, filename);
  saveLocalBackupMetadata({
    lastBackupExportedAt: payload.exported,
    lastBackupFileName: filename,
  });
  renderSettings();
  showToast('已导出本地备份，可保存到文件/iCloud Drive');
}

function triggerLocalBackupImport() {
  document.getElementById('localBackupFile')?.click();
}

function handleLocalBackupFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result || '{}'));
      payload.fileName = file.name;
      importAllLocalDataPayload(payload);
      renderSettings();
      showToast('已从本地备份恢复');
    } catch (error) {
      showToast(error?.message || '恢复失败');
    } finally {
      if (input) input.value = '';
    }
  };
  reader.onerror = () => {
    showToast('无法读取备份文件');
    if (input) input.value = '';
  };
  reader.readAsText(file);
}

function clearPersonalData() {
  if (!confirm('确认清空 Personal 本地库存数据？Demo 数据不会被删除。')) return;
  snapshotLocalData('clear-personal');
  const root = loadRootStore();
  root.stores.personal = createStateForMode('personal');
  saveRootStore(root);
  switchDataMode('personal');
  showToast('Personal 本地数据已清空');
}

function resetDemoData() {
  if (!confirm('确认重置 Demo 数据？Personal 数据不会被删除。')) return;
  snapshotLocalData('reset-demo');
  const root = loadRootStore();
  root.stores.demo = createStateForMode('demo');
  saveRootStore(root);
  switchDataMode('demo');
  showToast('Demo 数据已重置');
}

function restoreLatestBackup() {
  const root = loadRootStore();
  const backup = root.backups.pop();
  if (!backup) { showToast('暂无可恢复备份'); return; }
  root.stores = {
    demo: migrateState(backup.stores?.demo, 'demo'),
    personal: migrateState(backup.stores?.personal, 'personal'),
  };
  root.activeMode = normalizeInventoryMode(backup.activeMode);
  saveRootStore(root);
  setActiveDataMode(root.activeMode);
  state = loadState();
  rerenderInventoryApp();
  showToast('已恢复最近一次本地备份');
}

function deleteAllLocalLaunchData() {
  if (!confirm('确认清空首发本地数据？这会重置 Local Profile、Demo 与 Personal 库存。')) return;
  snapshotLocalData('delete-all-local-launch-data');
  try {
    localStorage.removeItem(STORAGE_ROOT_KEY);
    localStorage.removeItem(LOCAL_PROFILE_STORAGE_KEY);
    localStorage.removeItem(INVENTORY_MODE_KEY);
    localStorage.removeItem(INVENTORY_FIRST_LAUNCH_KEY);
  } catch (_) { /* ignore */ }
  deleteRootStoreFromIndexedDb();
  state = loadState();
  rerenderInventoryApp();
  showFirstLaunchIfNeeded();
  showToast('首发本地数据已清空，可重新初始化');
}

function getContainer(code) {
  return state.containers.find((c) => c.code === code);
}

function syncContainerCounts() {
  state.containers.forEach((c) => {
    c.items = activeItems().filter((i) => i.containerCode === c.code || i.containerId === c.id).length;
  });
  state.spaces.forEach((sp) => {
    sp.containers = state.containers.filter((c) => c.spaceId === sp.id).length;
    sp.items = activeItems().filter((i) => i.spaceId === sp.id).length;
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function expiryTag(item) {
  const d = daysUntil(item.expiry);
  if (d == null) return '';
  if (d <= 3) return `<span class="tag t-exp">紧急·${d}天</span>`;
  if (d <= 14) return `<span class="tag t-exp">${d}天后到期</span>`;
  return `<span class="tag t-ok">充裕·${d}天</span>`;
}

function confClass(c) {
  if (c >= 80) return 'cf-hi';
  if (c >= 60) return 'cf-md';
  return 'cf-lo';
}

// ── Navigation ──
function goPage(id) {
  if (id !== 'pg-scan') stopQrScanUi();
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'pg-stats') renderStats();
  if (id === 'pg-impulse') { renderFrozen(); renderGuardUI(); }
  if (id === 'pg-ig-analytics') renderAnalytics();
  if (id === 'pg-scan') { renderContainers(); refreshBinUI(); }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
  const map = { home: 'pg-home', stats: 'pg-stats', impulse: 'pg-impulse', scan: 'pg-scan' };
  if (map[name]) goPage(map[name]);
  const el = document.getElementById('t-' + name);
  if (el) el.classList.add('on');
}

function openSheet(id) {
  if (id === 'sh-add') updateAddBinPill();
  if (id === 'sh-settings') renderSettings();
  if (id === 'sh-guard') renderGuardSettings();
  if (id === 'sh-new-container') fillNewContainerSpaces();
  document.getElementById(id).classList.add('open');
}

function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'sh-add') resetAdd();
}

document.querySelectorAll('.overlay').forEach((o) => {
  o.addEventListener('click', (e) => {
    if (e.target === o) {
      o.classList.remove('open');
      if (o.id === 'sh-add') resetAdd();
    }
  });
});

// ── Active bin ──
function setActiveContainer(code) {
  state.activeContainerCode = code;
  const c = getContainer(code);
  persist();
  refreshBinUI();
  if (c) showQrResult(c);
}

function clearActiveBin() {
  state.activeContainerCode = null;
  persist();
  refreshBinUI();
  showToast('已清除当前箱码');
}

function refreshBinUI() {
  const code = state.activeContainerCode;
  const c = code ? getContainer(code) : null;
  const banner = document.getElementById('activeBinBanner');
  const pill = document.getElementById('addBinPill');
  const txt = c ? `📦 当前箱位 ${c.code} · ${c.emoji} ${c.name}` : '📦 未选定容器 — 先扫箱码再入库';
  if (banner) {
    banner.textContent = txt;
    banner.classList.toggle('active', !!c);
  }
  if (pill) pill.textContent = c ? `箱码：${c.code} · ${c.name}` : '箱码：未绑定（建议先扫码）';
}

function updateAddBinPill() {
  refreshBinUI();
}

function showQrResult(c) {
  const items = state.items.filter((i) => i.containerCode === c.code);
  document.getElementById('qrResultTitle').textContent = `⬡ ${c.code} · ${c.name}`;
  document.getElementById('qrResultBody').innerHTML = `
    <div style="text-align:center;margin-bottom:14px;"><span style="font-size:48px;">${c.emoji}</span>
      <div style="font-size:11px;color:var(--accent2);font-weight:700;margin-top:6px;">${c.code}</div>
      <div style="font-size:12px;color:var(--text3);">${c.loc || ''}</div></div>
    <div class="stitle">箱内 ${items.length} 件</div>
    ${items.slice(0, 5).map((i) => `<div class="card icard" onclick="openDetail('${i.id}');closeSheet('sh-qr-result')"><div class="ithumb">${i.emoji}</div><div class="iinfo"><div class="iname">${i.name}</div><div class="iloc">${i.loc}</div></div></div>`).join('') || '<p class="hint-txt">空箱 · 可拍照入库</p>'}
    <button class="btn-main" onclick="closeSheet('sh-qr-result');openSheet('sh-add')">+ 往此箱入库</button>
    <button class="btn-ghost" style="margin-top:8px;" onclick="openContainerLabel('${c.id}')">打印箱码 QR</button>
  `;
  openSheet('sh-qr-result');
}

// ── QR scan ──
async function toggleQrScan() {
  if (qrScanning) { stopQrScanUi(); return; }
  const btn = document.getElementById('btnQrStart');
  if (btn) btn.textContent = '扫描中…';
  qrScanning = true;
  await startQrScanner('qr-reader', (code, err) => {
    qrScanning = false;
    if (btn) btn.textContent = '开启摄像头扫码';
    if (err) { showToast('⚠ ' + err); return; }
    const c = getContainer(code);
    if (!c) { showToast('⚠ 未知箱码 ' + code); return; }
    setActiveContainer(code);
    showToast('✓ 已锁定 ' + code);
  });
}

function stopQrScanUi() {
  qrScanning = false;
  const btn = document.getElementById('btnQrStart');
  if (btn) btn.textContent = '开启摄像头扫码';
  stopQrScanner();
}

// ── Containers ──
function renderContainers() {
  syncContainerCounts();
  document.getElementById('containerList').innerHTML = state.containers.map((c) => {
    const active = state.activeContainerCode === c.code ? ' bin-active' : '';
    return `<div class="card bin-card${active}" onclick="setActiveContainer('${c.code}')">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;">${c.emoji}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${c.name}</div>
          <div class="code-sm">${c.code}</div>
          <div style="font-size:11px;color:var(--text3);">${c.items} 件 · ${c.confirmed || '未确认'}</div>
        </div>
        <button class="mini-btn" onclick="event.stopPropagation();openContainerLabel('${c.id}')">QR</button>
      </div>
    </div>`;
  }).join('');
}

function fillNewContainerSpaces() {
  const sel = document.getElementById('ncSpace');
  if (!sel) return;
  sel.innerHTML = state.spaces.map((s) => `<option value="${s.id}">${s.emoji} ${s.name}</option>`).join('');
}

async function createContainer() {
  const name = document.getElementById('ncName').value.trim();
  if (!name) { showToast('请填写容器名称'); return; }
  const spaceId = document.getElementById('ncSpace').value;
  const code = nextContainerCode(spaceId, state.containers);
  const c = {
    id: 'c' + Date.now(),
    code,
    spaceId,
    emoji: document.getElementById('ncEmoji').value.trim() || '📦',
    name,
    loc: document.getElementById('ncLoc').value.trim() || name,
    layer: '',
    items: 0,
    confirmed: '今天',
  };
  state.containers.push(c);
  persist();
  renderContainers();
  closeSheet('sh-new-container');
  setActiveContainer(code);
  openContainerLabel(c.id);
  showToast('✓ 箱码 ' + code + ' 已创建');
}

async function openContainerLabel(containerId) {
  const c = state.containers.find((x) => x.id === containerId);
  if (!c) return;
  document.getElementById('containerQrTitle').textContent = c.name;
  document.getElementById('containerQrCode').textContent = c.code;
  const canvas = document.getElementById('containerQrCanvas');
  const ok = await renderQrToCanvas(canvas, c.code, 220);
  if (!ok) showToast('QR 库加载中，请稍候重试');
  openSheet('sh-container-qr');
}

// ── Render home ──
function renderHome() {
  syncContainerCounts();
  const visibleItems = activeItems();
  const expiring = visibleItems.filter((i) => {
    const d = daysUntil(i.expiry);
    return d != null && d <= 14;
  }).sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));

  const banner = document.getElementById('expBanner');
  const bannerText = document.getElementById('expBannerText');
  if (expiring.length) {
    banner.style.display = 'flex';
    bannerText.innerHTML = `<strong style="color:var(--red)">${expiring.length} 件物品即将过期</strong> · ${expiring.slice(0, 2).map((i) => `${i.name.split(' ').slice(-1)[0] || i.name} ${daysUntil(i.expiry)} 天`).join(' · ')}`;
  } else {
    banner.style.display = 'none';
  }

  document.getElementById('homeSub').textContent = `Object Anchors · ${state.spaces.length} spaces · ${state.containers.length} 箱位`;
  document.getElementById('widgetRow').innerHTML = state.widgets.map((w) =>
    `<div class="wchip"><div class="wchip-icon">${w.emoji}</div><div class="wchip-name">${w.name}</div><div class="wchip-sub">${w.sub}</div></div>`
  ).join('');

  if (!visibleItems.length) {
    document.getElementById('spaceList').innerHTML = `
      <div class="card no-data-state">
        <div style="font-size:22px;margin-bottom:8px;">📦</div>
        <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:6px;">还没有本地物品</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.55;">从空白 Personal 开始时，先添加一个物品和购买记忆。数据只保存在本机。</div>
        <button class="btn-main" style="margin-top:12px;" onclick="openSheet('sh-add')">添加第一个物品</button>
      </div>`;
    return;
  }

  document.getElementById('spaceList').innerHTML = state.spaces.map((s) => {
    const cc = confClass(s.confidence);
    const color = s.confidence >= 80 ? 'var(--green)' : s.confidence >= 60 ? 'var(--yellow)' : 'var(--orange)';
    return `<div class="spcard" onclick="openSpace('${s.id}')">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:16px;font-weight:700;">${s.emoji} ${s.name}</span>
        <span style="font-size:10px;color:var(--text3);background:var(--surface3);padding:2px 8px;border-radius:10px;">${s.items}件·${s.containers}箱</span>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:4px;display:flex;justify-content:space-between;"><span>总置信度</span><span style="color:${color};">${s.confidence}%</span></div>
      <div class="cbar"><div class="cfill ${cc}" style="width:${s.confidence}%"></div></div>
    </div>`;
  }).join('');
}

function openSpace(spaceId) {
  state.currentSpaceId = spaceId;
  const space = state.spaces.find((s) => s.id === spaceId);
  document.getElementById('spaceTitle').textContent = `${space.emoji} ${space.name}`;
  document.getElementById('spaceSub').textContent = `${space.items}件·${space.containers}箱`;

  const bins = state.containers.filter((c) => c.spaceId === spaceId);
  let html = '<div class="stitle">箱位 / 容器</div>';
  bins.forEach((c) => {
    html += `<div class="card bin-card" onclick="setActiveContainer('${c.code}');switchTab('scan')">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><span style="font-size:15px;font-weight:600;">${c.emoji} ${c.name}</span>
          <div class="code-sm">${c.code} · ${c.items} 件</div></div>
        <span class="mini-btn">扫码</span>
      </div>
    </div>`;
  });

  const items = activeItems().filter((i) => i.spaceId === spaceId);
  const groups = {};
  items.forEach((i) => {
    const k = i.containerCode || i.container || '其他';
    if (!groups[k]) groups[k] = [];
    groups[k].push(i);
  });

  Object.entries(groups).forEach(([container, list]) => {
    html += `<div class="stitle">${container}</div>`;
    list.forEach((item) => {
      const ring = daysUntil(item.expiry) != null && daysUntil(item.expiry) <= 14 ? 'ring' : '';
      html += `<div class="card"><div class="icard" onclick="openDetail('${item.id}')">
        <div class="ithumb ${ring}">${item.emoji}</div>
        <div class="iinfo">
          <div class="iname">${item.name}</div>
          <div class="iloc">📍 ${item.loc}</div>
          <div class="itags">${item.category ? `<span class="tag t-cat">${item.category}</span>` : ''}${expiryTag(item)}${item.confidence ? `<span class="tag t-ok">✓ ${item.confidence}%</span>` : ''}</div>
        </div>
        <div class="iprice">${item.qty ? '×' + item.qty : item.price ? '$' + item.price : ''}</div>
      </div></div>`;
    });
  });

  if (!items.length && !bins.length) {
    html += '<div class="card no-data-state"><div style="font-size:14px;font-weight:800;margin-bottom:6px;">这个空间还没有物品</div><div style="font-size:12px;color:var(--text2);line-height:1.55;">添加物品后会出现在这里。首发版只保存本地数据。</div></div>';
  }
  document.getElementById('spaceScroll').innerHTML = html;
  goPage('pg-space');
}

function openDetail(itemId) {
  state.currentItemId = itemId;
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const d = daysUntil(item.expiry);
  const purchaseMemory = item.purchaseMemory || {};
  const purchaseMemoryText = purchaseMemory.reason || purchaseMemory.memoryNote || item.note || '';
  const worthLabel = {
    yes: '值得',
    mixed: '一般',
    no: '后悔',
    unknown: '未判断',
  }[purchaseMemory.worthIt || 'unknown'];
  document.getElementById('detailScroll').innerHTML = `
    <div class="dhero">
      <div style="font-size:60px;">${item.emoji}</div>
      <div style="font-size:18px;font-weight:700;">${item.name}</div>
      <div style="font-size:12px;color:var(--text3);">${item.loc}</div>
      ${item.containerCode ? `<div class="code-badge">${item.containerCode}</div>` : ''}
      <div class="itags" style="justify-content:center;">${item.category ? `<span class="tag t-cat">${item.category}</span>` : ''}${expiryTag(item)}</div>
    </div>
    ${item.confidence ? `<div style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:4px;"><span>视觉置信度</span><span>${item.confidence}%</span></div><div class="cbar" style="height:5px;"><div class="cfill ${confClass(item.confidence)}" style="width:${item.confidence}%"></div></div></div>` : ''}
    ${item.price ? `<div class="drow"><span class="drow-l">💰 价格</span><span class="drow-v">$${item.price.toFixed(2)}</span></div>` : ''}
    ${item.spec ? `<div class="drow"><span class="drow-l">📏 规格</span><span class="drow-v">${item.spec}</span></div>` : ''}
    ${item.purchased || purchaseMemory.purchasedAt ? `<div class="drow"><span class="drow-l">📅 购入</span><span class="drow-v">${purchaseMemory.purchasedAt || item.purchased}</span></div>` : ''}
    <div class="drow"><span class="drow-l">值不值</span><span class="drow-v">${worthLabel}</span></div>
    ${item.expiry ? `<div class="drow"><span class="drow-l">⏰ 过期</span><span class="drow-v" style="color:var(--orange);">${item.expiry}${d != null ? ' · ' + d + '天后' : ''}</span></div>` : ''}
    ${item.pao ? `<div class="drow"><span class="drow-l">🧴 PAO</span><span class="drow-v">${item.pao}</span></div>` : ''}
    ${purchaseMemoryText ? `<div style="margin:13px 0 7px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;">购买记忆</div><div class="memory-card">${purchaseMemoryText}</div>` : ''}
    ${item.note ? `<div style="margin:13px 0 7px;font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;">存档备注</div><div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:12px;font-size:12px;color:var(--text2);line-height:1.6;border-left:3px solid var(--orange);">${item.note}</div>` : ''}
    <button class="btn-ghost" style="margin-top:12px;" onclick="confirmItem('${item.id}')">🔄 刷新确认</button>
    <button class="btn-ghost" style="margin-top:8px;" onclick="archiveItem('${item.id}')">归档本地记录</button>
    <button class="btn-danger" style="margin-top:8px;" onclick="deleteItem('${item.id}')">删除本地记录</button>
  `;

  document.getElementById('editForm').innerHTML = `
    <div class="fg"><div class="fl">物品名称</div><input class="fi" id="eName" value="${item.name}"></div>
    <div class="fg"><div class="fl">📍 位置</div><input class="fi" id="eLoc" value="${item.loc}"></div>
    <div class="fg"><div class="fl">🧠 购买记忆</div><textarea class="fi ta" id="eMemory">${purchaseMemoryText}</textarea></div>
    <div class="fg"><div class="fl">💰 价格</div><input class="fi" id="ePrice" type="number" value="${item.price || ''}"></div>
    <div class="fg"><div class="fl">⏰ 过期</div><input class="fi" id="eExp" type="date" value="${item.expiry || ''}"></div>
    <div class="frow">
      <div class="fg"><div class="fl">📅 购买时间</div><input class="fi" id="ePurchased" type="date" value="${purchaseMemory.purchasedAt || item.purchased || ''}"></div>
      <div class="fg"><div class="fl">值不值</div><select class="fi" id="eWorth"><option value="unknown" ${(purchaseMemory.worthIt || 'unknown') === 'unknown' ? 'selected' : ''}>未判断</option><option value="yes" ${purchaseMemory.worthIt === 'yes' ? 'selected' : ''}>值得</option><option value="mixed" ${purchaseMemory.worthIt === 'mixed' ? 'selected' : ''}>一般</option><option value="no" ${purchaseMemory.worthIt === 'no' ? 'selected' : ''}>后悔</option></select></div>
    </div>
    <button class="btn-main" onclick="saveEdit()">保存</button>
  `;

  goPage('pg-detail');
}

function confirmItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (item) { item.confidence = 100; item.updatedAt = new Date().toISOString(); persist(); openDetail(id); }
  showToast('✓ 置信度归位 100%');
}

function fadeItem(id) {
  archiveItem(id);
}

function archiveItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.status = 'archived';
  item.archivedAt = new Date().toISOString();
  item.updatedAt = item.archivedAt;
  persist();
  renderHome();
  goPage('pg-space');
  showToast('已归档本地记录');
}

function deleteItem(id) {
  if (!confirm('确认删除这条本地物品记录？')) return;
  state.items = state.items.filter((i) => i.id !== id);
  persist();
  renderHome();
  goPage('pg-space');
  showToast('已删除本地记录');
}

function saveEdit() {
  const item = state.items.find((i) => i.id === state.currentItemId);
  if (!item) return;
  item.name = document.getElementById('eName').value;
  item.loc = document.getElementById('eLoc').value;
  item.locationHint = item.loc;
  item.price = parseFloat(document.getElementById('ePrice').value) || item.price;
  item.expiry = document.getElementById('eExp').value || item.expiry;
  item.purchased = document.getElementById('ePurchased')?.value || item.purchased;
  item.note = document.getElementById('eMemory')?.value.trim() || item.note;
  item.notes = item.note || '';
  item.purchaseMemory = {
    purchasedAt: item.purchased || '',
    reason: document.getElementById('eMemory')?.value.trim() || '',
    worthIt: document.getElementById('eWorth')?.value || 'unknown',
    memoryNote: document.getElementById('eMemory')?.value.trim() || '',
  };
  item.mode = getActiveDataMode();
  item.updatedAt = new Date().toISOString();
  persist();
  closeSheet('sh-edit');
  openDetail(item.id);
  showToast('✓ 已更新');
}

// ── Stats ──
function renderStats() {
  syncContainerCounts();
  const visibleItems = activeItems();
  const total = visibleItems.length;
  const value = visibleItems.reduce((s, i) => s + (i.price || 0), 0);
  const expiring = visibleItems.filter((i) => { const d = daysUntil(i.expiry); return d != null && d <= 14; }).length;
  const avgConf = Math.round(visibleItems.reduce((s, i) => s + (i.confidence || 80), 0) / Math.max(total, 1));

  const cats = {};
  visibleItems.forEach((i) => { cats[i.category || '其他'] = (cats[i.category || '其他'] || 0) + 1; });
  const maxCat = Math.max(...Object.values(cats), 1);

  document.getElementById('statsScroll').innerHTML = `
    <div class="stat-grid">
      <div class="scard"><div class="snum" style="color:var(--accent2);">${total}</div><div class="slabel">📦 总物品</div></div>
      <div class="scard"><div class="snum" style="color:var(--green);">$${value}</div><div class="slabel">💰 资产估值</div></div>
      <div class="scard"><div class="snum" style="color:var(--orange);">${expiring}</div><div class="slabel">⏰ 即将过期</div></div>
      <div class="scard"><div class="snum" style="color:var(--green);">${state.containers.length}</div><div class="slabel">📦 箱位数</div></div>
    </div>
    <div class="stitle">分类分布</div>
    ${Object.entries(cats).length ? Object.entries(cats).map(([label, count]) =>
      `<div class="cbar-row"><span class="cbar-label">${label}</span><div class="cbar-track"><div class="cbar-fill" style="width:${(count / maxCat) * 100}%;background:linear-gradient(90deg,var(--accent),var(--accent2));"></div></div><span class="cbar-val">${count}件</span></div>`
    ).join('') : '<div class="card no-data-state">暂无本地物品统计</div>'}
    <div class="stitle">⏰ 过期追踪</div>
    ${visibleItems.filter((i) => i.expiry).sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry)).map((i) => {
      const d = daysUntil(i.expiry);
      const badge = d <= 3 ? 'eu' : d <= 14 ? 'es' : 'eo';
      const label = d <= 3 ? `紧急·${d}天` : d <= 14 ? `即将·${d}天` : `充裕·${d}天`;
      return `<div class="eitem"><div class="eitem-info"><div class="eitem-name">${i.name}</div><div class="eitem-date">${i.expiry} · ${i.containerCode || ''}</div></div><span class="ebadge ${badge}">${label}</span></div>`;
    }).join('') || '<div class="card no-data-state">暂无过期提醒</div>'}
  `;
}

// ── Impulse Guard ──
function renderFrozen() {
  document.getElementById('igSaved').textContent = '$' + state.savedTotal;
  document.getElementById('igPts').textContent = state.pts;
  document.getElementById('igSub').textContent = `${state.analytics.length} 次冲动 · ${state.declines} 次成功放下`;

  document.getElementById('frozenList').innerHTML = state.frozen.map((f) => {
    const elapsed = Date.now() - f.frozenAt;
    const totalMs = f.hoursTotal * 3600000;
    const remain = Math.max(0, totalMs - elapsed);
    const pct = Math.min(100, (elapsed / totalMs) * 100);
    const hrs = Math.floor(remain / 3600000);
    const mins = Math.floor((remain % 3600000) / 60000);
    const dup = findDuplicateInInventory(f.name);
    return `<div class="frozen-card" onclick="openFrozenDetail('${f.id}')">
      <div class="fc-top">
        <div class="fc-img">${f.emoji}</div>
        <div class="fc-info">
          <div class="fc-name">${f.name}</div>
          <div class="fc-price">$${f.price.toLocaleString()}</div>
          <div class="fc-source">${f.source}</div>
        </div>
      </div>
      <div class="fc-timer">
        <div style="font-size:11px;color:var(--text3);">冷冻剩余</div>
        <div class="fc-timer-bar"><div class="fc-timer-fill" style="width:${100 - pct}%"></div></div>
        <div class="fc-timer-text">${hrs}h ${mins}m</div>
      </div>
      ${dup ? `<div class="aob"><div class="aob-dot"></div><div class="aob-text">⚠ 大后方已有：${dup.name} (${dup.containerCode || dup.loc})</div></div>` : ''}
    </div>`;
  }).join('') || '<p class="hint-txt">冷冻仓空着 — 这是好事</p>';
}

function findDuplicateInInventory(name) {
  const q = name.toLowerCase().slice(0, 4);
  return state.items.find((i) => i.name.toLowerCase().includes(q) || (i.kw && i.kw.some((k) => name.toLowerCase().includes(k))));
}

function renderGuardUI() {
  const g = ensureGuard(state);
  const card = document.getElementById('shieldCard');
  const active = isShoppingShieldActive(g);
  const remain = formatRemain(shoppingShieldRemainMs(g));

  if (card) {
    card.innerHTML = active
      ? `<div class="shield-on"><div class="shield-title">🛡️ 购物冷冻盾 · 开启中</div><div class="shield-sub">剩余 ${remain} · 打开淘宝/京东前先来这里</div>
         <button class="btn-fox" style="margin-top:10px;" onclick="deactivateShield()">解除冷冻盾</button></div>`
      : `<div class="shield-off"><div class="shield-title">购物冲动高发期？</div><div class="shield-sub">开启 24h 冷冻盾 + 每日别买提醒</div>
         <button class="btn-main" style="margin-top:10px;" onclick="activateShield(24)">开启 24h 冷冻盾</button></div>`;
  }

  document.getElementById('appBlockList').innerHTML = g.blockedApps.map((a) =>
    `<div class="app-row">
      <span class="app-emoji">${a.emoji}</span>
      <div class="app-info" onclick="tapBlockedApp('${a.id}')"><div class="app-name">${a.name}</div><div class="app-tip">${active && a.enabled ? '🛡️ 冷冻中 · ' : ''}${a.tip || ''}</div></div>
      <label class="toggle" onclick="event.stopPropagation()"><input type="checkbox" ${a.enabled ? 'checked' : ''} onchange="toggleBlockedApp('${a.id}', this.checked)"><span></span></label>
    </div>`
  ).join('');
}

function tapBlockedApp(id) {
  const g = ensureGuard(state);
  const a = g.blockedApps.find((x) => x.id === id);
  if (!a?.enabled) { showToast('该 App 未列入冷冻名单'); return; }
  if (isShoppingShieldActive(g)) {
    const dup = state.frozen?.length ? `冷冻仓里有 ${state.frozen.length} 件待决定` : '冷冻仓是空的';
    showToast(`🦊 别急着打开${a.name} · ${dup}`);
    openSheet('sh-guard');
    return;
  }
  showToast(a.tip || `已监控 ${a.name} · 开启冷冻盾后生效`);
}

function renderGuardSettings() {
  const g = ensureGuard(state);
  document.getElementById('guardSettingsBody').innerHTML = `
    <div class="fg"><div class="fl">冷冻盾默认时长</div>
      <select class="fi" id="gHours" onchange="state.guard.freezeHours=+this.value;persist()">
        ${[12, 24, 48, 72].map((h) => `<option value="${h}" ${g.freezeHours === h ? 'selected' : ''}>${h} 小时</option>`).join('')}
      </select>
    </div>
    <div class="app-row">
      <span>🔔</span><div class="app-info"><div class="app-name">每日别买提醒</div><div class="app-tip">每晚提醒先看冷冻仓</div></div>
      <label class="toggle"><input type="checkbox" ${g.dailyReminder ? 'checked' : ''} onchange="toggleDailyReminder(this.checked)"><span></span></label>
    </div>
    <div class="fg"><div class="fl">提醒时间</div>
      <input class="fi" type="number" min="0" max="23" value="${g.reminderHour}" onchange="state.guard.reminderHour=+this.value;scheduleGuardNotifications(state.guard);persist()">
    </div>
    <button class="btn-ghost" onclick="openScreenTimeGuide()">📱 iOS 屏幕使用时间教程</button>
    <p class="hint-txt">真机无法由 App 直接冻结淘宝等应用，需配合系统「App 限额」使用。</p>
  `;
}

function activateShield(hours) {
  activateShoppingShield(ensureGuard(state), hours || state.guard.freezeHours);
  persist();
  scheduleGuardNotifications(state.guard);
  renderGuardUI();
  showToast(`🛡️ 冷冻盾已开 ${hours || state.guard.freezeHours}h`);
}

function deactivateShield() {
  deactivateShoppingShield(ensureGuard(state));
  persist();
  scheduleGuardNotifications(state.guard);
  renderGuardUI();
  showToast('冷冻盾已关闭');
}

function toggleBlockedApp(id, on) {
  const a = state.guard.blockedApps.find((x) => x.id === id);
  if (a) { a.enabled = on; persist(); }
}

function toggleDailyReminder(on) {
  state.guard.dailyReminder = on;
  persist();
  scheduleGuardNotifications(state.guard);
}

function addToFrozen() {
  const name = document.getElementById('fzName').value.trim();
  const price = parseFloat(document.getElementById('fzPrice').value) || 0;
  if (!name) { showToast('请填写商品名'); return; }
  const hours = parseInt(document.getElementById('fzHours').value, 10) || 24;
  const dup = findDuplicateInInventory(name);
  state.frozen.unshift({
    id: 'f' + Date.now(),
    emoji: '🛍️',
    name,
    price,
    source: document.getElementById('fzSource').value.trim() || '手动入库',
    frozenAt: Date.now(),
    hoursTotal: hours,
    duplicate: dup ? `已有 ${dup.name}` : undefined,
  });
  activateShoppingShield(ensureGuard(state), hours);
  persist();
  scheduleGuardNotifications(state.guard);
  closeSheet('sh-freeze-add');
  renderFrozen();
  renderGuardUI();
  showToast('❄️ 已冷冻 · 别买提醒已设');
}

function openFrozenDetail(id) {
  const f = state.frozen.find((x) => x.id === id);
  if (!f) return;
  document.getElementById('frozenSheetTitle').textContent = f.name;
  document.getElementById('frozenSheetBody').innerHTML = `
    <div style="text-align:center;padding:16px 0;"><div style="font-size:52px;">${f.emoji}</div><div style="font-size:20px;font-weight:800;color:var(--red);">$${f.price.toLocaleString()}</div></div>
    <div class="dec-row">
      <button class="dec-no" onclick="igDecline('sh-frozen-detail','${f.name.replace(/'/g, '')}',${f.price})">✓ 不买了 · +${Math.round(f.price)}PTS</button>
      <button class="dec-yes" onclick="closeSheet('sh-frozen-detail');goPage('pg-fox-lock')">继续冻着</button>
    </div>
  `;
  openSheet('sh-frozen-detail');
}

function renderAnalytics() {
  document.getElementById('analyticsScroll').innerHTML = `
    <div class="stat-grid">
      <div class="scard"><div class="snum" style="color:var(--green);">$${state.savedTotal}</div><div class="slabel">✅ 本月拦截</div></div>
      <div class="scard"><div class="snum" style="color:var(--fox2);">${state.pts}</div><div class="slabel">⬡ 积累积分</div></div>
    </div>
    <div class="stitle">近期记录</div>
    ${state.analytics.map((a) => {
      const result = a.result === 'saved' ? `<div class="ag-result ag-saved">✓ 没买 +${a.pts}PTS</div>` : `<div class="ag-result" style="color:var(--text2);">🧠 多巴胺体验预支</div>`;
      return `<div class="ag-item"><div><div class="ag-name">${a.name}</div><div class="ag-sub">$${a.price} · ${a.ago}</div></div>${result}</div>`;
    }).join('')}
    <div class="insight">记录不是为了评判你，是为了让你看见自己正在慢慢学会暂停。</div>
  `;
}

function igDecline(sheetId, name, amount) {
  const ptsGain = typeof amount === 'number' ? Math.round(amount) : parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 50;
  state.pts += ptsGain;
  state.savedTotal += ptsGain;
  state.declines += 1;
  state.analytics.unshift({ name, price: ptsGain, result: 'saved', pts: ptsGain, ago: '刚刚' });
  persist();
  closeSheet(sheetId);
  showToast(`🎉 拦截成功！+${ptsGain} PTS`);
  renderFrozen();
}

function refreshPtsUI() {
  const t = '⬡ ' + state.pts + ' PTS';
  const badge = document.getElementById('ptsBadge');
  const shop = document.getElementById('shopPts');
  const ig = document.getElementById('igPts');
  if (badge) badge.textContent = t;
  if (shop) shop.textContent = t;
  if (ig) ig.textContent = state.pts;
}

function redeemReward(name, cost) {
  if (state.pts < cost) { showToast('⚠ PTS 不足'); return; }
  state.pts -= cost;
  persist();
  showToast('🎁 已兑换：' + name);
}

function completeBreath() {
  state.pts += 20;
  persist();
  goPage('pg-impulse');
  showToast('✓ 呼吸练习完成 +20 PTS');
}

// ── Search ──
function liveSearch(q) {
  const out = document.getElementById('searchOut');
  if (!q.trim()) { out.style.display = 'none'; return; }
  const ql = q.toLowerCase();
  const found = activeItems().filter((i) =>
    i.name.toLowerCase().includes(ql) ||
    (i.containerCode && i.containerCode.toLowerCase().includes(ql)) ||
    (i.kw && i.kw.some((k) => k.includes(ql) || ql.includes(k)))
  );
  out.style.display = 'block';
  if (!found.length) {
    out.innerHTML = '<div class="card no-data-state"><div style="font-weight:800;margin-bottom:5px;">没有找到本地物品</div><div style="font-size:12px;color:var(--text2);">换个关键词，或先添加一个 Inventory / purchase-memory 记录。</div></div>';
    return;
  }
  out.innerHTML = `<div class="stitle">🔍 结果·${found.length}件</div>` +
    found.map((i) => `<div class="card icard" onclick="openDetail('${i.id}')"><div class="ithumb">${i.emoji}</div><div class="iinfo"><div class="iname">${i.name}</div><div class="iloc">${i.containerCode || ''} · ${i.loc}</div></div></div>`).join('');
}

// ── Image / AI ──
function compressImage(dataUrl, maxSide) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const max = maxSide || 1280;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function resetAdd() {
  ['sadd-upload', 'sadd-loading', 'sadd-result', 'sadd-manual'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('sadd-upload').style.display = 'block';
  const inp = document.getElementById('addInput');
  if (inp) inp.value = '';
}

function showManual() {
  document.getElementById('sadd-upload').style.display = 'none';
  document.getElementById('sadd-manual').style.display = 'block';
}

document.getElementById('layerPick')?.addEventListener('click', (e) => {
  const lo = e.target.closest('.lo');
  if (!lo) return;
  document.querySelectorAll('#layerPick .lo').forEach((o) => o.classList.remove('sel'));
  lo.classList.add('sel');
  selectedLayer = lo.dataset.layer;
});

function handleScanPhoto(e) {
  handleAddPhoto(e);
  openSheet('sh-add');
}

function handleAddPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const compressed = await compressImage(ev.target.result);
    document.getElementById('sadd-upload').style.display = 'none';
    document.getElementById('sadd-loading').style.display = 'block';
    document.getElementById('loadTxt').textContent = 'AI 识别中…';
    document.getElementById('prev2').innerHTML = `<img src="${compressed}" alt="preview"><button class="retake" onclick="resetAdd()">重拍</button>`;
    analyzeImage(compressed, 'image/jpeg', (result, err) => {
      document.getElementById('sadd-loading').style.display = 'none';
      document.getElementById('sadd-result').style.display = 'block';
      if (err) showToast('⚠ ' + err);
      document.getElementById('aiN').value = result.name || '';
      document.getElementById('aiC').value = result.category || '';
      document.getElementById('aiPAO').value = result.pao || '';
      if (result.expiry) document.getElementById('fExp').value = result.expiry;
      if (result.spec) document.getElementById('fSpec').value = result.spec;
      if (result.price) document.getElementById('fPrice').value = result.price;
      if (result.emoji) window._lastAiEmoji = result.emoji;
    });
  };
  reader.readAsDataURL(file);
}

async function analyzeImage(dataUrl, mimeType, cb) {
  const FIRST_LAUNCH_IMAGE_AI_ENABLED = false;
  const api = window.STORAGE_API;
  const b64 = dataUrl.split(',')[1];

  if (!FIRST_LAUNCH_IMAGE_AI_ENABLED) {
    void api;
    void b64;
    void mimeType;
    cb({ name: '', category: '', pao: '', expiry: '', spec: '', price: '' }, '首发版本暂不启用 AI 图片识别，请手动填写');
    return;
  }

  if (api) {
    try {
      const endpoint = api + '/api/identify';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, mimeType }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) { cb(data, null); return; }
      const msg = data.hint || data.detail || data.error || `API ${resp.status}`;
      cb({ name: '', category: '', pao: '', expiry: '', spec: '', price: '' }, msg);
      return;
    } catch (e) {
      cb({ name: '', category: '' }, '网络错误，请检查 API 或手动填写');
      return;
    }
  }

  setTimeout(() => {
    cb({
      name: '待确认物品',
      category: '其他',
      description: '未配置 API · 请手动确认',
      pao: '',
      expiry: '',
      spec: '',
      price: '',
      emoji: '📦',
    }, '未配置 STORAGE_API · 演示模式');
  }, 800);
}

function buildItemFromForm(name) {
  const bin = state.activeContainerCode ? getContainer(state.activeContainerCode) : null;
  const locInput = document.getElementById('fLoc')?.value || document.getElementById('mLoc')?.value || '';
  const loc = locInput ? locInput + '·' + selectedLayer : (bin ? bin.loc + '·' + selectedLayer : '未指定·' + selectedLayer);
  const memory = (document.getElementById('fMemory')?.value || document.getElementById('mMemory')?.value || '').trim();
  const purchased = document.getElementById('fPurchased')?.value || document.getElementById('mPurchased')?.value || '';
  const worthIt = document.getElementById('fWorth')?.value || document.getElementById('mWorth')?.value || 'unknown';
  const now = new Date().toISOString();
  const mode = getActiveDataMode();
  return {
    id: 'i' + Date.now(),
    spaceId: bin?.spaceId || state.currentSpaceId || 'master',
    containerId: bin?.id || null,
    containerCode: bin?.code || null,
    container: bin ? `${bin.code} · ${bin.name}` : '新存档',
    emoji: window._lastAiEmoji || '📦',
    name,
    loc,
    locationHint: loc,
    category: document.getElementById('aiC')?.value || '其他',
    price: parseFloat(document.getElementById('fPrice')?.value || document.getElementById('mPrice')?.value) || undefined,
    expiry: document.getElementById('fExp')?.value || document.getElementById('mExp')?.value || undefined,
    pao: document.getElementById('aiPAO')?.value || undefined,
    spec: document.getElementById('fSpec')?.value || undefined,
    purchased: purchased || undefined,
    note: memory || undefined,
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    notes: memory || '',
    purchaseMemory: {
      purchasedAt: purchased,
      reason: memory,
      worthIt,
      memoryNote: memory,
    },
    confidence: bin ? 92 : 75,
    kw: name.toLowerCase().split(/\s+/),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    mode,
  };
}

function saveItem() {
  const name = document.getElementById('aiN').value.trim();
  if (!name) { showToast('请填写物品名称'); return; }
  if (!state.activeContainerCode) {
    if (!confirm('未扫箱码 — 仍要入库吗？建议先扫容器 QR。')) return;
  }
  state.items.push(buildItemFromForm(name));
  window._lastAiEmoji = null;
  persist();
  renderHome();
  closeSheet('sh-add');
  showToast('⚡ 已入库 ' + (state.activeContainerCode || ''));
}

function saveManualItem() {
  const name = document.getElementById('mName').value.trim();
  if (!name) { showToast('请填写物品名称'); return; }
  state.items.push(buildItemFromForm(name));
  persist();
  renderHome();
  closeSheet('sh-add');
  showToast('⚡ 已存档');
}

function doomDone() {
  state.pts += 50;
  persist();
  showToast('🎉 完成！+50 PTS');
}

function renderSettings() {
  const mode = getActiveDataMode();
  const root = loadRootStore();
  const metadata = loadLocalBackupMetadata();
  document.getElementById('settingsApi').textContent = window.STORAGE_API || '未配置（离线优先）';
  document.getElementById('settingsBin').textContent = state.activeContainerCode || '无';
  document.getElementById('settingsMode').value = mode;
  document.getElementById('settingsStorage').textContent = `本机存储 · ${mode} · 无网络可用`;
  document.getElementById('settingsCounts').textContent = `Demo ${root.stores.demo.items.length} 件 / Personal ${root.stores.personal.items.length} 件`;
  document.getElementById('settingsBackups').textContent = `${root.backups.length} 个本地恢复点`;
  document.getElementById('settingsProfile').textContent = `${root.localProfile.displayName} · ${root.localProfile.deviceLabel}`;
  document.getElementById('settingsLastSaved').textContent = formatLocalDateTime(root.localProfile.lastSavedAt || root.localProfile.updatedAt);
  document.getElementById('settingsLastBackup').textContent = `${formatLocalDateTime(metadata.lastBackupExportedAt || metadata.lastBackupImportedAt)}${metadata.lastBackupFileName ? ' · ' + metadata.lastBackupFileName : ''}`;
  document.getElementById('settingsBackupReminder').textContent = backupReminderStatus(metadata);
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportInventory() {
  const mode = getActiveDataMode();
  const root = loadRootStore();
  const payload = {
    exported: new Date().toISOString(),
    version: 'inventory-local-export-v0.1',
    mode,
    dataBoundary: {
      sourceOfTruth: 'device-local-storage',
      demoPersonalSeparated: true,
      includesOnlyActiveMode: true,
      networkRequired: false,
    },
    schemaVersions: root.schemaVersions,
    localProfile: root.localProfile,
    cloudFlags: root.cloudFlags,
    migrationSmokeCheck: runLocalDataMigrationSmokeCheck(root),
    items: readInventoryTable(root, mode, 'items'),
    containers: readInventoryTable(root, mode, 'containers'),
    spaces: readInventoryTable(root, mode, 'spaces'),
    guard: state.guard,
  };
  downloadJson(payload, `baohe-inventory-${mode}-${new Date().toISOString().slice(0, 10)}.json`);
  showToast('已导出库存 JSON');
}

// ── Toast & clock ──
function showToast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('app').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function tick() {
  const now = new Date();
  const el = document.getElementById('clock');
  if (el) el.textContent = now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
}

// ── Breath timer ──
(function initBreath() {
  const phases = [{ label: '吸气', dur: 4 }, { label: '屏息', dur: 2 }, { label: '呼气', dur: 6 }, { label: '屏息', dur: 2 }];
  let pi = 0, sec = phases[0].dur, total = 180;
  setInterval(() => {
    sec--;
    if (sec <= 0) { pi = (pi + 1) % phases.length; sec = phases[pi].dur; }
    total = Math.max(0, total - 1);
    const bl = document.getElementById('breathLabel');
    const bc = document.getElementById('breathCount');
    if (bl) bl.textContent = phases[pi].label;
    if (bc) { const m = Math.floor(total / 60), s = total % 60; bc.textContent = '剩余 ' + m + ':' + (s < 10 ? '0' : '') + s; }
  }, 1000);
})();

function initNative() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  document.body.classList.add('native');
  const StatusBar = cap.Plugins?.StatusBar;
  if (StatusBar?.setStyle) StatusBar.setStyle({ style: 'DARK' });
  scheduleGuardNotifications(ensureGuard(state));
}

function registerInventoryServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}

// ── Boot ──
tick();
setInterval(tick, 30000);
syncContainerCounts();
runLocalDataMigrationSmokeCheck(loadRootStore());
renderHome();
renderContainers();
refreshPtsUI();
refreshBinUI();
renderGuardUI();
initNative();
registerInventoryServiceWorker();
bootstrapRootStoreFromIndexedDb();
showFirstLaunchIfNeeded();
