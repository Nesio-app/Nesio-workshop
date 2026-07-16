/**
 * 权限前置说明 —— 先讲「为什么」再弹系统框(上线就绪 C,批次216)。
 *
 * 系统权限框是一锤子买卖:用户第一次拒了,iOS 就再也不弹、只能去设置里手动开(多数人不会),
 * = 永久流失该能力。所以敏感权限(麦克风/相机/位置/通知)在触发系统框**之前**,先用一句
 * 大白话讲清「用来干嘛 + 你的数据怎么处理」,把同意率拉上去、把「端上=私密」卖点说出来。
 *
 * 文案自带隐私安抚(端上/不上传)—— 同时兜住 C 的「端上=私密标注」项。
 * 只解释一次(localStorage once-flag),不每次打扰;拒绝后的优雅降级由各调用点自己兜(如语音拒了退打字)。
 */
export type PermissionKind = 'microphone' | 'camera' | 'location' | 'notification';

export interface PermissionRationale {
  icon: string;
  /** [zh, en] */
  title: [string, string];
  body: [string, string];
}

const RATIONALE: Record<PermissionKind, PermissionRationale> = {
  microphone: {
    icon: '🎙️',
    title: ['用麦克风听你说', 'Microphone'],
    body: [
      '说一句,Nesio 自动整理成卡片。语音在你设备上转成文字,录音不会上传。',
      'Speak and Nesio turns it into a card. Speech is transcribed on your device — the audio is not uploaded.',
    ],
  },
  camera: {
    icon: '📷',
    title: ['用相机拍一下', 'Camera'],
    body: [
      '拍一下自动成卡。照片默认只存在你手机上,云端识别按需才用、且可关。',
      'Snap and it becomes a card. Photos stay on your device by default; cloud recognition is optional and on-demand.',
    ],
  },
  location: {
    icon: '📍',
    title: ['记忆自动带上位置', 'Location'],
    body: [
      '给你亲手记的加上「在哪记的」,方便回看。位置只存本机,不上传。',
      'Tags your notes with where you made them. Location stays on your device and is not uploaded.',
    ],
  },
  notification: {
    icon: '🔔',
    title: ['每日回顾提醒', 'Notifications'],
    body: [
      '在你选的时间轻推一条当天回顾。可随时在设置里关。',
      'A gentle daily recap at a time you choose. Turn it off anytime in settings.',
    ],
  },
};

export function permissionRationale(kind: PermissionKind): PermissionRationale {
  return RATIONALE[kind];
}

const onceKey = (k: PermissionKind): string => `nesio-perm-explained-${k}`;

/** 已给该权限做过前置说明?SSR 返回 true(不挡渲染)。 */
export function permissionExplained(kind: PermissionKind): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(onceKey(kind)) === '1';
  } catch {
    return false;
  }
}

/** 标记「已说明过」—— 之后直接走系统框,不再前置打扰。 */
export function markPermissionExplained(kind: PermissionKind): void {
  try {
    localStorage.setItem(onceKey(kind), '1');
  } catch {
    /* ignore */
  }
}

/** 该不该先解释(第一次才 true)。 */
export function shouldExplainPermission(kind: PermissionKind): boolean {
  return typeof window !== 'undefined' && !permissionExplained(kind);
}
