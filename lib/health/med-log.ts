/**
 * med-log — 「今天这药吃了没」的打卡记录(健康镜头 A 屏,2026-07-29)。
 *
 * 为什么单独一个文件而不是塞进 Signal:
 * `health.med` 是**一种药**(名字/剂量/频次/起始日),一条就够。而「今天吃了」是**每天一条**,
 * 一年 365 条 × N 种药 —— 全写成 Signal 会把主事实表和记忆时间线灌满没有信息量的打卡。
 * 这类高频、可丢、只服务一个卡片的状态,该待在一个小 store 里。
 *
 * 落点:localStorage `nesio-med-*`。`nesio-` 前缀的 key 默认算 durable,
 * 登出/换号/删除全部三处的 purgeLocalData 自动覆盖(见 storage-manifest),不用额外接线。
 * 只留最近 60 天 —— 再往前没人看,留着只是占配额。
 *
 * 写失败不吞:用户点了「吃过了」,配额满没存上必须看得见(红线)。
 */

import { reportStorageDropped } from '@/lib/portal/storage-health';

const KEY = 'nesio-med-log-v1';
export const MED_LOG_EVENT = 'nesio-med-log-updated';
const KEEP_DAYS = 60;

/** { '2026-07-29': ['二甲双胍', '维生素D'] } */
type MedLog = Record<string, string[]>;

export function todayYmd(now = new Date()): string {
  return now.toLocaleDateString('en-CA'); // YYYY-MM-DD,本地日期(别用 toISOString,那是 UTC)
}

function load(): MedLog {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as MedLog) : {};
  } catch { return {}; }
}

/** 只留最近 KEEP_DAYS 天。纯函数,可单测。 */
export function prune(log: MedLog, today = todayYmd()): MedLog {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const min = cutoff.toLocaleDateString('en-CA');
  const out: MedLog = {};
  for (const [day, names] of Object.entries(log)) {
    if (day >= min && Array.isArray(names) && names.length) out[day] = names;
  }
  return out;
}

function save(log: MedLog): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(prune(log)));
    window.dispatchEvent(new CustomEvent(MED_LOG_EVENT));
    return true;
  } catch {
    // 红线:存不下要看得见,不许点完「吃过了」界面打个勾然后数据没了。
    reportStorageDropped();
    return false;
  }
}

/** 归一药名 —— 「二甲双胍 」和「二甲双胍」是同一种药。 */
export const medKey = (name: string): string => name.trim().toLowerCase();

export function isMedTaken(name: string, day = todayYmd()): boolean {
  return (load()[day] || []).includes(medKey(name));
}

/** 打勾 / 撤销。返回是否真的写进去了 —— 调用方据此决定要不要显示失败。 */
export function setMedTaken(name: string, taken: boolean, day = todayYmd()): boolean {
  const k = medKey(name);
  if (!k) return false;
  const log = load();
  const cur = new Set(log[day] || []);
  if (taken) cur.add(k); else cur.delete(k);
  if (cur.size) log[day] = Array.from(cur); else delete log[day];
  return save(log);
}

/** 今天已服几种(给卡片标题用)。 */
export function takenCount(names: string[], day = todayYmd()): number {
  const done = new Set(load()[day] || []);
  return names.filter((n) => done.has(medKey(n))).length;
}
