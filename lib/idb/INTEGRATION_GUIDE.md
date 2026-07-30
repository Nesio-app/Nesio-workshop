# IDB 初始化、监控、回滚、诊断系统集成指南

## 概述

本指南说明如何在 Portal.tsx 中集成完整的 IDB 存储生命周期管理系统。

## 新增模块

### 1. `init-hook.ts` — 应用启动初始化
**职责**：应用启动时的数据库初始化  
**关键函数**：`initializeStorageOnApp(options)`

**触发流程**：
1. 环境检查（浏览器支持）
2. 数据库创建/打开
3. 运行迁移
4. 清理过期缓存
5. 请求持久化存储（可选）
6. 配额监听设置

**集成位置**：Portal.tsx 最早的 useEffect

```typescript
useEffect(() => {
  void initializeStorageOnApp({
    enablePeriodicCleanup: true,
    cleanupIntervalMs: 5 * 60 * 1000, // 5 分钟
    requestPersistentStorage: true,
  });
}, []);
```

### 2. `storage-monitor.ts` — 实时存储监控
**职责**：追踪 localStorage 和 IDB 使用情况  
**关键函数**：`getStorageMetrics()`

**输出指标**：
- `localStorage`：百分比（0-100）
- `idb`：MB 数
- `isDanger`：超过 90% 时触发
- `failureRate`：写入失败率

**调用方**：StorageWarningCard 和 health-check 模块

### 3. `StorageWarningCard.tsx` — 警告卡片 UI
**职责**：当 localStorage > 80% 时展示可见警告  
**特性**：
- warm-coach 文案风格（避免焦虑）
- 提供三个操作：清理 / 了解更多 / 今天不再提醒
- 集成清理函数：`cleanupLRU()` 和 `cleanupExpiredCache()`
- 响应式设计（移动友好）

**集成位置**：Portal.tsx 顶部，作为 alert 显示

```typescript
<StorageWarningCard
  onCleanupStart={() => console.log('cleaning...')}
  onCleanupComplete={(count) => console.log(`Cleaned ${count} items`)}
/>
```

### 4. `rollback.ts` — 故障回滚和恢复
**职责**：IDB 故障时自动降级到 localStorage  
**流程**：
1. 记录写入失败（`recordIDBWriteFailure()`）
2. 累计 5 次失败触发自动降级（`activateFallback()`）
3. 进入降级模式：所有写入转 localStorage + 脏数据标记
4. 定期尝试恢复（5 分钟检查一次）
5. 恢复成功后清除标志

**集成位置**：write-with-fallback.ts 的失败处理

**关键状态**：
```typescript
isFallbackActive() // true 表示当前降级中
getFallbackState() // 获取详细状态
```

**恢复检查**：自动每 5 分钟尝试一次

### 5. `health-check.ts` — 定期健康检查
**职责**：每 5 分钟检查 IDB 健康状态  
**检查项**：
- 可写性（写入测试数据）
- 配额（使用率 < 95%）
- 数据完整性（表可读性）
- 冲突检测（版本标记）

**上报机制**：
- 失败时立即上报
- 其他事件汇总后定期上报（1 分钟）
- POST 到 `/api/portal/diagnostics`

**集成位置**：自动在 window.load 时启动，无需显式调用

```typescript
// 可选：手动触发一次检查
const result = await performHealthCheck();
if (!result.isHealthy) {
  // 处理问题
}

// 获取诊断报告
const report = await getDiagnosticsReport();
console.log(report);
```

## 集成时间线

### 启动序列

```
Portal.tsx mounts
    ↓
useEffect (first) → initializeStorageOnApp()
    ↓
  1. IDB initialization
  2. Health check
  3. Start periodic cleanup
  4. Start periodic health check
  5. Setup quota listener
    ↓
Application ready
```

### 运行时监控

```
Every 5 min:
  - performHealthCheck()
  - getStorageMetrics() [来自 quota listener]

Every 1 min:
  - flushDiagnostics() [汇总上报]

Every hour:
  - resetFailureRateStats()
  - cleanupOldBackups()

When needed:
  - attemptRecovery() [5 分钟检查一次]
  - StorageWarningCard render
```

## 事件系统

### 应用发出的事件

```javascript
// 存储使用超过 80%
'nesio-storage-warning'
  detail: { localStorage, idb, isDanger, ... }

// 存储使用超过 90% 或 IDB 失败
'nesio-storage-danger'
  detail: { ... }

// IDB 降级模式激活
'nesio-fallback-activated'
  detail: { startTime, reason }

// IDB 从降级模式恢复
'nesio-recovery-completed'
  detail: { duration }
```

### 监听示例

```typescript
window.addEventListener('nesio-storage-warning', (e) => {
  const metrics = e.detail;
  console.warn(`Storage at ${metrics.localStorage}%`);
});
```

## 故障诊断

### 检查当前状态

```typescript
import {
  getStorageMetrics,
  getFallbackState,
  getDiagnosticsReport,
} from '@/lib/idb';

// 存储指标
const metrics = await getStorageMetrics();
console.log(metrics);

// 降级状态
const fallback = getFallbackState();
console.log(fallback.active); // true = 处于降级模式

// 完整诊断报告
const report = await getDiagnosticsReport();
console.log(report);
```

### 常见问题

**Q: localStorage 已满但未触发清理卡片**  
A: 检查 `StorageWarningCard` 是否已挂载在 Portal.tsx 中

**Q: IDB 写入多次失败但未自动降级**  
A: 确认 `write-with-fallback.ts` 中调用了 `recordIDBWriteFailure()`

**Q: 降级模式无法恢复**  
A: 检查 `/api/portal/diagnostics` 是否可达，查看浏览器控制台日志

**Q: 备份数据丢失**  
A: 备份默认保留 30 天，使用 `cleanupOldBackups()` 后会清除

## 配置选项

### init-hook.ts

```typescript
initializeStorageOnApp({
  enablePeriodicCleanup: true,              // 启用定期清理
  cleanupIntervalMs: 5 * 60 * 1000,         // 清理间隔（默认 5 分钟）
  requestPersistentStorage: true,           // 请求浏览器持久化存储
  onProgressUpdate: (stage, detail) => {    // 进度回调
    console.log(`[InitHook] ${stage}`, detail);
  },
})
```

### health-check.ts

```typescript
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;  // 5 分钟检查一次
const DIAGNOSTICS_BATCH_SIZE = 10;            // 单批最多 10 条事件
const DIAGNOSTICS_REPORT_INTERVAL = 60 * 1000; // 1 分钟汇总上报
```

### rollback.ts

```typescript
const FALLBACK_FAILURE_THRESHOLD = 5;         // 5 次失败触发降级
const FALLBACK_RECOVERY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟检查恢复
const BACKUP_RETENTION_DAYS = 30;             // 备份保留 30 天
```

## 性能考量

- **init-hook**：阻塞应用启动最多 5 秒（包括数据库打开和迁移）
- **health-check**：每次检查 < 100ms，不阻塞主线程
- **storage-monitor**：指标计算 < 50ms（受 localStorage 大小影响）
- **rollback**：降级激活 < 10ms，恢复尝试 < 100ms

## 已知限制

1. **配额估计**：假设总配额为 50MB（实际 5-50MB 不等）
2. **备份恢复**：当前仅从 localStorage 备份，IDB 数据需手动恢复
3. **跨浏览器标签同步**：健康检查独立运行，无跨标签共享状态
4. **离线模式**：诊断事件在离线时缓冲，恢复在线后上报

## 下一步

集成后可配合以下功能扩展：

1. **告警集成**：连接 Sentry / DataDog 自动上报严重错误
2. **管理仪表板**：在 `/admin` 页面显示存储诊断数据
3. **用户通知**：严重故障时主动通知用户
4. **自动恢复**：严重冲突时自动触发数据同步
5. **容量规划**：基于使用趋势预测何时需要升级
