/**
 * image-understand —— 全站取图的**唯一一条路**(2026-07-31)。
 *
 * ## 为什么要有这么一层
 *
 * 全仓有 24 个取图入口。它们各自决定「这张图要不要识别、怎么识别」,结果是三种病同时存在:
 *
 *   · **只存不识别**:财务给交易挂发票、记忆详情附照片、见面记录贴图 —— 图存下来了,
 *     上面写的金额日期一个字都没进系统。用户以为「附上去了就记下了」。
 *   · **顺序反了**:相机是先把图发去云,等云读完再用关键词判「哦这是张小票」
 *     (`CameraSheet` 的 `detectReceipt(res)`)。而那些关键词本来就印在图上,
 *     端上认一遍字就知道,根本不用先发出去。
 *   · **判据散在各处**:每个入口自己写一遍「什么算小票」。
 *
 * ## 这一层的规矩
 *
 * ① **先端上认字**。免费、离线、图一个字节不出手机。
 * ② **图上的字够用就不打云**。小票/订单/化验单的信息**就是**那些字 ——
 *    发去云让大模型再读一遍,是把确定性的事交给会猜的东西,还慢、还贵、还把票据发出门。
 * ③ **要看懂图才打云**。「这是一件深蓝羊毛大衣」「桌上那支笔」—— 衣服上没写着自己是什么,
 *    这类只能云。端上 OCR 一个字也答不了。
 * ④ **每条走不通都要说得出是哪条**。「这台设备认不了字」「认出字了但不像单据」
 *    「云没连上」是三件事,混成一句「识别失败」用户就不知道下一步该干嘛。
 *
 * ## workshop 不设付费门
 *
 * 产品仓(nesio)里云识图在付费门后面 —— 那是产品红线。**workshop 不分收费免费**
 * (2026-07-31 决定):这里是自己用的实验仓,该识别的就识别,不为分层牺牲可用性。
 * 所以这个模块**不查 `canUsePaidCloudAi()`**。往 prod 搬的时候要把门加回去 ——
 * 这句写在这里,免得搬的人以为门是漏掉的。
 */

import { extractReceiptFields, type ReceiptFields } from './receipt-extract';
import { visionAvailability, recognizeOnDevice, unavailableMessage, type VisionUnavailableReason } from '@/lib/native/vision';
import { logDropped } from './storage-health';

/** 图上那些字，看着像什么。 */
export type ImageKind =
  | 'receipt'    // 小票/收据/发票 —— 金额+日期+商家都在字里
  | 'order'      // 网购订单截图 —— 单号/小计/税/卖家
  | 'lab'        // 化验单
  | 'text'       // 有字，但不像上面任何一种(菜单、书页、名片、截图)
  | 'unknown';   // 没认出字，或这台设备认不了字

/**
 * 判据只此一份。以前散在 `CameraSheet.RECEIPT_KEYWORDS`,而且是拿**云返回的结果**
 * 去匹配 —— 等于先把图发出去才知道它是张小票。现在对着端上认出来的原文判,顺序才是对的。
 */
const KIND_HINTS: Array<[ImageKind, RegExp]> = [
  ['order', /(订单号|order\s*#|order\s*number|sold\s*by|配送至|运单|tracking\s*number)/i],
  ['receipt', /(小票|收据|receipt|发票|结账|合计|总计|subtotal|total|收银|门店|thank\s*you\s*for\s*shopping)/i],
  ['lab', /(检验|化验|参考区间|reference\s*range|生化|血常规|specimen|hba1c|mmol\/l|g\/l)/i],
];

export function classifyImageText(text: string): ImageKind {
  if (!text || !text.trim()) return 'unknown';
  for (const [kind, re] of KIND_HINTS) if (re.test(text)) return kind;
  return 'text';
}

export interface UnderstandResult {
  /** 端上认出来的字。空 = 没认出/认不了。 */
  text: string;
  kind: ImageKind;
  /** 端上认字为什么没成 —— 有值时 text 一定是空的。 */
  visionReason?: VisionUnavailableReason | 'failed' | 'timeout';
  /** 这台设备认不了字时,给用户看的那句人话。 */
  visionMessage?: string;
  /** 图是单据时,从字里抽出来的结构化字段。 */
  fields?: ReceiptFields;
  /**
   * 云还有没有必要跑。
   * 单据类为 false —— 信息已经拿全了,再发一趟是把确定性的事交给会猜的东西。
   */
  needsCloud: boolean;
}

/**
 * 取图的第一步,**所有入口都先过这里**。
 *
 * 不抛异常:端上认不了字是常态(浏览器、老设备、没带插件的构建),
 * 那不是错误,是「这条路今天走不通」,调用方据此决定要不要打云。
 */
export async function understandImage(image: Blob | string): Promise<UnderstandResult> {
  let avail: { available: boolean; reason?: VisionUnavailableReason };
  try {
    avail = await visionAvailability();
  } catch (err) {
    logDropped('image-understand.availability', err);
    avail = { available: false, reason: 'plugin_missing' };
  }

  if (!avail.available) {
    // 端上没有 → 图上有没有字都无从知道,只能交给云去看懂。
    return {
      text: '', kind: 'unknown', needsCloud: true,
      visionReason: avail.reason,
      visionMessage: unavailableMessage(avail.reason),
    };
  }

  const r = await recognizeOnDevice(image);
  if (!r.ok) {
    return { text: '', kind: 'unknown', needsCloud: true, visionReason: r.reason, visionMessage: r.message };
  }

  const kind = classifyImageText(r.text);
  const fields = (kind === 'receipt' || kind === 'order') ? (extractReceiptFields(r.text) ?? undefined) : undefined;

  // 单据 + 真抽到了金额 → 不打云。抽不到金额说明这张认得不全,还是让云看一眼。
  const needsCloud = !((kind === 'receipt' || kind === 'order') && !!fields);

  return { text: r.text, kind, fields, needsCloud };
}

/**
 * 已经存好的一条记忆,把图上的字补进去。**「只存不识别」那批入口统一走这个。**
 *
 * 为什么是「已经存好之后」而不是「存之前」:存必须先成功。识别是加分项 ——
 * 认不出来东西照样在,认出来了就更好找。倒过来做的话,识别一慢一失败,
 * 用户点了保存却什么都没发生。
 *
 * 为什么收一个函数而不是每个面各写一遍:全仓有 20 多个取图入口,
 * 各写一遍的结果就是现在这样 —— 有的认、有的不认、认的那几个判据还各不相同。
 *
 * 多张图**每张都认**:端上不花钱、不出门,没有只认第一张的理由。
 *
 * @returns 认出来的字(空 = 没认出/这台设备认不了),调用方可据此决定要不要再打云。
 */
export async function attachImageUnderstanding(
  nodeId: string,
  images: ReadonlyArray<Blob | string>,
  opts: { keepName?: boolean } = {},
): Promise<UnderstandResult | null> {
  if (typeof window === 'undefined' || !images.length) return null;
  try {
    const all: UnderstandResult[] = [];
    for (const img of images) all.push(await understandImage(img));
    const text = all.map((s) => s.text).filter(Boolean).join('\n\n');
    // 字段以第一张为准 —— 一次传进来的多张图是**同一条**记忆的附件,
    // 不是几张各自独立的小票。真要分开记,那是分开传。
    const head = all.find((s) => s.fields) ?? all[0];
    if (!text.trim()) return head;

    const { updateLifeNode, getLifeGraph } = await import('./life-graph');
    const node = getLifeGraph().find((n) => n.id === nodeId);
    if (!node) return head;

    const patch: Parameters<typeof updateLifeNode>[1] = {
      // 原文进 rawInput —— 本地检索扫的就是这里。已经有正文的不覆盖(那是用户写的)。
      rawInput: node.rawInput?.trim() ? `${node.rawInput}\n\n${text}`.slice(0, 8000) : text.slice(0, 8000),
      tags: Array.from(new Set([...(node.tags ?? []), ...tagsFromText(text, 5)])).slice(0, 8),
    };
    if (head.fields) {
      const f = head.fields;
      patch.attributes = {
        ...node.attributes,
        price: f.amount,
        ...(f.date ? { receiptDate: f.date } : {}),
        ...(f.merchant ? { store: f.merchant } : {}),
        ocrSource: 'on-device',
      };
      // 名字还是文件名/占位("IMG_9740"、"照片 · 7月31日")时才改 —— 用户自己起的名不动。
      if (!opts.keepName && f.merchant && /^(IMG[_-]?\d+|PXL[_-]?\d+|DSC\d+|image|photo|照片)/i.test(node.name.trim())) {
        patch.name = f.merchant;
      }
    }
    updateLifeNode(nodeId, patch);
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    return head;
  } catch {
    // 认不出来不影响已经存好的东西 —— 这是加分项,不是主流程。
    return null;
  }
}

/**
 * 把认出来的字变成检索标签 —— 让「只存图」的那些地方也能被搜到。
 *
 * 只取**看起来像名字的短词**:纯数字、单字、超长串都扔掉。
 * 这里不猜语义(那是云的事),只是让图上写着的东西能被搜出来。
 */
export function tagsFromText(text: string, max = 8): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,，、。;；:：|/\\()（）\[\]【】"'`]+/)) {
    const w = raw.trim();
    if (w.length < 2 || w.length > 12) continue;
    if (/^[\d.,%$¥￥+-]+$/.test(w)) continue;      // 纯数字/金额:留在 fields 里,不当标签
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}
