/**
 * spotlight —— 把记忆索引进 iOS 系统搜索(桌面下拉那个)。
 *
 * 对面是 Capacitor 插件 `Spotlight`
 * (treasurebox-ios/.../NesioSpotlightPlugin.swift,Core Spotlight)。
 *
 * ## 为什么值得做
 *
 * 这是个记忆库。「我那张化验单呢」「上次那家店叫什么」——
 * 人会**先在系统搜索里打字**,而不是先想起要开哪个 App。
 * 索引进去之后从桌面下拉直接搜到,点进来 deep link 到那条记忆。
 *
 * ## 隐私:这里是**默认关**的,而且默认不收正文
 *
 * 索引进 Spotlight 的内容会离开这个 App 的沙箱交给系统搜索库。
 * 它不上传,但**锁屏搜索、Siri 建议都可能显示出来** —— 手机借人一看就看见了。
 *
 * 所以定了三条:
 *   ① 默认关。用户在设置里主动打开才索引。
 *   ② 只送**标题**,不送正文。标题是「体检报告」这种,正文才是指标值。
 *      想让正文也能搜到是另一个决定,那时再单独问一次。
 *   ③ 敏感类型一律不索引(见 `SENSITIVE_KINDS`),开了开关也不索引。
 *      化验单、财务附件这类,搜得到的收益远小于被人瞟到的代价。
 *   ④ 关掉开关必须**真的清干净**(`clearSpotlightIndex`)。
 *      关了开关但索引还在,是最坏的一种:用户以为清了,锁屏还搜得到。
 */

import { logDropped } from '@/lib/portal/storage-health';

/** 开关。默认关 —— 这条 key 不在就是关。 */
export const SPOTLIGHT_ENABLED_KEY = 'nesio-spotlight-enabled-v1';

/**
 * 打死不索引的类型。开了开关也不索引。
 *
 * 判准是「被别人瞟见这一条的标题,会不会让人难受」——
 * 化验单、诊断、账单、证件都会。
 */
const SENSITIVE_KINDS = new Set(['lab', 'clinical', 'health', 'finance', 'document', 'credential']);

export interface SpotlightItem {
  id: string;
  title: string;
  /** 秒/毫秒都行(会归一到毫秒)。系统按它排「最近」。 */
  date?: number;
  kind?: string;
}

interface SpotlightPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  indexItems(o: { items: Array<{ id: string; title: string; date?: number }> }): Promise<{ ok?: boolean; indexed?: number; reason?: string }>;
  removeItems(o: { ids: string[] }): Promise<{ ok?: boolean; removed?: number; reason?: string }>;
  removeAll(): Promise<{ ok?: boolean; reason?: string }>;
}

function plugin(): SpotlightPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = cap?.Plugins?.Spotlight;
  return p ? (p as unknown as SpotlightPlugin) : null;
}

export function isSpotlightEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SPOTLIGHT_ENABLED_KEY) === '1';
}

/** 这台设备/这版壳支不支持。UI 用它决定摆不摆那个开关。 */
export async function spotlightAvailability(): Promise<{ available: boolean; reason?: string }> {
  const p = plugin();
  if (!p) return { available: false, reason: 'plugin_missing' };
  try {
    const r = await p.isAvailable();
    return { available: Boolean(r?.available), reason: r?.reason };
  } catch (err) {
    logDropped('spotlight.is_available', err);
    return { available: false, reason: 'plugin_missing' };
  }
}

/**
 * 把一批记忆推进系统索引。**同 id 覆盖**,所以可以放心全量重推。
 *
 * 开关没开 / 插件没有 → 直接返回 0,不报错(这是个可有可无的增强,
 * 不该在任何路径上挡住别的事)。
 */
export async function indexMemoriesToSpotlight(items: readonly SpotlightItem[]): Promise<number> {
  if (!isSpotlightEnabled()) return 0;
  const p = plugin();
  if (!p) return 0;

  const safe = items
    .filter((it) => it.id && it.title && !SENSITIVE_KINDS.has(it.kind || ''))
    .map((it) => ({
      id: it.id,
      title: it.title,
      // 只送标题,不送正文 —— 见文件头 ②。
      date: it.date ? (it.date < 1e12 ? it.date * 1000 : it.date) : undefined,
    }));
  if (!safe.length) return 0;

  try {
    const r = await p.indexItems({ items: safe });
    return r?.ok ? (r.indexed ?? safe.length) : 0;
  } catch (err) {
    logDropped('spotlight.index', err);
    return 0;
  }
}

/** 删掉某条记忆时同步把索引撤了 —— 不然搜出来点进去是空的。 */
export async function removeFromSpotlight(ids: readonly string[]): Promise<void> {
  const p = plugin();
  if (!p || !ids.length) return;
  try { await p.removeItems({ ids: [...ids] }); }
  catch (err) { logDropped('spotlight.remove', err); }
}

/**
 * 清空索引。**关开关时必须调**,而且要等它真的回来 ——
 * 见文件头 ④:关了开关索引还在,比没做这个功能更糟。
 */
export async function clearSpotlightIndex(): Promise<{ ok: boolean; reason?: string }> {
  const p = plugin();
  if (!p) return { ok: true };   // 没插件 = 从来没索引过,已经是干净的
  try {
    const r = await p.removeAll();
    return r?.ok ? { ok: true } : { ok: false, reason: r?.reason || 'remove_failed' };
  } catch (err) {
    logDropped('spotlight.clear', err);
    return { ok: false, reason: 'remove_failed' };
  }
}

/** 开/关开关。**关的时候一定连带清索引** —— 这是这个函数存在的全部理由。 */
export async function setSpotlightEnabled(on: boolean): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (typeof localStorage !== 'undefined') {
      if (on) localStorage.setItem(SPOTLIGHT_ENABLED_KEY, '1');
      else localStorage.removeItem(SPOTLIGHT_ENABLED_KEY);
    }
  } catch (err) {
    logDropped('spotlight.toggle', err);
    return { ok: false, reason: 'storage_failed' };
  }
  if (!on) return clearSpotlightIndex();
  return { ok: true };
}
