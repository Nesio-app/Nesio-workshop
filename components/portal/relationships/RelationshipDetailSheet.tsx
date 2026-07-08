'use client';

/**
 * RelationshipDetailSheet — 人物详情页(人缘㊁)。从关系 tab 点一个联系人 → 滑出。
 * 身份头(头像/名字/关系/亲疏/家庭徽章/该联系 + 联系过了)+ 关键事实瓦片 + 关系网(ego 图)+ 时间线。
 * 读 buildPersonProfile 的后台档案(不 UI 现算);头像:自定义上传优先 → Google 照片 → 首字母兜底。
 * 只存本机、不调 AI。
 */

import { useEffect, useRef, useState } from 'react';
import { getLifeGraph, addLifeNode, updateLifeNode } from '@/lib/portal/life-graph';
import { buildPersonProfile, type PersonProfile } from '@/lib/portal/relationship-profile';
import { markContacted, lastContactLabel, CLOSENESS_META } from '@/lib/portal/relationships';
import RelationGraph from '../RelationGraph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface Props {
  contactKey: string | null;
  onClose: () => void;
}

/** 把上传的图缩到 ≤200px 的方图,输出 data URI(避免整张原图塞进节点属性)。 */
function downscaleToDataUrl(file: File, size = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no_ctx'));
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0].toUpperCase() : '·';
}

export default function RelationshipDetailSheet({ contactKey, onClose }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rebuild = () => {
    if (!contactKey) { setProfile(null); return; }
    setProfile(buildPersonProfile(getLifeGraph(), contactKey));
  };

  useEffect(() => {
    rebuild();
    const onUpdate = () => rebuild();
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactKey]);

  if (!contactKey || !profile) return null;
  const p = profile;
  const avatarSrc = p.avatar || p.photo || '';

  const onContacted = () => {
    markContacted(p.key);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    rebuild();
  };

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    setBusy(true);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      // 有 person 节点就富化;没有(纯关系推出的联系人)就为他建一个,好挂头像与后续数据
      if (p.nodeId) {
        const node = getLifeGraph().find((n) => n.id === p.nodeId);
        updateLifeNode(p.nodeId, { attributes: { ...(node?.attributes || {}), avatar: dataUrl } });
      } else {
        addLifeNode({
          type: 'person', name: p.displayName, source: 'manual', confidence: 0.9,
          attributes: { avatar: dataUrl, ...(p.email ? { email: p.email } : {}) },
          relations: [], tags: ['联系人'],
        });
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
      rebuild();
    } catch {
      setUploadErr(L(dict, '这张图没能设置成功,换一张再试试。', "Couldn't set that photo — try another."));
    } finally {
      setBusy(false);
    }
  };

  const c = p.contact;
  const tiles: Array<{ icon: string; label: string }> = [];
  if (p.birthday) {
    const mmdd = p.birthday.match(/(\d{1,2})-(\d{1,2})\s*$/);
    tiles.push({ icon: '🎂', label: L(dict, `生日 ${mmdd ? `${mmdd[1]}-${mmdd[2]}` : p.birthday}`, `Birthday ${mmdd ? `${mmdd[1]}-${mmdd[2]}` : p.birthday}`) });
  }
  if (c) {
    tiles.push({ icon: '🕰', label: L(dict, `上次 ${lastContactLabel(c, dict)}`, `Last ${lastContactLabel(c, 'en')}`) });
    tiles.push({ icon: '💬', label: L(dict, `提到 ${c.mentions} 次`, `${c.mentions} mentions`) });
  }
  if (p.email) tiles.push({ icon: '✉️', label: p.email });

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={p.displayName}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        {/* 身份头 */}
        <div className="nesio-rel-detail-head">
          <button
            type="button"
            className="nesio-rel-avatar"
            onClick={() => fileRef.current?.click()}
            aria-label={L(dict, '上传头像', 'Set photo')}
            title={L(dict, '点一下换头像', 'Tap to set a photo')}
          >
            {avatarSrc
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarSrc} alt={p.displayName} className="nesio-rel-avatar-img" draggable={false} />
              : <span className="nesio-rel-avatar-initial">{initialOf(p.displayName)}</span>}
            <span className="nesio-rel-avatar-edit" aria-hidden>{busy ? '…' : '✎'}</span>
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { void onPickAvatar(e.target.files?.[0]); e.currentTarget.value = ''; }}
          />
          <div className="nesio-rel-detail-id">
            <h2 className="nesio-settings-sheet-title" style={{ margin: 0 }}>{p.displayName}</h2>
            <div className="nesio-rel-detail-pills">
              {p.isFamily && <span className="nesio-rel-pill nesio-rel-pill--fam">👪 {L(dict, '家庭', 'Family')}</span>}
              {c && <span className="nesio-rel-pill">{L(dict, CLOSENESS_META[c.closeness].zh, CLOSENESS_META[c.closeness].en)}</span>}
              {c?.relation && <span className="nesio-rel-pill nesio-rel-pill--rel">{c.relation}</span>}
              {c?.reachOut && <span className="nesio-rel-pill nesio-rel-pill--due">{L(dict, '该联系了', 'Reach out')}</span>}
            </div>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>

        <div className="nesio-settings-sheet-body">
          {uploadErr && <p className="nesio-rel-detail-err" role="alert">{uploadErr}</p>}

          {c?.reachOut && (
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%' }} onClick={onContacted}>
              {L(dict, '联系过了', 'Reached out')}
            </button>
          )}

          {/* 关键事实瓦片 */}
          {tiles.length > 0 && (
            <div className="nesio-rel-detail-tiles">
              {tiles.map((t, i) => (
                <div key={i} className="nesio-rel-detail-tile">
                  <span className="nesio-rel-detail-tile-ic">{t.icon}</span>
                  <span className="nesio-rel-detail-tile-lab">{t.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* 关系网(ego) */}
          {p.ego.nodes.length > 1 && (
            <div className="nesio-related-section">
              <p className="nesio-settings-section-label">{L(dict, '关系网', 'Connections')}</p>
              <RelationGraph
                nodes={p.ego.nodes}
                edges={p.ego.edges}
                focusId={p.ego.nodes[0].id}
                height={220}
                emptyText={L(dict, '还没有关系连接', 'No connections yet')}
              />
            </div>
          )}

          {/* 时间线 */}
          {p.timeline.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p className="nesio-settings-section-label">{L(dict, '往来', 'Timeline')}</p>
              <div className="nesio-rel-timeline">
                {p.timeline.map((t, i) => (
                  <div key={i} className="nesio-rel-tl-row">
                    <span className="nesio-rel-tl-date">
                      {t.at ? new Date(t.at).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : '—'}
                    </span>
                    <span className="nesio-rel-tl-text">{t.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="nesio-settings-option-hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
            {L(dict, '只存本机 · 从你的记忆、邮件、通讯录推出', 'On-device only · from your notes, email and contacts')}
          </p>
        </div>
      </div>
    </div>
  );
}
