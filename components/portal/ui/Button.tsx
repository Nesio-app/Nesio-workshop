'use client';

/**
 * Button — 全站唯一的按钮原语(2026-07-29)。
 *
 * 为什么现在才建:设计系统**早就把这个契约写下来了** ——
 * design-system/nesio/_adherence.oxlintrc.json 里躺着四条规则,
 * 规定 <Button> 只接 variant / size / tone / pill / full / disabled / iconLeft / iconRight,
 * variant 必须是 primary|secondary|soft|ghost,size 必须是 sm|md|lg,tone 必须是 brand|risk。
 * 但**代码里从来没有这个组件**,规则一直在等一个不存在的东西。
 * 于是每个板块各写各的按钮:nesio-ob-primary-btn / nesio-camera-save-btn /
 * nesio-fin-review-accept / nesio-proactive-action-btn / nesio-settings-option …
 * 至少七八套,每套自己决定圆角、字号、内边距、按下反馈。
 * 结果就是「同一屏里的两个按钮长得不像一家」——用户原话「整体都不统一」。
 * 相机那一对(存入记忆 0.5rem/0.78rem vs 重拍 0.55rem/0.8rem)就是活标本。
 *
 * 这个文件按那份既有契约落地,一个字段都不多加 —— 规则和实现从此对得上,
 * 以后新板块直接用它,不用再各起炉灶。
 *
 * 契约:scripts/button-primitive.test.mjs。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonTone = 'brand' | 'risk';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** primary=实心主行动 · secondary=描边次级 · soft=淡色底 · ghost=纯文字 */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** brand=跟随当前皮肤的强调色(默认) · risk=真实的破坏性动作(删除/清空) */
  tone?: ButtonTone;
  /** 胶囊形。默认 true —— 站内按钮基本都是胶囊,写 pill={false} 才是方角 */
  pill?: boolean;
  /** 撑满一行 */
  full?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  tone = 'brand',
  pill = true,
  full = false,
  iconLeft,
  iconRight,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'nesio-btn',
    `nesio-btn--${variant}`,
    `nesio-btn--${size}`,
    tone === 'risk' ? 'nesio-btn--risk' : '',
    pill ? 'nesio-btn--pill' : '',
    full ? 'nesio-btn--full' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    // eslint-disable-next-line react/button-has-type
    <button type={type} className={cls} {...rest}>
      {iconLeft && <span className="nesio-btn-icon" aria-hidden>{iconLeft}</span>}
      {children != null && <span className="nesio-btn-label">{children}</span>}
      {iconRight && <span className="nesio-btn-icon" aria-hidden>{iconRight}</span>}
    </button>
  );
}
