/**
 * tesla-charge-copy —— 车的充电状态该怎么说(2026-07-30 真机,bug #11)。
 *
 * 现场,同一屏里三句话互相打架:
 *   「电量 59% · 未插枪」   ← 没插枪
 *   「本次已充 27.2 kWh」   ← 那这 27.2 度是怎么进去的?
 *   「还没有充电记录 —— 下次充电后这里就有了」  ← 上面刚说充了 27.2 度
 *
 * 两处根因都是「拿到什么就印什么」:
 *   ① `charge_energy_added` 这个字段在**断枪之后仍然保留上一段的读数**。
 *      面板不问状态就冠上「本次」,于是一个历史数字被说成正在发生的事。
 *      「本次」这个词是有前提的 —— 得真的在这一段里。
 *   ② 「还没有充电记录」的判据是 `history.length === 0`,而 history 只收
 *      **没有电量字段的历史行**;那条带电量的实时行根本不在里面。
 *      于是「有数据」和「没记录」可以同时为真。空态的判据必须是
 *      「**这一屏上一个充电数字都没有**」,不是「我这个数组是空的」。
 *
 * 纯函数,不碰网络、不碰 DOM。
 */

/** Tesla 的 charging_state 原值(其余值一律当未知)。 */
export type ChargingState = 'Charging' | 'Complete' | 'Stopped' | 'Disconnected' | 'NoPower' | 'Starting' | string;

export interface ChargeLine {
  /** 这句话说的是**正在发生**的事吗(false = 说的是上一段)。 */
  live: boolean;
  zh: string;
  en: string;
}

/** 插着枪、这一段还算「现在进行时」的状态。「本次」只能用在这几种上。 */
const IN_SESSION = new Set(['Charging', 'Starting', 'Complete', 'Stopped']);

export function isInSession(state?: ChargingState): boolean {
  return !!state && IN_SESSION.has(state);
}

/**
 * 「已充 X kWh」这句话怎么说。kwh 为 0/空 → 返回 null(没数就别硬凑一句)。
 *
 * 断枪(Disconnected / NoPower / 未知)时,这个读数说的是**上一段** —— 只能说「上次」。
 * 这不是措辞讲究:说成「本次」就等于告诉用户车正在充电,而屏幕上明写着未插枪。
 */
export function chargeEnergyLine(state: ChargingState | undefined, kwh: number | null | undefined): ChargeLine | null {
  if (kwh == null || !Number.isFinite(kwh) || kwh <= 0) return null;
  const n = Math.round(kwh * 10) / 10;
  if (state === 'Charging' || state === 'Starting') {
    return { live: true, zh: `本次已充 ${n} kWh`, en: `+${n} kWh this session` };
  }
  if (state === 'Complete') {
    return { live: true, zh: `这次充进 ${n} kWh`, en: `+${n} kWh this session` };
  }
  if (state === 'Stopped') {
    return { live: true, zh: `这次充到 ${n} kWh 停了`, en: `stopped at +${n} kWh` };
  }
  // 断枪 / 没电源 / 状态未知 —— 车上留着的是上一段的读数
  return { live: false, zh: `上次充了 ${n} kWh`, en: `${n} kWh last session` };
}

/**
 * 「还没有充电记录」这句话能不能说。
 *
 * 正向判据:**这一屏上一个充电数字都没有**,才叫没记录。
 * 只看历史数组是否为空,就会出现「上面写着 27.2 kWh、下面写着还没有记录」。
 */
export function hasAnyChargeRecord(historyCount: number, liveEnergyKwh: Array<number | null | undefined>): boolean {
  if (historyCount > 0) return true;
  return liveEnergyKwh.some((v) => v != null && Number.isFinite(v) && v > 0);
}
