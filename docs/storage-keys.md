# 本机存储 key —— 分类与红线

> 单一真源是代码:`lib/portal/storage-manifest.ts`(分类器)+ `scripts/storage-key-registry.test.mjs`
> (在册清单 + 契约)。本文解释**为什么这么分**,以及新增 key 时怎么决定。
> 最后更新:2026-07-29(全量普查:161 个 key,捡出 2 个凭证泄露 + 24 个错分)。

## 三分

| kind | 进备份文件 | 上云(模块同步) | 「删除数据」清 | 典型 |
|---|---|---|---|---|
| `auth` | ❌ 绝不 | ❌ 绝不 | 默认保留(除非显式登出) | 令牌、密钥 |
| `cache` | ❌ | ❌ | ✅ | 同步水位、日键 UI 状态、可再生缓存 |
| `durable` | ✅ | ✅ | ✅ | 用户数据、设置、裁决 |

## 新增 key 时问一句

> **换台设备后,这个值「从头开始」是否正确?**

- **是** → `cache`。同步水位、节流时间戳、当天收起、草稿、可重新拉取的缓存。
  这些跨端同步不但没用,还有害:整键 replace 会让两台设备互相抹掉对方的状态。
- **否** → `durable`。用户创建/编辑的记录、用户设置、用户给自己的承诺(静音裁决)。
- **是凭证** → `auth`,并**同时**写进 `AUTH_KEYS`。

登记地点:`scripts/storage-key-registry.test.mjs` 的 `KNOWN_KEYS`;
若归 `cache`/`auth`,还要写进 `storage-manifest.ts` 的 `CACHE_KEYS` / `AUTH_KEYS`。
不登记 → CI 红(这是故意的,见下)。

## 为什么要有注册表契约

`keyKind()` 的默认返回是 `durable`。这意味着**任何新 key 只要没人主动登记,
就自动获得「进备份 + 上云」的待遇**。这不是理论风险,2026-07-29 普查真捡出两类事故:

### ① 凭证被当用户数据(安全)

| key | 内容 | 事故 |
|---|---|---|
| `nesio-connector-tokens-v1` | Notion/Tesla 等连接器的**原始令牌** | 明文进备份 JSON + 推到云端 `user_module_data` |
| `nesio_admin_secret` | `/admin` 管理密钥 | 同上 |

根因是靠"猜词"识别凭证:正则写的是 `token([-_]|$)`,认不出复数 `tokens-v1`;
而 `secret` 这个词**压根不在正则里**。

修法两层:扩正则(`tokens?` / `secrets?` / `credentials?` / `apikey`)+ 给一张
明确的 `AUTH_KEYS` 名单兜底。契约里还钉了"复数/同义词必须认得出"的反例。

### ② 按设备簿记被当用户数据(数据错乱)

24 个键属此类,例:同步水位(`nesio-bank-synced-at`、`nesio-last-backup-at`)、
云同步 outbox(`nesio-life-graph-cloud-sync-outbox-v1`)、今天页日键卡片状态
(`nesio-today-cards-v1`)、草稿(`nesio-xlib-draft-v1`)。它们每轮 churn 上云,
且整键 replace 会两端互抹。全部改判 `cache`。

## 已退役的死键

模块物理删除后,值还躺在用户机器上(占空间、进备份、被当 durable 上云)。
`lib/portal/storage-heal.ts` 的 `RETIRED_KEYS` 一次性清理:

`nesio-guidance-cooling` · `nesio-guidance-ranker-v1` · `nesio-ranker-trainlog-v1` ·
`nesio-ranker-learning-retired-purge-v1` · `nesio-llm-sweep-ledger-v1` ·
`nesio-guidance-lang-cache-v1` · `nesio-cross-region-bandit-retired-purge-v1` ·
`treasurebox-personalization-demo-stage` · `nesio-theme-lowsat-v1` · `baohe_lab_mode` ·
`nesio-node-embeddings-v1`

## 几个容易分错的

| key | 正确分类 | 别分错的理由 |
|---|---|---|
| `nesio-card-verdict-v1` | `durable` | 静音是**用户给自己的承诺**,必须跨端跟人走 |
| `nesio-card-archive-v1` | `cache` | 观测面;整键 replace 会两端互抹(丢的是用户反馈)。承重的裁决另走 card-verdict |
| `nesio-guidance-judge-ledger-v1` | `cache` | 按设备簿记;各判各的成本可接受,数据错乱不可接受 |
| `nesio-push-enabled-v1` | `cache` | **每个浏览器**自己的订阅;同步会让别的设备显示"已开"却收不到 |
| `treasurebox-theme` | `durable` | 走 cloud-profile-sync 跨端;归 cache 会让主题自己变回默认 |
| `nesio-place-geo-v1` | `durable` | ⚠️ 别在 CACHE_RE 里放裸 `geo` —— 会误伤足迹主数据(踩过) |

## 契约

- `test:storage-key-registry`(**在 CI 安全链里**)—— 未登记的 key / 分类漂移 /
  凭证误判 / 核心数据误判成缓存,四者任一即红。
- `test:storage-manifest` —— 分类器本身的行为。
- `test:storage-heal` —— 一次性自愈的保守性(只删有正主的孤儿副本)。
- `test:full-backup-roundtrip` —— 备份往返不丢 durable、不带 auth。
