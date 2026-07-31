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
 * ## 2026-07-31 加 layoutStyle:迁移卡住的真原因不是「原语不够用」
 *
 * 存量 213 个裸按钮迁不动,一直说是「inline style 大半是布局,一刀切会改坏版式」。
 * 把这 213 个的 inline style 真数一遍,是**四类**,不是两类:
 *
 *   · 布局 ~173(width 60 · marginTop 42 · flex 41 · height/position/…)—— 该留在外面
 *   · 外观 ~249(color 54 · background 47 · border 43 · fontSize 39 · borderRadius 28 · …)
 *     —— 该进原语,而且**必须堵死**,否则迁移就是把 <button> 换成 <Button> 而已
 *   · 原语已经管了的 ~57(cursor 37 · opacity 20)—— 直接删。cursor 这里的 CSS 有;
 *     opacity 那 20 处大半在手搓禁用态,应该写 disabled(:disabled 已有 0.45)
 *   · 按钮**内部**排布 ~38(justifyContent 9 · textAlign 11 · display 7 · alignItems 6 · gap 5)
 *     —— 这既不是外面的布局也不是外观,是原语缺一个「行式按钮」形态。补 align 档。
 *
 * 所以出口开成普通的 `style`(或者类型是 CSSProperties 的 layoutStyle)是**没用的**:
 * 那 249 处外观会原样从新口子漏过去。这里的做法是把宽口封掉 ——
 * `style` 从 props 里 Omit 掉,只留 `layoutStyle`,而且它的类型是**布局属性的白名单**,
 * 往里写 background 是编译错误,不是靠人自觉。
 *
 * className 也是个漏口,而且**已经漏了**:MemoryNodeDetail 那 5 处写着 <Button variant="primary">,
 * 但 className="nesio-nd-action-btn" 里又把 height/padding/border-radius/font-size/font-weight
 * 全盖了一遍 —— 那是假迁移。className 保留(动画钩子/测试选择器要用),
 * 但迁移的验收标准是:**板块类名里只剩布局,外观一律交给 variant/size/tone**。
 *
 * 契约:scripts/button-primitive.test.mjs。
 */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonTone = 'brand' | 'risk';
/** 内容排布:center=居中(默认)· between=两端对齐(左文字右箭头的行式按钮)· start=左对齐 */
export type ButtonAlign = 'center' | 'between' | 'start';

/**
 * 出口的**白名单**:只有「这颗按钮在它父容器里占多大、放哪」这类属性。
 *
 * 这份名单是照着 213 个裸按钮实际在写的东西定的,不是凭空列的。
 * 想往里加字段前先问一句:**它决定的是按钮长什么样,还是按钮在哪?**
 * 长什么样的一律不加 —— 那正是这个白名单要挡住的。
 */
export type ButtonLayoutStyle = Pick<CSSProperties,
  | 'flex' | 'flexGrow' | 'flexShrink' | 'flexBasis' | 'alignSelf' | 'justifySelf' | 'order'
  | 'gridArea' | 'gridColumn' | 'gridRow'
  | 'width' | 'minWidth' | 'maxWidth' | 'height' | 'minHeight' | 'maxHeight'
  | 'margin' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight'
  | 'marginBlock' | 'marginBlockStart' | 'marginBlockEnd' | 'marginInline' | 'marginInlineStart' | 'marginInlineEnd'
  | 'position' | 'top' | 'right' | 'bottom' | 'left' | 'inset' | 'zIndex'
>;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'style'> {
  /** primary=实心主行动 · secondary=描边次级 · soft=淡色底 · ghost=纯文字 */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** brand=跟随当前皮肤的强调色(默认) · risk=真实的破坏性动作(删除/清空) */
  tone?: ButtonTone;
  /** 胶囊形。默认 true —— 站内按钮基本都是胶囊,写 pill={false} 才是方角 */
  pill?: boolean;
  /** 撑满一行 */
  full?: boolean;
  /** 内容排布。默认 center;between 是「左文字右箭头」那种行式按钮 */
  align?: ButtonAlign;
  /**
   * **只放布局**:这颗按钮在父容器里占多大、放哪。
   *
   * 类型是白名单(见 ButtonLayoutStyle),写 background/color/fontSize 会**编译不过** ——
   * 那些走 variant/size/tone。这不是不信任调用方,是这个口子如果什么都能塞,
   * 迁移就等于把 <button> 改名叫 <Button>,213 个裸按钮的问题一个都没解决。
   */
  layoutStyle?: ButtonLayoutStyle;
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
  align = 'center',
  layoutStyle,
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
    align !== 'center' ? `nesio-btn--align-${align}` : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    // eslint-disable-next-line react/button-has-type
    <button type={type} className={cls} style={layoutStyle} {...rest}>
      {iconLeft && <span className="nesio-btn-icon" aria-hidden>{iconLeft}</span>}
      {children != null && <span className="nesio-btn-label">{children}</span>}
      {iconRight && <span className="nesio-btn-icon" aria-hidden>{iconRight}</span>}
    </button>
  );
}
