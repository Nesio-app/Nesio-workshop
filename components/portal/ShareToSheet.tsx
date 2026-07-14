'use client';

/**
 * ShareToSheet — 「分享到」目的地面板(点分享按钮弹出:去哪)。
 *
 * 主按钮**存到相册**(陶棕高亮)· Instagram · X · TikTok · Facebook · 更多(横滑),
 * 第二行 小红书 · 复制链接。平台图标都做**单色线性**(不用彩色 logo / emoji),
 * 符合克制风格。底部一句守隐私红线:分享的是做好的成就卡(过去·聚合),不含实时定位。
 *
 * 存图/平台分享都要有可见的成功/失败态(设计规范:每个异步动作都有失败分支)。
 */

import { useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// ── 单色线性图标(currentColor,无品牌色 / 无 emoji)──
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function IconDownload() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></svg>; }
function IconInstagram() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" /></svg>; }
function IconXMark() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><path d="M5 5l14 14M19 5L5 19" /></svg>; }
function IconTikTok() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><path d="M9 9.5v6.2a2.8 2.8 0 1 1-2.8-2.8" /><path d="M13.5 4c.4 2.6 2 4.2 4.5 4.6" /><path d="M13.5 4v9.7" /></svg>; }
function IconFacebook() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><path d="M15 4h-2.2A2.8 2.8 0 0 0 10 6.8V9H8v3h2v8" /><path d="M14.5 12H10" /></svg>; }
function IconRednote() { return <svg viewBox="0 0 24 24" width="20" height="20" {...S}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 9v6M8 12h3M16 9l-2 6M16 9v6" /></svg>; }
function IconLink() { return <svg viewBox="0 0 24 24" width="20" height="20" {...S}><path d="M9 12h6" /><path d="M10 8H8a4 4 0 0 0 0 8h2" /><path d="M14 8h2a4 4 0 0 1 0 8h-2" /></svg>; }
function IconMore() { return <svg viewBox="0 0 24 24" width="22" height="22" {...S}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>; }

export interface ShareToSheetProps {
  open: boolean;
  onClose: () => void;
  /** 光栅化当前分享卡为 PNG。返回 null = 生成失败。 */
  getBlob: () => Promise<Blob | null>;
  /** 平台分享附带的文案。 */
  shareText: string;
  /** 复制链接用。 */
  link: string;
  /** 存图文件名(不含扩展)。 */
  fileBase?: string;
  /** 图片 MIME(默认 png;足迹卡传 image/jpeg 存相册)。 */
  mime?: string;
}

export default function ShareToSheet({ open, onClose, getBlob, shareText, link, fileBase = 'nesio-places', mime = 'image/png' }: ShareToSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (!open) return null;

  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';

  async function toFile(): Promise<File | null> {
    const blob = await getBlob();
    if (!blob) return null;
    return new File([blob], `${fileBase}.${ext}`, { type: mime });
  }

  function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function savePhoto() {
    setBusy('save'); setMsg(null);
    try {
      const file = await toFile();
      if (!file) throw new Error('no-image');
      // 优先系统分享(iOS 有「存储图像」→ 直接进相机胶卷);桌面 / 不支持则下载。
      const nav = navigator as Navigator & { canShare?: (d: ShareData & { files?: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file] });
        setMsg({ kind: 'ok', text: L(dict, '选「存储图像」就进相册了。', 'Choose "Save Image" to add it to Photos.') });
      } else {
        download(file);
        setMsg({ kind: 'ok', text: L(dict, '成就卡已下载(.jpg)。', 'Card downloaded (.jpg).') });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setBusy(''); return; }
      setMsg({ kind: 'err', text: L(dict, '存图没成功,请重试。', "Couldn't save the image — try again.") });
    } finally { setBusy(''); }
  }

  async function shareTo(key: string, platform: string) {
    setBusy(key); setMsg(null);
    try {
      const file = await toFile();
      if (!file) throw new Error('no-image');
      const nav = navigator as Navigator & { canShare?: (d: ShareData & { files?: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], text: shareText });
        setMsg({ kind: 'ok', text: L(dict, '已打开分享。', 'Share sheet opened.') });
      } else {
        // 桌面 / 不支持文件分享:先把图存下来,提示去平台粘贴
        download(file);
        setMsg({ kind: 'ok', text: L(dict, `图片已存好,去 ${platform} 发布时选它就行。`, `Image saved — pick it when you post to ${platform}.`) });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setBusy(''); return; } // 用户自己取消
      setMsg({ kind: 'err', text: L(dict, '分享没成功,可以先「存到相册」再手动发。', "Share failed — save to Photos and post manually.") });
    } finally { setBusy(''); }
  }

  async function nativeShare() {
    setBusy('more'); setMsg(null);
    try {
      const file = await toFile();
      const nav = navigator as Navigator & { canShare?: (d: ShareData & { files?: File[] }) => boolean };
      if (file && nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], text: shareText });
      } else if (navigator.share) {
        await navigator.share({ text: shareText, url: link });
      } else if (file) {
        download(file);
        setMsg({ kind: 'ok', text: L(dict, '图片已存好。', 'Image saved.') });
      } else {
        throw new Error('unsupported');
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setBusy(''); return; }
      setMsg({ kind: 'err', text: L(dict, '这台设备不支持系统分享,试试「存到相册」。', "System share isn't available here — try Save to Photos.") });
    } finally { setBusy(''); }
  }

  async function copyLink() {
    setBusy('link'); setMsg(null);
    try {
      await navigator.clipboard.writeText(link);
      setMsg({ kind: 'ok', text: L(dict, '链接已复制。', 'Link copied.') });
    } catch {
      setMsg({ kind: 'err', text: L(dict, '复制没成功,请手动复制。', "Couldn't copy — copy manually.") });
    } finally { setBusy(''); }
  }

  const platforms: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void }> = [
    { key: 'ig', label: 'Instagram', icon: <IconInstagram />, onClick: () => shareTo('ig', 'Instagram') },
    { key: 'x', label: 'X', icon: <IconXMark />, onClick: () => shareTo('x', 'X') },
    { key: 'tt', label: 'TikTok', icon: <IconTikTok />, onClick: () => shareTo('tt', 'TikTok') },
    { key: 'fb', label: 'Facebook', icon: <IconFacebook />, onClick: () => shareTo('fb', 'Facebook') },
    { key: 'more', label: L(dict, '更多', 'More'), icon: <IconMore />, onClick: nativeShare },
  ];

  return (
    <div className="nesio-shareto-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '分享到', 'Share to')}>
      <button type="button" className="nesio-shareto-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-shareto-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-shareto-head">
          <h2 className="nesio-shareto-title">{L(dict, '分享到', 'Share to')}</h2>
          <button type="button" className="nesio-shareto-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>
            <svg viewBox="0 0 24 24" width="16" height="16" {...S}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* 第一行:存到相册(高亮)+ 平台,横滑 */}
        <div className="nesio-shareto-row nesio-shareto-row--scroll">
          <button type="button" className="nesio-shareto-dest nesio-shareto-dest--primary" onClick={savePhoto} disabled={busy === 'save'}>
            <span className="nesio-shareto-ico nesio-shareto-ico--primary" aria-hidden><IconDownload /></span>
            <span className="nesio-shareto-label">{busy === 'save' ? L(dict, '存图中…', 'Saving…') : L(dict, '存到相册', 'Save')}</span>
          </button>
          {platforms.map((p) => (
            <button key={p.key} type="button" className="nesio-shareto-dest" onClick={p.onClick} disabled={busy === p.key}>
              <span className="nesio-shareto-ico" aria-hidden>{p.icon}</span>
              <span className="nesio-shareto-label">{p.label}</span>
            </button>
          ))}
        </div>

        {/* 第二行:小红书 · 复制链接 */}
        <div className="nesio-shareto-row nesio-shareto-row--wide">
          <button type="button" className="nesio-shareto-wide" onClick={() => shareTo('xhs', L(dict, '小红书', 'RedNote'))} disabled={busy === 'xhs'}>
            <IconRednote /><span>{L(dict, '小红书', 'RedNote')}</span>
          </button>
          <button type="button" className="nesio-shareto-wide" onClick={copyLink} disabled={busy === 'link'}>
            <IconLink /><span>{busy === 'link' ? L(dict, '复制中…', 'Copying…') : L(dict, '复制链接', 'Copy link')}</span>
          </button>
        </div>

        {msg && (
          <p className={`nesio-shareto-msg ${msg.kind === 'err' ? 'nesio-shareto-msg--err' : ''}`} role="status">{msg.text}</p>
        )}

        {/* 隐私红线 */}
        <p className="nesio-shareto-privacy">
          {L(dict, '分享的是你做好的成就卡(过去 · 聚合),不含实时定位。', 'You share a finished achievement card (past · aggregated) — no live location.')}
        </p>
      </div>
    </div>
  );
}
