/**
 * bank-tx-migrator.ts — 从 localStorage 迁移银行数据到 IDB
 *
 * 迁移三个数据源：
 * - nesio-bank-tx-v1: 银行交易
 * - nesio-bank-accounts-v1: 账户信息
 * - nesio-fin-holdings-v1: 投资持仓
 *
 * 所有数据转换为 IDB user_module_data 表格式，带版本戳。
 */

import { sha256 } from '../version-manager';
import type { VersionInfo } from '../version-manager';

export interface BankMigrationResult {
  success: boolean;
  txCount: number;
  accountCount: number;
  holdingCount: number;
  txChecksum: string;
  accountsChecksum: string;
  holdingsChecksum: string;
  error?: string;
}

/**
 * 获取 localStorage 中的 JSON 数据。
 */
function loadFromLocalStorage(key: string): any {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error(`[BankMigrator] Failed to parse ${key}:`, e);
    return null;
  }
}

/**
 * 迁移银行数据（交易、账户、持仓）到 IDB。
 */
export async function migrateBankData(idb: IDBDatabase): Promise<BankMigrationResult> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      txCount: 0,
      accountCount: 0,
      holdingCount: 0,
      txChecksum: '',
      accountsChecksum: '',
      holdingsChecksum: '',
      error: 'Not in browser environment',
    };
  }

  try {
    const tx = idb.transaction(['user_module_data'], 'readwrite');
    const store = tx.objectStore('user_module_data');

    let txCount = 0;
    let accountCount = 0;
    let holdingCount = 0;
    let txChecksum = '';
    let accountsChecksum = '';
    let holdingsChecksum = '';

    // 迁移交易数据
    const txData = loadFromLocalStorage('nesio-bank-tx-v1');
    if (Array.isArray(txData) && txData.length > 0) {
      txChecksum = await sha256(JSON.stringify(txData));
      txCount = await migrateBankTxData(store, txData);
    }

    // 迁移账户数据
    const accountsData = loadFromLocalStorage('nesio-bank-accounts-v1');
    if (Array.isArray(accountsData) && accountsData.length > 0) {
      accountsChecksum = await sha256(JSON.stringify(accountsData));
      accountCount = await migrateBankAccountsData(store, accountsData);
    }

    // 迁移持仓数据
    const holdingsData = loadFromLocalStorage('nesio-fin-holdings-v1');
    if (Array.isArray(holdingsData) && holdingsData.length > 0) {
      holdingsChecksum = await sha256(JSON.stringify(holdingsData));
      holdingCount = await migrateBankHoldingsData(store, holdingsData);
    }

    return {
      success: true,
      txCount,
      accountCount,
      holdingCount,
      txChecksum,
      accountsChecksum,
      holdingsChecksum,
    };
  } catch (error) {
    console.error('[BankMigrator] Migration failed:', error);
    return {
      success: false,
      txCount: 0,
      accountCount: 0,
      holdingCount: 0,
      txChecksum: '',
      accountsChecksum: '',
      holdingsChecksum: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 迁移交易数据。
 */
async function migrateBankTxData(store: IDBObjectStore, txs: any[]): Promise<number> {
  const now = new Date();
  let count = 0;
  let lamportClock = 0;

  for (const tx of txs) {
    if (!tx || typeof tx !== 'object') continue;

    const moduleDataId = `bank-tx-${tx.id || Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = tx.date ? new Date(tx.date).toISOString() : now.toISOString();

    const version: VersionInfo = {
      lamportClock: ++lamportClock,
      timestamp: createdAt,
      timestampMs: new Date(createdAt).getTime(),
      originId: 'migration-bank-tx-v1',
    };

    const record = {
      id: moduleDataId,
      table: 'bank-tx',
      module: 'finance',
      data: tx,
      __version: version,
      createdAt: createdAt,
      userId: undefined,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const request = store.add(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      count++;
    } catch (e) {
      console.warn(`[BankMigrator] Failed to migrate transaction ${tx.id}:`, e);
    }
  }

  console.log(`[BankMigrator] Migrated ${count} transactions`);
  return count;
}

/**
 * 迁移账户数据。
 */
async function migrateBankAccountsData(store: IDBObjectStore, accounts: any[]): Promise<number> {
  const now = new Date();
  let count = 0;
  let lamportClock = 0;

  for (const account of accounts) {
    if (!account || typeof account !== 'object') continue;

    const moduleDataId = `bank-account-${account.id || Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = now.toISOString();

    const version: VersionInfo = {
      lamportClock: ++lamportClock,
      timestamp: createdAt,
      timestampMs: new Date(createdAt).getTime(),
      originId: 'migration-bank-accounts-v1',
    };

    const record = {
      id: moduleDataId,
      table: 'bank-account',
      module: 'finance',
      data: account,
      __version: version,
      createdAt: createdAt,
      userId: undefined,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const request = store.add(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      count++;
    } catch (e) {
      console.warn(`[BankMigrator] Failed to migrate account ${account.id}:`, e);
    }
  }

  console.log(`[BankMigrator] Migrated ${count} accounts`);
  return count;
}

/**
 * 迁移持仓数据。
 */
async function migrateBankHoldingsData(store: IDBObjectStore, holdings: any[]): Promise<number> {
  const now = new Date();
  let count = 0;
  let lamportClock = 0;

  for (const holding of holdings) {
    if (!holding || typeof holding !== 'object') continue;

    const moduleDataId = `bank-holding-${holding.name || Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = now.toISOString();

    const version: VersionInfo = {
      lamportClock: ++lamportClock,
      timestamp: createdAt,
      timestampMs: new Date(createdAt).getTime(),
      originId: 'migration-fin-holdings-v1',
    };

    const record = {
      id: moduleDataId,
      table: 'bank-holding',
      module: 'finance',
      data: holding,
      __version: version,
      createdAt: createdAt,
      userId: undefined,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const request = store.add(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      count++;
    } catch (e) {
      console.warn(`[BankMigrator] Failed to migrate holding ${holding.name}:`, e);
    }
  }

  console.log(`[BankMigrator] Migrated ${count} holdings`);
  return count;
}
