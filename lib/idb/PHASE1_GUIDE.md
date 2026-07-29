# Phase 1 缓存迁移指南

## 概述

Phase 1 负责将 7 个 P1 优先级的缓存键从 localStorage 迁移到 IndexedDB (IDB)，实现零数据丢失和完整的完整性保护。

### 迁移的 7 个缓存键

1. **nesio-sync-state-*** — 同步状态缓存
2. **nesio-api-cache-*** — API 响应缓存
3. **nesio-map-cache-*** — 地图瓦片缓存
4. **nesio-revgeo-cache-v1** — 反向地理编码缓存
5. **nesio-avatar-thumb-*** — 头像缩略图缓存
6. **nesio-tips-shown-*** — 已显示提示标志
7. **nesio-onboarding-*** — 引导状态标志

## 快速开始

### 执行完整迁移

```typescript
import { executePhase1Migration } from '@/lib/idb';

// 执行迁移
const result = await executePhase1Migration();

if (result.success) {
  console.log(`✓ 成功迁移 ${result.totalItemsMigrated} 项缓存`);
  console.log(generateMigrationReport(result));
} else {
  console.warn('⚠ 迁移完成，但有警告');
  console.log(generateMigrationReport(result));
}
```

### 验证迁移进度

```typescript
import { getMigrationProgress } from '@/lib/idb';

const progress = await getMigrationProgress();
console.log(`迁移进度: ${progress.progressPercent}%`);
console.log(progress.categories);
// 输出:
// [
//   { name: 'sync-state', migrated: 5, pending: 0 },
//   { name: 'api-cache', migrated: 10, pending: 2 },
//   ...
// ]
```

### 检查 Phase 1 清理统计

```typescript
import { getPhase1CleanupStats } from '@/lib/idb';

const stats = await getPhase1CleanupStats();
console.log(`已迁移到 IDB 的缓存:`);
console.log(`  - Sync State: ${stats.syncStateCount} 项`);
console.log(`  - API Cache: ${stats.apiCacheCount} 项`);
console.log(`  - Map Cache: ${stats.mapCacheCount} 项`);
console.log(`  - Avatar Thumb: ${stats.avatarThumbCount} 项`);
// ...
```

## 核心功能

### 1. 迁移器 (Migrators)

#### 4 个独立的迁移器

**cache-sync-state-migrator.ts**
- 迁移: `nesio-sync-state-*`
- 函数:
  - `migrateSyncStateCache(idb)` — 执行迁移
  - `verifySyncStateCache(idb)` — 验证结果
  - `rollbackSyncStateCache(idb)` — 回滚操作

**cache-api-cache-migrator.ts**
- 迁移: `nesio-api-cache-*`
- 相同的 API（migrate/verify/rollback）

**cache-map-migrator.ts**
- 迁移: `nesio-map-cache-*` + `nesio-revgeo-cache-v1`
- 支持 LRU 清理
- 相同的 API

**cache-thumbnails-migrator.ts**
- 迁移: 缩略图和标志键
  - `nesio-avatar-thumb-*`
  - `nesio-tips-shown-*`
  - `nesio-onboarding-*`
- 相同的 API

### 2. 数据完整性检查

#### integrity-checker.ts

```typescript
import {
  generateChecksum,
  verifyChecksum,
  performSamplingVerification,
  performFullVerification,
} from '@/lib/idb';

// 生成数据 checksum
const checksum = await generateChecksum(data);

// 验证 checksum 是否匹配
const matches = await verifyChecksum(data, expectedChecksum);

// 采样验证 (10% + 随机)
const samplingResult = await performSamplingVerification(
  idb,
  'ui-cache',
  'sync-state'
);

// 全量验证
const fullResult = await performFullVerification(
  idb,
  'ui-cache',
  'sync-state'
);
```

### 3. 备份管理

#### backup-manager.ts

```typescript
import {
  createBackup,
  hasBackup,
  restoreFromBackup,
  listBackups,
  getTotalBackupSize,
} from '@/lib/idb';

// 创建备份
const backupKey = createBackup(
  'nesio-sync-state-xyz',
  jsonData,
  checksumValue
);

// 检查是否有备份
if (hasBackup('nesio-sync-state-xyz')) {
  // 从备份恢复
  const backupItem = restoreFromBackup('nesio-sync-state-xyz');
  console.log(`恢复自: ${new Date(backupItem.timestamp).toISOString()}`);
}

// 列出所有备份
const backups = listBackups('nesio-sync-state-xyz');
console.log(`${backups.length} 个备份可用`);

// 获取备份总大小
const backupSize = getTotalBackupSize();
console.log(`备份占用: ${formatBytes(backupSize)}`);
```

备份特性：
- 自动添加时间戳
- 30 天自动过期
- 支持快速恢复
- 零覆盖策略（保留所有备份直到过期）

### 4. 迁移验证

#### migration-validator.ts

```typescript
import {
  validateMigration,
  validateMultipleMigrations,
  generateValidationReport,
} from '@/lib/idb';

// 单个类别验证
const result = await validateMigration(
  idb,
  'sync-state',
  ['nesio-sync-state-1', 'nesio-sync-state-2']
);

if (!result.success && result.alert) {
  console.error(result.alert);
  // localStorage 会被保留为备份
}

// 多个类别的批量验证
const batchResult = await validateMultipleMigrations(idb, [
  { category: 'sync-state', localStorageKeys: [...] },
  { category: 'api-cache', localStorageKeys: [...] },
]);

if (!batchResult.allSuccess) {
  console.warn(`${batchResult.failures.length} 个验证失败`);
}
```

验证流程：
1. 记录数对比
2. 采样对比 (10% + 随机全量)
3. Checksum 对比
4. 失败时保留 localStorage 备份

### 5. 同步队列引擎

#### sync-queue-engine.ts

```typescript
import {
  enqueueSyncItem,
  dequeueSyncItem,
  getSyncQueueStats,
} from '@/lib/idb';

// 添加待同步项
// 如果 IDB 满载自动降级到 localStorage outbox
const queueId = await enqueueSyncItem(
  'nesio-map-cache-xyz',
  'map-cache',
  tileData
);

// 获取队列统计
const stats = await getSyncQueueStats();
console.log(`待同步: ${stats.allPendingCount} 项`);
console.log(`IDB 队列: ${stats.idbTotalCount} 项`);
console.log(`Outbox: ${stats.outboxCount} 项`);
```

队列特性：
- 自动溢出到 localStorage (IDB 满载时)
- 指数退避重试 (1s, 2s, 4s...)
- 最多 3 次重试
- 7 天自动清理

### 6. 一键回滚

#### phase1-rollback.ts

```typescript
import {
  rollbackPhase1,
  rollbackSingleKey,
  rollbackCategory,
  getLastRollbackLog,
} from '@/lib/idb';

// 完整回滚 Phase 1
const result = await rollbackPhase1();
console.log(`✓ 已回滚 ${result.itemsDeleted} 项`);
console.log(`已回滚类别: ${result.categoriesRolledBack.join(', ')}`);

// 单个键回滚
await rollbackSingleKey('nesio-sync-state-xyz');

// 类别回滚
await rollbackCategory('api-cache');

// 查看回滚日志
const log = getLastRollbackLog();
console.log(log.log);
```

回滚特性：
- 完整和单个键回滚
- 详细日志记录
- 保留 localStorage 原数据
- 支持查看历史回滚记录

### 7. 迁移协调器

#### phase1-migration.ts

```typescript
import {
  executePhase1Migration,
  getLastMigrationLog,
  generateMigrationReport,
} from '@/lib/idb';

// 执行完整迁移
const result = await executePhase1Migration();

// 生成报告
if (!result.success) {
  const report = generateMigrationReport(result);
  console.log(report);
  // 输出:
  // === Phase 1 Migration Report ===
  // Status: WARNING
  // Duration: 2340ms
  // Total items migrated: 145
  // Migrations:
  //   - sync-state: 25 items (success)
  //   - api-cache: 40 items (warning) [Checksum mismatch]
  //   ...
}

// 查看上次迁移日志
const log = getLastMigrationLog();
console.log(`上次迁移时间: ${new Date(log.startTime).toISOString()}`);
```

迁移流程：
1. **备份阶段** — 为所有键创建 localStorage 备份
2. **迁移阶段** — 执行 4 个迁移器
3. **验证阶段** — 完整性检查 (采样 + 全量)
4. **报告阶段** — 生成详细报告

## 集成示例

### 应用启动时执行迁移

```typescript
// app/root.tsx 或类似入口文件

import { executePhase1Migration, getLastMigrationLog } from '@/lib/idb';

export async function loader() {
  try {
    // 检查是否已完成迁移
    const lastLog = getLastMigrationLog();
    
    if (!lastLog || !lastLog.success) {
      console.log('Starting Phase 1 migration...');
      const result = await executePhase1Migration();
      
      if (!result.success) {
        console.warn('Migration completed with warnings');
        // 可选：发送告警通知
      }
    }
  } catch (error) {
    console.error('Phase 1 migration failed:', error);
    // 继续应用，迁移是非阻塞的
  }
  
  return null;
}
```

### 监控迁移进度

```typescript
// 组件中显示迁移进度条

import { getMigrationProgress } from '@/lib/idb';
import { useEffect, useState } from 'react';

export function MigrationProgress() {
  const [progress, setProgress] = useState<typeof progress | null>(null);

  useEffect(() => {
    const timer = setInterval(async () => {
      const result = await getMigrationProgress();
      setProgress(result);
    }, 5000); // 每 5 秒检查一次

    return () => clearInterval(timer);
  }, []);

  if (!progress || progress.totalCount === 0) {
    return null;
  }

  return (
    <div>
      <div>迁移进度: {progress.progressPercent}%</div>
      <progress value={progress.progressPercent} max={100} />
      <details>
        <summary>详情</summary>
        <ul>
          {progress.categories.map((cat) => (
            <li key={cat.name}>
              {cat.name}: {cat.migrated}/{cat.migrated + cat.pending}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

### 完整性监控

```typescript
// 后台定期检查完整性

import {
  performFullVerification,
  getLastMigrationLog,
} from '@/lib/idb';

async function verifyIntegrityBackground() {
  const categories = ['sync-state', 'api-cache', 'map-cache'];
  const db = await initializeDB();

  for (const category of categories) {
    const result = await performFullVerification(db, 'ui-cache', category);
    
    if (!result.success) {
      console.error(
        `完整性检查失败 [${category}]: ${result.mismatchCount}/${result.totalSize} 项不匹配`
      );
      
      // 发送告警
      await fetch('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({
          type: 'INTEGRITY_CHECK_FAILED',
          category,
          mismatchCount: result.mismatchCount,
          totalSize: result.totalSize,
        }),
      });
    }
  }
}

// 每小时执行一次
setInterval(verifyIntegrityBackground, 60 * 60 * 1000);
```

## 关键设计原则

### 1. 零数据丢失

- ✅ 迁移前创建 localStorage 备份
- ✅ 迁移后完整性验证 (采样 + 全量)
- ✅ 任何不一致都保留 localStorage
- ✅ 支持一键回滚

### 2. 完整性保护

- ✅ 每项数据都有 SHA256 checksum
- ✅ 采样验证覆盖 10% + 随机
- ✅ 全量验证逐条对比
- ✅ 失败时自动告警

### 3. 容量管理

- ✅ IDB 满载自动降级到 localStorage
- ✅ 7 天 TTL 自动清理
- ✅ LRU 清理地图瓦片
- ✅ 定期清理 outbox

### 4. 监控和可观测性

- ✅ 详细的迁移日志
- ✅ 进度跟踪 (百分比)
- ✅ 分类统计
- ✅ 告警集成

## 故障排查

### 迁移失败

检查 localStorage：
```javascript
// 浏览器控制台
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key?.startsWith('nesio-')) {
    console.log(key, localStorage.getItem(key)?.length);
  }
}
```

检查备份：
```typescript
import { listBackups, getTotalBackupSize } from '@/lib/idb';

const backups = listBackups('nesio-sync-state-xyz');
console.log(`${backups.length} 个备份`);

const backupSize = getTotalBackupSize();
console.log(`总大小: ${backupSize} 字节`);
```

### 完整性检查失败

获取详细信息：
```typescript
import { performFullVerification } from '@/lib/idb';

const result = await performFullVerification(db, 'ui-cache', 'sync-state');
console.log(`失败项: ${result.mismatches.length}`);
console.log(result.mismatches.slice(0, 5)); // 前 5 项
```

### 恢复数据

从备份恢复：
```typescript
import { restoreFromBackup } from '@/lib/idb';

const backup = restoreFromBackup('nesio-sync-state-xyz');
if (backup) {
  localStorage.setItem('nesio-sync-state-xyz', backup.data);
}
```

完整回滚：
```typescript
import { rollbackPhase1 } from '@/lib/idb';

const result = await rollbackPhase1();
console.log(`回滚 ${result.itemsDeleted} 项`);
```

## 性能指标

| 操作 | 典型耗时 | 说明 |
|------|--------|------|
| 迁移 7 个键 (100-500 项) | 100-500ms | 取决于数据量 |
| 采样验证 (10%) | 50-200ms | 逐条 checksum 对比 |
| 全量验证 | 200-1000ms | 完整 checksum 对比 |
| 备份创建 | <10ms/item | 异步操作 |
| 回滚 | 50-300ms | 取决于 IDB 中的项数 |

## 总结

Phase 1 缓存迁移提供了：

- ✅ 4 个独立的迁移器
- ✅ 3 层数据完整性保护 (备份 + 采样 + 全量验证)
- ✅ 完整的一键回滚
- ✅ 云同步队列就绪
- ✅ 详细的监控和告警
- ✅ 零数据丢失保证

所有机制都是非阻塞的，迁移失败不会影响应用正常运行。
