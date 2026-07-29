'use client';

/**
 * NesioSheet — 全仓 sheet/modal 的唯一容器原语(NesioSheet 施工单 W0)。
 *
 * 铁律:只换壳,不动内容。把每个 sheet 的 overlay/backdrop/panel 三件套
 * 换成本原语,业务逻辑/布局/文案零改动。
 *
 * 一次做对、28 处白拿的内置行为:
 *  - focus-trap + 开启焦点入 sheet、关闭归还触发器 —— 由原语自持的
 *    useFocusTrap 实现(实测 Vaul 1.x / Radix 在 React19+Next16+Turbopack
 *    下焦点管理均不可靠,故不赌库内部,自己兜死;更稳、与库版本无关)。
 *  - Esc 一律可关;dismissible=false 时拦 Esc/点外关(内容仍须有显式退出按钮)
 *  - 背景滚动锁(Vaul / react-remove-scroll)
 *  - aria-modal / role=dialog 真实成立(不再自写「撒谎」)
 *  - variant=bottom 拖拽关闭 + 释放速度投影(Vaul 手势)
 *  - 三档降级:prefers-reduced-motion(安静模式=B 跟随系统)/ reduced-transparency
 *    / contrast —— 全在 globals.css 的 .nesio-sheet-* 里做
 *
 * 底座(施工单决策点一 = 路线 A):bottom→Vaul(手势/弹簧),
 * center/fullscreen→Radix Dialog(portal/Esc/scroll-lock)。焦点两边都用自持 trap。
 */

import { Drawer } from 'vaul';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

export type NesioSheetVariant = 'bottom' | 'center' | 'fullscreen';

export interface NesioSheetProps {
  variant?: NesioSheetVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 可拖拽/点遮罩/Esc 关。流程强制型设 false(内容里仍必须有显式退出按钮)。 */
  dismissible?: boolean;
  /** 无障碍标题:sheet 必有可读名。渲染成 sr-only 的 Title,满足 aria。 */
  ariaLabel: string;
  /** 同帧律挂点:视觉提交那一帧触发触感/音效。内容在 commit 时调用。 */
  onCommit?: () => void;
  /** 附加到 panel 的类名(迁移期用来保留个别 sheet 的既有布局类)。 */
  className?: string;
  /** 附加到 panel 的内联样式(迁移期用来保留个别 sheet 挂在根节点的 CSS 变量等)。 */
  style?: CSSProperties;
  /**
   * center/fullscreen:是否走 Radix modal(react-remove-scroll 锁背景滚动 + 渲染遮罩)。
   * 默认 true。**canvas/手势型全屏面板(地图 pinch、地球旋转)必须传 false** ——
   * react-remove-scroll 会用非被动 touchmove/wheel + preventDefault 拦截手势,把双指
   * 缩放/旋转废掉。这类面板自带不透明底,不需要遮罩底衬。焦点仍靠自持 trap,Esc 仍生效。
   */
  modal?: boolean;
  /**
   * 是否由原语渲染标准卡片壳(面/圆角/内边距/阴影)。默认 true。
   * 迁移期若 sheet 自带定制卡片(尺寸/圆角/背景独特),传 false ——
   * 原语只接管定位/遮罩/焦点机器,卡片视觉保持原样(零视觉回归)。
   */
  card?: boolean;
  /**
   * center/fullscreen:遮罩是否不透明(挡住背后内容)。默认 fullscreen 才不透明。
   * 隐私强制型弹窗(如「换账号」归属确认)必须传 true —— 否则半透明遮罩下背后仍渲染上一账号的
   * 界面,同机换人时会被肉眼看到(数据泄露)。
   */
  opaqueOverlay?: boolean;
  children: ReactNode;
}

/** 默认触感:12ms 轻震(与 PortalBottomNav 一致)。onCommit 未传时可复用。 */
export function hapticMoment() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* 不支持震动的平台静默跳过 */
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 自持焦点陷阱:aria-modal 真实成立 + 开启焦点入 sheet + Tab 环绕不逃逸 +
 * 焦点被异步渲染吞掉时拉回 + 关闭归还触发器。不依赖任何库的焦点行为。
 */
function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    el.setAttribute('aria-modal', 'true');

    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null && n.getAttribute('aria-hidden') !== 'true',
      );
    const focusFirst = () => {
      const items = focusables();
      (items[0] ?? el).focus({ preventScroll: true });
    };

    // 初始焦点入 sheet(延一帧,等 portal 挂好 + 动画首帧)
    const raf = requestAnimationFrame(() => {
      if (!el.contains(document.activeElement)) focusFirst();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === el)) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    // 焦点逃到 sheet 外(含 Tab 溜出)→ 拉回。放行两类:Radix focus-guard 哨兵;
    // 以及焦点进入「另一个后开的模态」(嵌套 sheet / node-detail 等)—— 嵌套感知,
    // 别把它拽回来,否则嵌套模态里无法输入/交互。只有逃到普通背景才拉回。
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || el.contains(t)) return;
      if (t.hasAttribute?.('data-radix-focus-guard')) return;
      if (t.closest?.('[role="dialog"], [aria-modal="true"], [data-vaul-drawer], [data-radix-portal]')) return;
      focusFirst();
    };
    // 焦点掉到 body(异步 setState 卸载了当前控件)→ 下一帧拉回。
    // iOS 收键盘常 blur 到 body 且 relatedTarget=null —— 绝不能再 focusFirst,
    // 否则键盘弹不回去 / 输入框像卡死。
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return; // 有去处,交给 focusin 判断
      requestAnimationFrame(() => {
        const ae = document.activeElement;
        if (!ae || ae === document.body || ae === document.documentElement) return;
        if (ref.current && !ref.current.contains(ae)) focusFirst();
      });
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      el.removeEventListener('focusout', onFocusOut);
      // 归还焦点给触发器(延一帧,避开卸载抖动)
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
        requestAnimationFrame(() => {
          try {
            prevFocus.focus({ preventScroll: true });
          } catch {
            /* 触发器已随卸载移除 */
          }
        });
      }
    };
  }, [active, ref]);
}

/** bottom:Vaul 手势/弹簧 + 自持焦点陷阱。 */
function VaulContent({ panelClass, panelStyle, ariaLabel, open, children }: {
  panelClass: string; panelStyle?: CSSProperties; ariaLabel: string; open: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  return (
    <Drawer.Content ref={ref} className={panelClass} style={panelStyle} aria-label={ariaLabel} tabIndex={-1}>
      <Drawer.Title className="sr-only">{ariaLabel}</Drawer.Title>
      <div className="nesio-sheet-grabber" aria-hidden="true" />
      {/* 滚动壳:Vaul 把 Drawer.Content 自身的 touch 事件当「拖拽关闭」独占,内容超长时
          触屏无法下拉(桌面滚轮能滚、手机滚不动)。把滚动交给内层容器 —— Vaul 的
          getScrollParent 认得这个嵌套滚动区,只在到顶/到底才让位给拖拽。Content 只当
          flex 框架(见 globals.css .nesio-sheet--bottom)。modal/遮罩/焦点全保留。 */}
      <div className="nesio-sheet-scroll">{children}</div>
    </Drawer.Content>
  );
}

/** center / fullscreen:Radix portal/Esc/scroll-lock + 自持焦点陷阱。
 *  关掉 Radix 自己的 auto-focus,避免与自持 trap 互抢。 */
function RadixContent({ panelClass, panelStyle, ariaLabel, open, dismissible, bareCenter, onOpenChange, children }: {
  panelClass: string; panelStyle?: CSSProperties; ariaLabel: string; open: boolean; dismissible: boolean;
  bareCenter: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  return (
    <Dialog.Content
      ref={ref}
      className={panelClass}
      style={panelStyle}
      aria-label={ariaLabel}
      tabIndex={-1}
      // bare-center 时 Content 满视口 flex 居中,Radix 检测不到「点击外部」——
      // 补空白区点击关闭(点到容器自身、非卡片子节点时关),复刻旧 backdrop 行为。
      onClick={bareCenter && dismissible ? (e) => { if (e.target === e.currentTarget) onOpenChange(false); } : undefined}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
      onPointerDownOutside={dismissible ? undefined : (e) => e.preventDefault()}
      onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
    >
      <Dialog.Title className="sr-only">{ariaLabel}</Dialog.Title>
      {children}
    </Dialog.Content>
  );
}

export default function NesioSheet({
  variant = 'bottom',
  open,
  onOpenChange,
  dismissible = true,
  ariaLabel,
  className,
  style,
  card = true,
  modal = true,
  opaqueOverlay = false,
  children,
}: NesioSheetProps) {
  // opaqueOverlay + 非全屏:面板必须抬到不透明遮罩(929)之上,否则被自己的遮罩盖死
  // (清空本地数据后的「归入账号」强制对话框整屏纯色、看不见点不动 —— QA 致命 bug①)。
  const overOpaque = opaqueOverlay && variant !== 'fullscreen' ? ' nesio-sheet--over-opaque' : '';
  const panelClass = `nesio-sheet nesio-sheet--${variant}${card ? '' : ' nesio-sheet--bare'}${overOpaque}${className ? ` ${className}` : ''}`;

  if (variant === 'bottom') {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible={dismissible} modal repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="nesio-sheet-overlay" />
          <VaulContent panelClass={panelClass} panelStyle={style} ariaLabel={ariaLabel} open={open}>
            {children}
          </VaulContent>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  // fullscreen 的遮罩用不透明页面底当底衬 —— 全屏面板常是磨砂玻璃底(半透明),
  // 需要背后有不透明层,否则在夜间(--glass-bg-solid 近全透)会透出下层。
  const overlayClass = `nesio-sheet-overlay${variant === 'fullscreen' || opaqueOverlay ? ' nesio-sheet-overlay--opaque' : ''}`;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <RadixContent
          panelClass={panelClass}
          panelStyle={style}
          ariaLabel={ariaLabel}
          open={open}
          dismissible={dismissible}
          bareCenter={!card && variant === 'center'}
          onOpenChange={onOpenChange}
        >
          {children}
        </RadixContent>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
