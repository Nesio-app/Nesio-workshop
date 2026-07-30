'use client';

/**
 * SnapButton — 「拍一张」直达智能相机的统一入口(bug3)。
 *
 * 病根:好几处「拍照」按钮只派了 `nesio-open-camera`,于是相机开在**选择页**
 * (「拍一张,Nesio 帮你识别并存入 Memory」+ 拍照/相册),还得再点一次才真的拍 ——
 * 用户标注就是「拍照没有直接进入拍一张的智能相机 / 拍照按钮启动口不对」。
 *
 * 修法沿用做饭页已验证的那条路:按钮**自己**持一个 capture=environment 的 file input,
 * 点击当场调起系统相机(保住用户手势,iOS 上可靠),拿到文件再连图一起派事件 ——
 * CameraSheet 收到 initialFile 直接进识别,不再停在选择页。
 *
 * onFile 之前可以先做「记账口挂钩」这类准备(如 armTravelReceiptCapture)。
 */

import { useRef, type ReactNode } from 'react';

export default function SnapButton({
  className, label, ariaLabel, beforeOpen, children, disabled,
}: {
  className?: string;
  /** 按钮文字(不传就用 children)。 */
  label?: string;
  ariaLabel?: string;
  /** 调起相机之前跑一次 —— 用来武装「这张照片记到哪」。 */
  beforeOpen?: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel || label}
        onClick={() => { beforeOpen?.(); ref.current?.click(); }}
      >
        {children ?? label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="nesio-visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = '';
          // 没选(用户取消)就什么都不做 —— 不要开一个空相机页。
          if (f) window.dispatchEvent(new CustomEvent('nesio-open-camera', { detail: { file: f } }));
        }}
      />
    </>
  );
}
