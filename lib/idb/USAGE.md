# IDB 核心基础设施使用指南

## 概述

Nesio IDB 模块提供生产级的 IndexedDB 离线数据存储解决方案，包括：

- **idb-core.ts** - IndexedDB 初始化和配额管理
- **version-manager.ts** - 数据版本化和冲突检测（LWW）
- **write-with-fallback.ts** - 安全写入（失败自动降级到 localStorage）
- **offline-queue.ts** - 待同步队列（离线时缓冲操作）
- **cleanup.ts** - 自动清理机制（TTL、LRU）
- **index.ts** - 统一导出和初始化工具

## 快速开始

### 1. 应用启动时初始化

```typescript
import { initializeIDBInfrastructure } from '@/lib/idb';

// 在应用启动时调用
await initializeIDBInfrastructure({
  enablePeriodicCleanup: true,      // 启用自动清理
  cleanupIntervalMs: 6 * 60 * 60 * 1000,  // 6 小时清理一次
  requestPersistentStorage: true,   // 请求持久化存储
});
```

### 2. 安全写入数据

```typescript
import { safeWrite, listenToWriteEvents } from '@/lib/idb';

// 监听写入事件（包括失败情况）
listenToWriteEvents((event) => {
  const { table, dataId, status, error } = event.detail;
  
  if (status === 'success') {
    console.log('数据已保存到 IDB');
  } else if (status === 'fallback') {
    console.warn('IDB 不可用，已降级到 localStorage，请尽快同步');
    showErrorUI('数据正在本地缓存，检查网络连接后会自动同步');
  } else if (status === 'error') {
    console.error('写入失败:', error);
    showErrorUI('数据保存失败，请重试');
  }
});

// 写入数据
const result = await safeWrite('signals', {
  id: 'signal-123',
  userId: 'user-1',
  content: 'Morning check-in',
  createdAt: Date.now(),
  table: 'signals',
});

// result.success: true/false
// result.tier: 'idb' | 'localStorage'
// result.error?: Error（如果失败）
```

### 3. 离线操作队列

```typescript
import { enqueue, dequeue, getQueueStats } from '@/lib/idb';

// 在离线模式下入队操作
await enqueue('signals', 'create', {
  id: 'signal-new',
  userId: 'user-1',
  content: '离线创建的信号',
  createdAt: Date.now(),
}, 3); // 最多重试 3 次

// 获取队列统计
const stats = await getQueueStats();
console.log(`待同步项: ${stats.pending}, 重试中: ${stats.retrying}, 失败: ${stats.failed}`);

// 恢复在线时，后台自动处理队列
// 或手动处理：
while (true) {
  const item = await dequeue();
  if (!item) break;
  
  try {
    // 执行实际的同步操作
    await syncToServer(item);
    await markSuccess(item.id);
  } catch (error) {
    const isFinal = await markFailure(item.id, error.message);
    if (isFinal) {
      // 处理永久失败（重试次数已用尽）
      notifyUser(`同步失败: ${item.data.id}`);
    }
  }
}
```

### 4. 脏数据恢复

```typescript
import { getDirtyData, clearAllDirtyMarks } from '@/lib/idb';

// 启动时检查是否有降级到 localStorage 的脏数据
const dirtyItems = getDirtyData();

if (dirtyItems.length > 0) {
  console.log(`发现 ${dirtyItems.length} 条脏数据，需要同步`);
  
  for (const { table, id, data } of dirtyItems) {
    try {
      // 重新写入 IDB
      await safeWrite(table, data);
    } catch (error) {
      // 仍然失败，稍后重试
    }
  }
}

// 成功同步后清除脏标记
await clearAllDirtyMarks();
```

### 5. 版本化和冲突解决

```typescript
import { setVersion, getVersion, resolveLWW, computeChecksum } from '@/lib/idb';

// 为数据加上版本信息
const data = { id: '123', name: 'Test', createdAt: Date.now() };
const versioned = setVersion(data, 'client-1');

// 获取版本信息
const version = getVersion(versioned);
console.log(`Lamport Clock: ${version.lamportClock}, Timestamp: ${version.timestamp}`);

// LWW 冲突解决
const localData = { id: '123', name: 'Local Name' };
const remoteData = { id: '123', name: 'Remote Name' };

const winner = await resolveLWW(localData, remoteData);
console.log(`使用 ${winner} 的数据`);

// 验证数据完整性
const checksum = await computeChecksum(data);
const isValid = await verifyIntegrity(data, checksum);
```

### 6. 手动清理

```typescript
import { performFullCleanup, getCleanupStats } from '@/lib/idb';

// 执行完整的清理流程
const cleanupStats = await performFullCleanup();
console.log(`
  删除过期缓存: ${cleanupStats.expiredCacheDeleted}
  LRU 清理: ${cleanupStats.lruDeleted}
  TTL 清理（信号）: ${cleanupStats.signalsTTLDeleted}
  TTL 清理（模块数据）: ${cleanupStats.moduleDataTTLDeleted}
  队列过期项: ${cleanupStats.queueExpiredDeleted}
  总计删除: ${cleanupStats.totalDeleted}
`);

// 获取清理统计信息
const stats = await getCleanupStats();
console.log(`
  UI 缓存项数: ${stats.uiCacheItemCount}
  信号数: ${stats.signalsItemCount}
  模块数据: ${stats.moduleDataItemCount}
  队列项数: ${stats.queueItemCount}
  估计总大小: ${stats.estimatedTotalSize} 字节
`);
```

## 数据库架构

### 存储表定义

| 表名 | KeyPath | 索引 | 用途 |
|------|---------|------|------|
| signals | id | createdAt, userId, table | 信号/事件日志 |
| user_module_data | id | table, userId | 用户模块数据 |
| ui-cache | key | accessedAt, expiresAt | UI 渲染缓存（LRU） |
| encrypted-secrets | id | category, userId | 加密敏感数据 |
| sync-queue | id | createdAt, status | 待同步队列 |

### 版本信息（__version 字段）

每条数据自动加上版本信息：

```typescript
{
  __version: {
    lamportClock: 123,           // 逻辑时钟（分布式一致性）
    timestamp: "2026-07-29T21:10:00.000Z",  // ISO 时间戳
    timestampMs: 1722300600000,  // 毫秒时间戳
    originId?: "client-1",       // 发起者 ID
    checksum?: "abc123def456"    // SHA256 校验和
  },
  // ... 其他数据字段
}
```

## 错误处理

根据 CLAUDE.md 设计规则，**所有异步操作都必须有明确的错误状态**。

### 安全写入失败处理

```typescript
const result = await safeWrite('signals', data);

if (!result.success) {
  if (result.tier === 'localStorage') {
    // 显示警告：数据已临时缓存到本地
    showAlert({
      type: 'warning',
      title: '网络暂时不可用',
      message: '数据已保存在本地，恢复网络后自动同步',
      actions: [
        { label: '稍后', onClick: () => {} },
        { label: '重试', onClick: () => retry() }
      ]
    });
  }
  if (result.error) {
    console.error('Write error details:', result.error);
  }
}
```

### 队列同步失败处理

```typescript
try {
  const item = await dequeue();
  await syncToServer(item);
  await markSuccess(item.id);
} catch (error) {
  const isFinal = await markFailure(item.id, error.message);
  
  if (isFinal) {
    // 永久失败，通知用户
    showAlert({
      type: 'error',
      title: '同步失败',
      message: `项目 ${item.id} 同步失败，已重试 3 次。`,
      actions: [
        { label: '忽略', onClick: () => {} },
        { label: '重试', onClick: () => markPending(item.id) }
      ]
    });
  }
}
```

## 性能指标

- **IDB 初始化**: ~10-50ms
- **单条写入**: ~1-5ms（IDB），<1ms（localStorage）
- **读取 1000 条**: ~50-100ms
- **全表扫描**: O(n)，根据表大小而定
- **清理操作**: ~100-500ms（后台运行）

## 配额管理

```typescript
import { checkQuota, shouldRequestPersistent, requestPersistentStorage } from '@/lib/idb';

// 检查当前配额
const quota = await checkQuota();
console.log(`使用率: ${(quota.percentUsed * 100).toFixed(2)}%`);

// 检查是否应该请求持久化
if (await shouldRequestPersistent()) {
  const success = await requestPersistentStorage();
  if (success) {
    console.log('已获得持久化存储权限');
  }
}
```

## 测试指南

```typescript
import { initializeDB, clearDatabase, healthCheck } from '@/lib/idb';

// 重置测试环境
beforeEach(async () => {
  await clearDatabase();
});

// 检查 IDB 是否可用
const isHealthy = await healthCheck();
expect(isHealthy).toBe(true);
```

## 浏览器兼容性

- Chrome/Edge: ✅ 完全支持
- Firefox: ✅ 完全支持
- Safari: ✅ 完全支持（iOS 13.4+）
- IE 11: ❌ 不支持

fallback 机制确保在 IDB 不可用时自动使用 localStorage，但功能会受限。

## 常见问题

### Q: localStorage 中的脏数据多久会过期？
A: 7 天。过期的脏数据会在清理阶段自动删除。

### Q: IDB 数据库大小有限制吗？
A: 因浏览器而异。Chrome/Firefox 通常是 50MB，Safari 更少。使用 LRU 和 TTL 清理自动管理。

### Q: 如何处理版本冲突？
A: 使用 LWW（Last-Write-Wins）策略，基于 Lamport 时钟和时间戳。也可自定义冲突解决逻辑。

### Q: 离线时可以缓存多久？
A: 使用 `estimateOfflineCapacity()` 函数获取估计值。通常能缓冲几天的操作。

---

**相关文件**: `/home/user/Nesio-workshop/lib/idb/`
