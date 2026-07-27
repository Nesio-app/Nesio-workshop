# Capture Adapters — 按内容类型入库

> 目标:相机 / 文件 / 语音最终走 `ingestCapture`,而不是各 Sheet 各写一套分支。
> 实现:`lib/portal/capture-adapters.ts`(接口 + 默认 stub 注册表)。

## 内容类型

| type | 认领信号 | 落点 |
|---|---|---|
| `receipt` | 多数条目带 price / 小票关键词 | life nodes + `addReceiptExpense`;行程则 `appendShoppingReceipt` |
| `food` | 进货模式 / 食材 subtype | cooking pantry / inventory |
| `document` | PDF/证件类 | life node document |
| `scene` | 默认场景照 | life node + 可选地点 |
| `person` | 明确有人 | person / relationship |
| `inventory` | 物品入库意图 | inventory |
| `booking-confirm` | 订票粘贴 | trip nodes |
| `dish-photo` | 菜照 / 记一餐 | cooking meals |
| `unknown` | 兜底 | life node |

## API

```ts
registerCaptureAdapter(adapter)
resolveCaptureAdapter(input)
ingestCapture(input) → CaptureResult
```

当前默认适配器为 **stub**(返回 `ok` + message),真实逻辑仍在 `CameraSheet`。
下一轮:把 receipt / food 分支迁入真实 adapter,Sheet 只负责取证与确认 UI。

## 失败态

异步 ingest 失败必须把 `CaptureResult.ok=false` + `message` 交给 UI 展示重试,禁止静默 idle。
