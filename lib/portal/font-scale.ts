/**
 * 全局字体大小 —— 缩放根字号(html font-size)。
 * 全站字号/间距/圆角皆 rem,故缩放根字号 = 整体等比放大(像系统「更大字体」)。
 * 百分比是相对浏览器默认(通常 16px,且跟随系统无障碍设置)—— 100% = 跟随系统。
 * 开机由 layout.tsx 的内联脚本先应用(防闪),此模块供设置里改。
 */

export type FontScale = 'sm' | 'md' | 'lg' | 'xl';

export const FONT_SCALE_KEY = 'nesio-font-scale-v1';

/** 各档对应的根字号百分比(相对浏览器默认)。 */
export const FONT_SCALE_PCT: Record<FontScale, string> = {
  sm: '93.75%', // ~15px
  md: '100%', // 标准 = 跟随系统
  lg: '112.5%', // ~18px
  xl: '125%', // ~20px
};

export function getFontScale(): FontScale {
  if (typeof localStorage === 'undefined') return 'md';
  const v = localStorage.getItem(FONT_SCALE_KEY);
  return v === 'sm' || v === 'lg' || v === 'xl' ? v : 'md';
}

/** 立即把某档应用到 <html>,并持久化。返回是否保存成功(存储满时仍即时生效)。 */
export function applyFontScale(scale: FontScale): boolean {
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = FONT_SCALE_PCT[scale];
  }
  try {
    localStorage.setItem(FONT_SCALE_KEY, scale);
    return true;
  } catch {
    return false; // 存储满:这次不落盘,但视觉已生效
  }
}
