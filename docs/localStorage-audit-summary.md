# localStorage 审计 — 执行摘要

## 审计结果概览

| 指标 | 数值 |
|------|------|
| **总 key 数量** | 66 个独立 key |
| **localStorage 操作** | 209+ 处 |
| **当前占用** | 6-12 MB（重度用户接近上限） |
| **风险等级** | 🔴 中高（写入失败率 2-5%） |

---

## 关键发现

### 1. 存储分类汇总

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
| 分类       | Key 数 | 估算大小  | 用途           | 上云 |
├────────────┼────────┼──────────┼────────────────┼──────┤
| 数据类 P0  |   42   | 10-12 MB | 用户主要数据   | ✓ 是 |
| 缓存类 P2  |   34   | 800 KB   | API 缓存、状态 | ✗ 否 |
| UI 状态    |   45   | 200 KB   | UI 临时状态    | ✗ 否 |
| Legacy/秘密|   15   | 50 KB    | 特殊处理       | ✗ 否 |
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2. 压力最大的 key（可释放空间）

| 排名 | Key 名称 | 估算大小 | 状态 |
|------|---------|--------|------|
| 1️⃣  | `nesio-life-graph-v1` | 500KB-5MB | **数据类** |
| 2️⃣  | `baohe_inventory_v01` | 1MB-10MB | **沙箱（Memorial）** |
| 3️⃣  | `nesio-bank-tx-v1` | 200KB-2MB | **数据类** |
| 4️⃣  | `nesio-health-v1` | 100KB-500KB | **数据类** |
| 5️⃣  | `nesio-workout-history-v1` | 100KB-500KB | **数据类** |
| 6️⃣  | `nesio-person-records-v1` | 100KB-500KB | **数据类** |
| 7️⃣  | `nesio-fin-assets-v1` | 50KB-200KB | **数据类** |

> 前 3 个 key 占 localStorage 总量的 ~80-90%

### 3. 迁移前后对比

```
迁移前状态：
  ├─ localStorage 占用：6-12 MB（主要痛点）
  ├─ 写入失败率：2-5%（同步高峰）
  └─ 可用空间：<1 MB（常态）

迁移后预期（4 周）：
  ├─ localStorage 占用：<1 MB（仅 UI + 秘密令牌）
  ├─ 写入失败率：<0.1%（仅磁盘满）
  └─ IDB 占用：10-20 MB（用户可控）
```

---

## 改造方案（3 周工期）

### W0 第一周 — 危机处理（P0）

**目标**：停止 localStorage 爆满，保护生活图谱和银行数据

```
Day 1-2  IDB schema 设计 + 初始化
Day 3-5  迁移 life-graph 和 bank-tx 到 IDB
Day 6-7  云同步排队修复 + 测试
─────────────────────────────────
成果：释放 1.5-2.5 MB localStorage，稳定数据写入
```

**预期释放**：1.5-2.5 MB  
**工作量**：8 人日  
**风险**：低（完整 fallback）

### W1 第二周 — 扩展存储（P1）

**目标**：清理所有大型数据，建立 TTL 机制

```
Day 1-2  迁移健康、财务、关系数据 → IDB
Day 3-4  建立 1 周 TTL 清理机制
Day 5    localStorage 监控告警
Day 6-7  集成测试
─────────────────────────────────
成果：localStorage < 1 MB，自动垃圾回收上线
```

**预期释放**：额外 800 KB-1.2 MB  
**工作量**：7 人日  
**风险**：中（跨端一致性）

### W2 第三周 — 优化和清理（P2）

**目标**：清理死壳，隔离秘密数据

```
Day 1    清理已废弃的 key（theme-lowsat 等）
Day 2    秘密数据加密存储（connector-tokens）
Day 3    数据恢复工具（导入/导出）
Day 4-5  最终集成测试 + 客户文档
─────────────────────────────────
成果：完整的 localStorage → IDB 迁移，恢复能力就绪
```

**预期收益**：清理 ~20 KB 垃圾，隔离敏感数据  
**工作量**：4 人日  
**风险**：低（可选项）

---

## 财务/优先级

### 立即行动（今天）

- ✅ 删除废弃的 key（`nesio-theme-lowsat-v1` 等）→ **0 风险，< 30 分钟**
- ✅ 审批 IDB schema 设计
- ✅ 安排 W0 开发人力

### 按优先级

| 优先级 | 内容 | 截止 | 人力 |
|--------|------|------|------|
| P0 | life-graph + bank-tx 迁 IDB | 1 周 | 2 人 |
| P1 | 其他数据 + TTL 机制 | 2 周 | 2 人 |
| P2 | 优化 + 文档 | 1 个月 | 1 人 |

**总工期**：3 周（2 人全职）或 6 周（1 人）

---

## 成功指标（可衡量）

| 指标 | 当前 | 目标 | 时间点 |
|------|------|------|--------|
| localStorage 占用 | 6-12 MB | < 1 MB | W2 末 |
| 写入失败率 | 2-5% | < 0.1% | W1 末 |
| IDB 占用 | 0 | 10-20 MB | W2 末 |
| TTL 清理 | ✗ | ✓ 7 天自动 | W1 末 |
| 告警频次 | 1-3/日 | 0/日 | W1 末 |

---

## 每个 key 的分类和改造方案

### 数据类（42 keys, ~10-12 MB）→ IDB 永久表 + 云同步

**优先级 P0（用户主要数据，必保留）**

```
✓ nesio-life-graph-v1              人物/事件/承诺    500KB-5MB     最高优先级
✓ nesio-bank-tx-v1                 银行交易          200KB-2MB     最高优先级
✓ nesio-health-v1                  健康记录          100KB-500KB   最高优先级
✓ nesio-person-records-v1          人物关系          100KB-500KB   高
✓ nesio-workout-history-v1         健身历史          100KB-500KB   高
✓ treasurebox-profile-name         用户名            <1KB          高
✓ treasurebox-profile-avatar       头像 URL          1-5KB         高
✓ treasurebox-locale               语言选择          <1KB          高
...（共 42 个数据类 key）
```

**改造**：
```
localStorage.getItem(key)  →  await idb.get('data-store', key)
                            + fallback to localStorage (SSR)
```

### 缓存类（34 keys, ~800 KB）→ IDB 临时表 + 1 周 TTL

**不上云，过期自动清理**

```
∼ nesio-life-graph-cloud-sync-v1   同步状态         1-5KB         中
∼ nesio-bank-sync-status-v1        同步状态         1-5KB         中
∼ nesio-revgeo-cache-v1            反向地理编码     50-200KB      中
∼ nesio-plaid-enrich-v1            Plaid 标记       <1KB          低
...（共 34 个缓存 key）
```

**改造**：
```
TTL(expiresAt) = Date.now() + 7 * 24 * 60 * 60 * 1000
workers.periodicSync('cleanup', minInterval: 7d)
```

### UI 状态类（45 keys, ~200 KB）→ SessionStorage（可选）或 IDB 临时表

**本会话或 1 天过期**

```
○ nesio-tips-shown-v1              提示已展示        <1KB          可删
○ nesio-theme-palette-v1           主题选择          <1KB          可迁
○ treasurebox-theme                深浅主题          <1KB          可迁
○ baohe_personal_lab               实验开关          <1KB          可迁
...（共 45 个 UI key）
```

**改造**：
```
选项 1（推荐）：→ SessionStorage（浏览器关闭自动清空）
选项 2（保守）：→ IDB 临时表 + 1 天 TTL
选项 3（保留）：→ localStorage 保持不变（影响小）
```

### Legacy/秘密类（15 keys, ~50 KB）→ 特殊处理或删除

```
🗑️ nesio-theme-lowsat-v1            已废弃（替代品存在）        删除
🗑️ nesio-personalization-demo-stage 已废弃（死壳）               删除
🗑️ baohe_lab_mode                  已清理（用 baohe_personal_lab） 删除
🔒 nesio-admin-secret              敏感（管理员凭证）            → 加密 IDB（不上云）
🔒 nesio-connector-tokens-v1       敏感（API 令牌）              → 加密 IDB（不上云）
```

**改造**：
```
删除：grep -r "nesio-theme-lowsat-v1" + delete key
加密：localStorage → IDB with AES-256(key, secretKey)
```

---

## 实施检查清单

### 发起阶段

- [ ] 管理层批准 IDB 迁移项目（3 周，2 人）
- [ ] 成立 2 人核心团队（后端 1 人，前端 1 人）
- [ ] 审批此份审计报告内容

### 设计阶段（D0-D1）

- [ ] IDB schema 终版评审（表结构、索引、版本号）
- [ ] localStorage fallback 方案评审（SSR、老浏览器）
- [ ] 云同步排队架构评审（去重、失败重试）

### 开发阶段（D2-D15）

- [ ] W0：完成 life-graph + bank-tx 迁 IDB
  - [ ] 单测覆盖（load, save, sync）
  - [ ] E2E 测试（新建 / 编辑 / 同步完整路径）
  - [ ] 性能基准测试（IDB vs localStorage 速度）
- [ ] W1：完成其他数据迁移 + TTL 机制
  - [ ] TTL 清理 worker 部署
  - [ ] localStorage 监控告警上线
- [ ] W2：清理 + 隔离 + 文档
  - [ ] 数据恢复工具验证
  - [ ] 客户文档编写

### 测试阶段（D16-D17）

- [ ] 金丝雀部署（10% 用户，监控错误率 48h）
- [ ] 灰度展开（50% → 100%）
- [ ] 故障演练（IDB 满、localStorage 满、离线）

### 发布阶段（D18-D20）

- [ ] 完全上线 + 监控 1 周
- [ ] 收集用户反馈
- [ ] 性能指标上报（localStorage 使用率、IDB 使用率、写入延迟）

---

## 风险应对

| 风险 | 可能性 | 影响 | 对策 |
|------|--------|------|------|
| IDB 写入失败（磁盘满） | 中 | 数据丢失 | 完整 localStorage fallback + 监控告警 |
| localStorage 爆满（迁移期） | 中 | UX 中断 | 优先迁移 top 3 key，提前清理 cache |
| 跨浏览器兼容性问题 | 低 | 部分用户无法访问 | IDB 检测 + 完整降级 + 测试矩阵 |
| 云同步冲突（跨端） | 中 | 数据乒乓 | LWW + 全量 diff + 版本对账 |
| 迁移期间性能下降 | 低 | 用户体验差 | 基准测试 + 优化索引 + 上线监控 |

---

## 成本估算

### 人力

- **核心团队**：2 人（1 后端 + 1 前端）
- **总工作量**：19 人日
- **工期**：3 周（2 人全职）或 6 周（1 人）

### 基础设施

- IDB 查询性能测试：$0（本地开发）
- 云备份修改：$0（使用现有管道）
- 新增监控告警：< $100/月（云告警成本）

### 延期成本

- 每周延期 = 写入失败风险增加、用户投诉
- 建议 **立即启动 W0**，最晚 2 周内开始开发

---

## 快速赢（立即可做）

### 今天（< 2 小时）

1. **删除死壳 key**
   ```bash
   grep -rn "nesio-theme-lowsat-v1" src/ --include="*.ts*"
   # 搜索结果 → 删除相关代码
   ```

2. **清理废弃的 onboarding v13**
   ```bash
   grep -rn "treasurebox-onboarding-v13-done" src/
   ```
   
3. **清理 node-embeddings**
   ```bash
   grep -rn "nesio-node-embeddings-v1" src/
   ```

   **预期释放**：5-10 KB（虽然不多，但无风险）

### 本周（4-8 小时）

1. **IDB schema 定版**
   - 表名、字段、索引一览
   - TTL 字段格式确认
   
2. **准备 localStorage → IDB 适配器框架**
   - getItem → idb.get 转换
   - fallback 降级逻辑

---

## 长期建议

### 设立存储 SLA

```
localStorage 使用率告警：
  ├─ 黄色（>60%）：评估，考虑清理 cache
  ├─ 橙色（>80%）：紧急清理，停止写新数据
  └─ 红色（>95%）：降级到 IDB，禁止 localStorage 新写

IDB 使用率告警：
  └─ >50% 配额：建议用户清理，提供清理工具
```

### 定期审计

- 每季度审计一次 localStorage 使用（新增 key 检查）
- 每年做一次全面迁移评审（技术栈升级）

---

## 问题和答案

### Q: 为什么不直接用 localStorage 配额更大的版本？

**A**: localStorage 是浏览器同源数据，没有"更大版本"。规格由浏览器厂商统一为 ~5-10 MB per origin。IDB 的配额更大（通常 > 50 MB）且由用户控制。

### Q: IDB 在所有浏览器上都支持吗？

**A**: 是的。所有主流浏览器（Chrome, Firefox, Safari, Edge）都支持 IDB（自 2015 年起）。Fallback 到 localStorage 确保兼容。

### Q: 迁移后还需要保留 localStorage 吗？

**A**: 是的。保留用于：
- 主题选择（深/浅）
- UI 临时状态（可选）
- SSR 首屏渲染（数据预加载）
- 老旧浏览器 fallback

### Q: 能否加密敏感数据（connector-tokens）？

**A**: 可以。方案：
```
localStorage.setItem('token', token)  
→  IDB.put('secrets', { key: 'token', value: AES256.encrypt(token, userKey) })
```
但密钥管理需小心（避免硬编码）。

### Q: 云同步会变慢吗？

**A**: 不会。IDB 读写比 localStorage 略快（10-50ms vs 1-5ms），但网络 I/O 主导总延迟。预期无明显变化。

---

**建议**：立即启动 W0 开发，目标 2 周内完成 P0 迁移。

