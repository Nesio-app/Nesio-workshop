import './node-fact-sink';
/**
 * ingestLifeNode — LifeNode 形状输入的统一写入口(Signal 迁移里程碑 1)。
 *
 * 背景:createSignal() 号称唯一写入口,但审计发现大量旁路直调
 * addLifeNode(ConnectorsHub、gmail 后台同步、Portal 日历保存、
 * onboarding…)。直接把它们换成 createSignal 会改变节点形状
 * (type 重推断、tags 追加、relations 丢弃)——回归风险不可接受。
 *
 * 方案:保持 LifeNode 形状原样落库(消费者零感知),同时投影出
 * 规范 Signal 进入事实流水(IDB 事实库 + 云镜像)。这样:
 *   - 所有写入都产出 Signal 事实(迁移目标达成)
 *   - 现有读路径/形状完全不变(零回归)
 *   - M3 读切换时,事实库已有完整流水
 *
 * 规则:组件层今后禁止直调 addLifeNode——用本函数或 createSignal。
 */

import { addLifeNode, getLifeGraph, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { loadLastLocation, refreshLocation } from '@/lib/portal/location-store';
import { captureLocationEnabled, getFreshCaptureFix, prefetchCaptureLocation } from '@/lib/portal/capture-location';
import { lifeNodeToSignal } from './signal';
import { signalWriteMode, writeCloudSignal } from './create-signal';
import { isSignalEpistemic, stampEpistemic } from './signal-epistemic';

export type IngestNodeInput = Omit<LifeNode, 'id' | 'createdAt'>;

// 批次 55/56(用户点名):主动记下的每一条记忆(文字/图片/语音)自动盖上当时的
// 位置戳。只盖捕获源 —— 导入类(email/calendar/system/device)的"当时"不是
// 设备此刻,不盖。两档:
//  ① 「记忆自动定位」开关开(批次 56):手机定位的精确坐标(捕获面打开时已预热,
//    盖章只读 ≤5 分钟缓存,不等 GPS);地名没来得及反查的,回填钩子异步补。
//  ② 开关关:维持保守老路 —— 天气链的城市级缓存,≤20 分钟才贴,
//    已授权过才顺手刷新,绝不在捕获路径上弹权限打断记录。
const CAPTURE_SOURCES = new Set<string>(['manual', 'voice', 'photo']);
const CAPTURE_LOC_MAX_AGE = 20 * 60_000;

let pendingLabelBackfill: ((nodeId: string) => void) | null = null;

function stampCaptureLocation(input: IngestNodeInput): IngestNodeInput {
  pendingLabelBackfill = null;
  if (typeof window === 'undefined' || !CAPTURE_SOURCES.has(input.source)) return input;
  const attrs = input.attributes || {};
  if (attrs.capturedPlace || attrs.capturedLat || attrs.location) return input; // 调用方已带位置

  if (captureLocationEnabled()) {
    const fix = getFreshCaptureFix();
    prefetchCaptureLocation(); // 保温下一条(已授权,节流内不打扰)
    if (!fix) return input;
    if (!fix.label) {
      // 坐标先落,地名反查到位后按坐标就近回填(300ms 轮询 ×10,反查慢就算了)
      pendingLabelBackfill = (nodeId: string) => {
        let tries = 0;
        const tick = () => {
          const fresh = getFreshCaptureFix(15 * 60_000);
          if (fresh?.label) {
            const node = getLifeGraph().find((n) => n.id === nodeId);
            if (node && !node.attributes.capturedPlace) {
              updateLifeNode(nodeId, { attributes: { ...node.attributes, capturedPlace: fresh.label } });
            }
            return;
          }
          if (++tries < 10) setTimeout(tick, 300);
        };
        setTimeout(tick, 300);
      };
    }
    return {
      ...input,
      attributes: {
        ...attrs,
        ...(fix.label ? { capturedPlace: fix.label } : {}),
        capturedLat: fix.lat,
        capturedLon: fix.lon,
      },
    };
  }

  const loc = loadLastLocation();
  if (loc) void refreshLocation().catch(() => {}); // 保温下一条;无缓存不主动请求权限
  if (!loc || Date.now() - loc.ts > CAPTURE_LOC_MAX_AGE) return input;
  return {
    ...input,
    attributes: { ...attrs, capturedPlace: loc.label, capturedLat: loc.lat, capturedLon: loc.lon },
  };
}

/** ⑦ 外部稳定 id:邮件 messageId / Notion pageId / 通用 externalId(如健康锻炼 startISO+活动)。
 *  用于跨同步/重导入去重(同一封邮件、同一页、同一场锻炼只一条)。 */
function externalKey(attrs: IngestNodeInput['attributes'] | undefined): string | null {
  if (!attrs) return null;
  if (typeof attrs.emailId === 'string' && attrs.emailId) return `email:${attrs.emailId}`;
  if (typeof attrs.notionPageId === 'string' && attrs.notionPageId) return `notion:${attrs.notionPageId}`;
  if (typeof attrs.externalId === 'string' && attrs.externalId) return `ext:${attrs.externalId}`;
  return null;
}

export function ingestLifeNode(input: IngestNodeInput): LifeNode {
  input = stampCaptureLocation(input);
  // 可信度盖章:旁路迁入后门也必须带 epistemic(可清数据后不再靠读时猜测)。
  const attrs = { ...(input.attributes || {}) };
  if (!isSignalEpistemic(attrs.epistemic)) {
    const stamp = stampEpistemic({
      source: input.source,
      type: typeof attrs.signalType === 'string' ? attrs.signalType : input.type,
      confidence: input.confidence,
      payload: attrs as Record<string, unknown>,
    });
    attrs.epistemic = stamp.epistemic;
    if (stamp.generator) attrs.generator = stamp.generator;
  }
  input = { ...input, attributes: attrs };
  // ⑦ 去重下沉到唯一写入口:带外部 id 的输入(Gmail/Notion 重复同步)幂等 —— 命中就原地更新,
  //   不再生成重复节点。一处修掉此前 Gmail/Notion 各自没做去重的问题。
  const key = externalKey(input.attributes);
  let node: LifeNode;
  if (key) {
    const existing = getLifeGraph().find((n) => externalKey(n.attributes) === key);
    if (existing) {
      // ⚠️ attributes 必须**合并**,不能整体替换(updateLifeNode 是顶层浅合并 →
      // patch.attributes 会整块盖掉旧的)。真机病灶 2026-07-29:Gmail 同步先用本地抽取
      // 落节点(带 date/summary/article/store/eta/amount/orderNo/trackingNo),随后的
      // 云 AI 富化 upsert 只带 AI 那几个字段 → 上述全被抹掉,日程页邮件的日期集体退回
      // createdAt(看起来"所有邮件都是今天")。新值优先,旧值补位。
      const mergedInput = { ...input, attributes: { ...existing.attributes, ...(input.attributes || {}) } };
      updateLifeNode(existing.id, mergedInput);     // 覆盖内容(id/createdAt 保留)
      node = { ...existing, ...mergedInput };       // input 无 id/createdAt → 沿用旧的
    } else {
      node = addLifeNode(input);
    }
  } else {
    node = addLifeNode(input);
  }
  // 本地事实追加已由 node-fact-sink 在 addLifeNode/updateLifeNode 写入点完成
  //(架构审查 #1:写入点收口后这里不再重复 append,只管云镜像)。
  // 批次 56:定位盖章时地名还没反查到 → 异步回填 capturedPlace
  if (pendingLabelBackfill) { pendingLabelBackfill(node.id); pendingLabelBackfill = null; }
  const signal = lifeNodeToSignal(node);
  if (signalWriteMode() === 'cloud_mirror_pending') {
    void writeCloudSignal(signal);
  }
  return node;
}
