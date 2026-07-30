# 家用桌面机器人接入 Nesio（中文语音入口 · 基于自己的数据库）

在家里桌上放一台自己搭的小机器人：随口说一句中文就入档（记），随口问一句就从
**自己的云记忆池**里找答案念回来（问）。数据库就是现成的 —— Supabase `signals` 主事实表，
`identity_key = supabase:<NESIO_OWNER_ID>`，**与 App、Alexa 共用同一片记忆**，不是隔离的新库。

> 定位：这是继 App、Alexa 之后的**第三个客户端**。Alexa 通道有两个天然短板 ——
> ① 无中文 NLU（en-US only）；② 语音先过 Amazon 云（便利换隐私）。
> 自建桌面机器人两个都解决：**中文原生 + 语音不出家门**（本地唤醒 + 本地转写，只有文本上自己的服务端）。

---

## 架构（复用现成管道，零新表）

```
桌面机器人(Pi/旧电脑)                         自己的 Vercel + Supabase
┌──────────────────────────┐
│ 唤醒词(openWakeWord 本地) │
│  → VAD(silero, 本地)      │
│  → ASR(faster-whisper 本地│
│        中文转写)          │──文本──→ POST /api/portal/ingest        ←记（现成，零改动）
│                          │          {source:'robot', content, secret}
│                          │          → createSignal → 云 signals 表
│                          │
│                          │──文本──→ POST /api/robot                 ←问（需新增，复用 Alexa 召回链）
│                          │          读云 signals → sortRowsForQuery
│                          │          → LLM 一句话中文答（挂了兜底念原文）
│  ← TTS(piper 本地中文) ───│←─文本────┘
└──────────────────────────┘
```

- **记**：`/api/portal/ingest` 是通用外部捕获口（`{source, content, secret}`），Alexa 也走它。
  机器人用 `source:'robot'`，凭 `INGEST_SHARED_SECRET`（`safeEqual` 常量时间比较）。
- **问**：Alexa 路由里的召回链（`readCloudSignalRowsForIdentity` → `sortRowsForQuery` →
  `rowsToSnippets`/`buildRecallPrompt` → `completeText`，LLM 挂了 `fallbackRecallAnswer`
  确定性兜底）已经是纯函数拼装，抽一个 `/api/robot` 路由即可复用——差异只有两点：
  鉴权改共享密钥（不校验 Alexa applicationId）、prompt 出中文（`alexa-answer.ts` 现为英文）。

---

## 硬件三档（按投入排）

| 档 | 配置 | 说明 |
|---|---|---|
| **零硬件验证（先做这个）** | 家里任何一台旧电脑 / Mac | 同一套客户端脚本，先把链路全部跑通再买硬件 |
| **推荐主力** | Raspberry Pi 5 (8GB) + ReSpeaker 2-Mic/4-Mic 阵列 + 3W 小音箱 + 可选 3.5" 屏 | ~¥800–1200；Pi 5 跑得动 faster-whisper small 中文转写；屏幕可做表情/状态 |
| **玩家路线（不推荐首选）** | ESP32-S3-BOX-3 等 | 端上算力跑不动 whisper，需局域网自建中继主机；ESP-SR 中文命令词有限，链路复杂化 |

麦克风阵列比单麦重要（远场拾音）；音箱随意。外壳/舵机云台是纯装饰层，最后再做。

## 软件栈（机器人端，全本地、全免费）

| 环节 | 选型 | 说明 |
|---|---|---|
| 唤醒词 | openWakeWord（或 Porcupine） | 自训「念念 / Nessa」唤醒模型，纯本地 |
| 断句 | silero-vad | 判定一句话说完 |
| 中文转写 | faster-whisper（small/medium） | Pi 5 跑 small 够用；或局域网内一台电脑跑 server 模式 |
| 对话/召回 | 自己的 Nesio 服务端（见上） | 唯一出家门的是**文本** |
| 中文合成 | piper（zh_CN 音色） | 本地、免费、零云。想要更好音色再考虑云 TTS（见欠账） |

## 与数据库的接线

### 记（今天就能用，服务端零改动）

```bash
curl -X POST https://treasurebox-nu.vercel.app/api/portal/ingest \
  -H 'Content-Type: application/json' \
  -d '{"source":"robot","content":"备用钥匙放在玄关抽屉","secret":"<INGEST_SHARED_SECRET>"}'
```

- 落库判定用响应里的 `cloudSignalWrite.ok === true` —— **诚实态**（同 Alexa）：只有真进了云
  `signals` 才对用户说「记下了」，失败要说「刚才没存上」，绝不静默假装成功。
- `source:'robot'` 建议加进 ingest 的规则兜底分支（同 `'alexa'`）：语音捕获不消费抽取结果，
  跳过 LLM 抽取省钱提速。
- 限流现成：30 次/窗口；空内容 400。

### 问（需新增 `/api/robot`，半天工作量）

1. 复制 `app/api/alexa/route.ts` 的 `recallMemory` 骨架，去掉 Alexa 专属的
   `applicationId`/timestamp 校验，改为 body `secret` 走 `safeEqual` 对比
   `ROBOT_SHARED_SECRET`（独立密钥，便于单独吊销）+ `isRateLimited`。
2. `alexa-answer.ts` 的 `buildRecallPrompt`/`fallbackRecallAnswer`/`emptyRecallAnswer`
   加 `locale: 'zh'` 变体（英文 prompt 是写死的，中文机器人要中文答复）。
3. **红线**：这是花钱路由（LLM）——按 `/api/alexa` 先例（secret + 限流）或挂
   `guardAiRoute`，并**登记 `docs/api-routes.md`**，缺一不可。
4. 归属沿用 `resolveOwnerIdentity()`（读 `NESIO_OWNER_ID`）—— Alexa 已配好，直接共用。

## 环境变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `INGEST_SHARED_SECRET` | ✅ 已配（Alexa 在用） | 「记」的凭证，机器人直接共用 |
| `NESIO_OWNER_ID` | ✅ 已配（Alexa 在用） | owner 的 Supabase user id，「问」的归属身份 |
| `ROBOT_SHARED_SECRET` | 新增 | 「问」路由的独立密钥；也可先偷懒复用 INGEST 密钥，但独立密钥可单独吊销 |

改 env 后**必须 redeploy** 才生效（Alexa 踩坑史第一条，见 STATE.md）。

## 施工路线（每步可独立验收）

1. **阶段 0（半小时，零硬件）**：电脑上 curl 打通「记」，App 今天页里看到这条记忆。
2. **阶段 1（一个周末）**：旧电脑上跑通全语音链：唤醒 → 转写 → ingest → piper 念「记下了」。
   客户端主循环 ~150 行 Python。
3. **阶段 2（半天服务端）**：`/api/robot` 召回路由 + 中文 prompt，语音问「我的护照在哪」。
4. **阶段 3（硬件化）**：装进 Pi + 麦阵 + 音箱，systemd 开机自启。**设计红线照搬 App**：
   每个异步动作必有可见失败态——断网/落库失败要用灯色或语音明说，绝不静默转回待机。
5. **阶段 4（可选加分）**：屏幕表情、舵机转头、早晨主动念日报。
   > 2026-07-30 更新：原先这里写的是接 `/api/portal/daily-brief`——那条路由是语音简报时代
   > 的遗物，全仓零调用方，已删除。现在的每日日报是 `lib/portal/daily-report.ts`，
   > **纯规则、无网络、无 AI、无付费门**，机器人拿 markdown 直接念即可，反而更省事。

## 欠账 / 明确不做

- **云 TTS**：`/api/portal/tts`（OpenAI）挂 `guardAiRoute`，机器人无 cookie 会话打不了；
  想用需给它加 secret 通道。先用本地 piper，音色够了就不欠。
- 服务端 ingest 的 `[nesio:dropped] signal.idb_write` 日志噪音属预期（服务端无 IndexedDB，
  云写成功不受影响），与 Alexa 同款，待清。
- 多轮对话/闲聊走 `/api/portal/chat` 需要会话 cookie，v1 不做——机器人先做好「记」和「问」两件事。
