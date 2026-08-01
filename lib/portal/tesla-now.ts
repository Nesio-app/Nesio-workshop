/**
 * 车的「此刻」怎么说(2026-08-01,用户:「如果能做成图 3 和 4 就好」)。
 *
 * 图 3/4 是 Tesla 官方拿 Fleet API 做的**车队**看板:地图上一堆车、
 * 79 辆车的电量分布环形图、按车型分的告警柱状图。这里要的是同一种信息密度,
 * 但对象只有一辆车 —— 所以不是照搬,是转译:
 *
 *   · 车队的「状态分布环」→ 一辆车的**一个明确状态**(在开 / 在充 / 停着 / 联系不上);
 *   · 车队的「告警柱状图」→ 这一辆的胎压、待装更新、锁没锁;
 *   · 车队卡片上的「4 mins, 44s ago」→ **这份读数多旧**。
 *
 * 最后那条是这个文件存在的主要理由。Tesla 的 `drive_state.timestamp` 是**车上**
 * 那份读数的时刻,和我们问它的时刻是两回事:车深度休眠时能差好几个小时。
 * 界面若把它当成此刻,就会出现「电量 44%」这样一个看起来是实时、实际是昨晚的数字 ——
 * 而用户会照着它决定要不要现在出门。**一个旧数字被摆成新的,比没有数字更危险。**
 */

export type VehicleStatus = 'driving' | 'charging' | 'parked' | 'stale';

export interface StatusInput {
  shiftState?: string;
  chargingState?: string;
  /** 车上那份读数的时刻(毫秒)。null = 不知道。 */
  dataAgeMs?: number | null;
}

/** 超过这么久没上报,就不再说「停放中」而说「联系不上」。 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * 这辆车现在算什么状态。
 *
 * 顺序是有讲究的:
 *  ① **太旧的先出局**。一份 8 小时前的读数说「停放中」听起来像是此刻确认过的,
 *     而真相是我们根本不知道它现在在哪。这一条排最前面。
 *  ② **在充优先于停着**。正在充电的车当然也是停着的,但用户点开这一页时
 *     想知道的是「充到哪了」,不是「它停着」。
 *  ③ 在开(D/R)。
 */
export function vehicleStatus(input: StatusInput, now = Date.now()): VehicleStatus {
  const ts = Number(input.dataAgeMs);
  if (Number.isFinite(ts) && ts > 0 && now - ts > STALE_AFTER_MS) return 'stale';
  const shift = String(input.shiftState || '').toUpperCase();
  const charging = String(input.chargingState || '').toLowerCase();
  if (charging === 'charging') return 'charging';
  if (shift === 'D' || shift === 'R') return 'driving';
  return 'parked';
}

export function statusLabel(s: VehicleStatus, zh: boolean): string {
  if (s === 'driving') return zh ? '在路上' : 'Driving';
  if (s === 'charging') return zh ? '充电中' : 'Charging';
  if (s === 'stale') return zh ? '联系不上' : 'Out of touch';
  return zh ? '停放中' : 'Parked';
}

/** 图 3 图例那三色。stale 用「温和」而不是「风险」—— 车联系不上不是故障,是它在睡觉。 */
export function statusTone(s: VehicleStatus): 'go' | 'calm' | 'gentle' {
  if (s === 'driving') return 'go';
  if (s === 'charging') return 'calm';
  if (s === 'stale') return 'gentle';
  return 'calm';
}

/**
 * 这份读数多旧。图 3 卡片右下角那行「4 mins, 44s ago」。
 *
 * **不知道就说不知道**:`dataAgeMs` 为空时返回「不知道是什么时候的读数」,
 * 而不是默认「刚刚」。默认成「刚刚」是这一屏最容易犯、也最贵的错 ——
 * 一个昨晚的电量被说成此刻,用户会照着它决定要不要出门。
 */
export function dataAgeLine(dataAgeMs: number | null | undefined, zh: boolean, now = Date.now()): string {
  const ts = Number(dataAgeMs);
  if (!Number.isFinite(ts) || ts <= 0) {
    return zh ? '不知道是什么时候的读数' : 'Reading time unknown';
  }
  const sec = Math.round((now - ts) / 1000);
  // **负数(车机时钟走到了未来)也落进这一支** —— 这就是不写 Math.max(0, …) 的理由:
  // 那一句在这里是死代码,`sec < 90` 已经把所有负值收走了。留着它只会让人
  // 以为负数是被单独特判过的。要防的是「-10 分钟前的读数」这种话出现在屏幕上。
  if (sec < 90) return zh ? '刚刚更新' : 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return zh ? `${min} 分钟前的读数` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return zh ? `${hr} 小时前的读数` : `${hr} h ago`;
  const day = Math.round(hr / 24);
  return zh ? `${day} 天前的读数` : `${day} d ago`;
}

/* ── 充电那一行 ───────────────────────────────────────────────────────────── */

export interface ChargeInput {
  chargingState?: string;
  chargerPowerKw?: number | null;
  minutesToFull?: number | null;
  chargeLimitPct?: number | null;
  batteryLevel?: number | null;
}

/**
 * 「正在充 11 kW · 还要 45 分钟到 80%」。没在充就返回空串 ——
 * 不在充的时候说「0 kW」是一句噪音。
 */
export function chargeNowLine(c: ChargeInput, zh: boolean): string {
  if (String(c.chargingState || '').toLowerCase() !== 'charging') return '';
  const parts: string[] = [];
  const kw = Number(c.chargerPowerKw);
  if (Number.isFinite(kw) && kw > 0) parts.push(zh ? `正在充 ${Math.round(kw)} kW` : `Charging at ${Math.round(kw)} kW`);
  else parts.push(zh ? '正在充电' : 'Charging');

  const mins = Number(c.minutesToFull);
  const limit = Number(c.chargeLimitPct);
  if (Number.isFinite(mins) && mins > 0) {
    const target = Number.isFinite(limit) && limit > 0 ? `${Math.round(limit)}%` : (zh ? '充满' : 'full');
    const t = mins >= 60
      ? (zh ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
      : (zh ? `${Math.round(mins)} 分钟` : `${Math.round(mins)} min`);
    parts.push(zh ? `还要 ${t} 到 ${target}` : `${t} to ${target}`);
  }
  return parts.join(' · ');
}

/**
 * 「还能开 180 mi」。电量百分比回答不了「够不够到那儿」——
 * 充电上限不是 100% 时尤其如此(80% 上限下的 44% 和 100% 上限下的 44% 差得远)。
 */
export function rangeLine(rangeMi: number | null | undefined, zh: boolean): string {
  const mi = Number(rangeMi);
  if (!Number.isFinite(mi) || mi <= 0) return '';
  return zh ? `还能开约 ${Math.round(mi)} mi` : `~${Math.round(mi)} mi of range`;
}

/* ── 车况(图 4 的单车转译)─────────────────────────────────────────────────── */

export interface HealthInput {
  tirePsi?: { fl: number | null; fr: number | null; rl: number | null; rr: number | null };
  tireSoftWarning?: boolean;
  softwareUpdate?: string;
  carVersion?: string;
  locked?: boolean | null;
  sentryMode?: boolean | null;
}

export interface HealthItem {
  key: string;
  label: string;
  value: string;
  /** 'gentle' = 有件小事可以处理(不用红色制造焦虑);'calm' = 只是陈述。 */
  tone: 'calm' | 'gentle';
}

/**
 * 车况清单。**取不到的项一律不显示** —— 一行「胎压:—」不是信息,
 * 它只是把「我们没拿到」伪装成一条数据。
 *
 * 全都取不到时返回空数组,由界面决定说什么(而不是在这里编一句)。
 */
export function healthItems(h: HealthInput | null | undefined, zh: boolean): HealthItem[] {
  if (!h) return [];
  const out: HealthItem[] = [];

  const psi = [h.tirePsi?.fl, h.tirePsi?.fr, h.tirePsi?.rl, h.tirePsi?.rr]
    .map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  if (psi.length) {
    const lo = Math.min(...psi);
    const hi = Math.max(...psi);
    out.push({
      key: 'tires',
      label: zh ? '胎压' : 'Tire pressure',
      value: lo === hi ? `${lo} psi` : `${lo}–${hi} psi`,
      // 车自己报了低压警告才算「有件事可以处理」。我们**不自己定阈值** ——
      // 不同车型/胎的正常范围不一样,拿一个猜来的数字判「偏低」会一直误报。
      tone: h.tireSoftWarning ? 'gentle' : 'calm',
    });
  }
  if (h.softwareUpdate) {
    out.push({
      key: 'software',
      label: zh ? '有新版本' : 'Update ready',
      value: h.softwareUpdate,
      tone: 'gentle',
    });
  } else if (h.carVersion) {
    out.push({ key: 'software', label: zh ? '车机版本' : 'Software', value: h.carVersion, tone: 'calm' });
  }
  if (h.locked != null) {
    out.push({
      key: 'locked',
      label: zh ? '车门' : 'Doors',
      value: h.locked ? (zh ? '已锁' : 'Locked') : (zh ? '没锁' : 'Unlocked'),
      tone: h.locked ? 'calm' : 'gentle',
    });
  }
  if (h.sentryMode != null) {
    out.push({
      key: 'sentry',
      label: zh ? '哨兵模式' : 'Sentry',
      value: h.sentryMode ? (zh ? '开着' : 'On') : (zh ? '关着' : 'Off'),
      tone: 'calm',
    });
  }
  return out;
}
