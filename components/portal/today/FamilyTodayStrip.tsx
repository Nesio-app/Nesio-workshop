'use client';

/**
 * FamilyTodayStrip —— 闭环的今天页一端。把家庭家务拉到今天页,无需进「家庭分享」:
 *  ① 分给我的今天家务 → 直接「完成」(→ 走服务端,家长会在 TA 今天页收到回响);
 *  ② 我能审核、且有人刚做完 → 「XX 做完了 · 看一眼」通知,当场 看着不错 / 再来一次。
 * 空 → 不渲染。每个异步动作都有显式失败态 + 每行都有「稍后」出口(warm-coach 红线)。
 * 效率:秒显 sessionStorage 缓存 + 60s 节流拉取(family-updated 事件强刷);仅登录时挂载。
 * 数据来自 Supabase 家庭表(跨账号),经 /api/portal/family/board 服务端授权拉取。
 * 说明:回响是「下次打开今天页时出现」(拉取式),不是实时推送 —— app 暂无 realtime 通道。
 * 图15:壳统一 nesio-proactive-card + Button size=sm;点卡 → nesio-open-family。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { listFamilies, getBoard, choreAction, type BoardView, type ChoreInstanceView } from '@/lib/family/family-client';
import { awardChorePoints, reconcileMyChorePoints } from '../family/award-chore-points';
import { readPortalCache, writePortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import Button from '../ui/Button';

// 家务的「多少」= 积分(2026-08-01 用户:「家务挣积分,把钱相关的 UI 逻辑都换」)。
// 和 chorePointValue 同一口径(1 元 = 1 积分),界面上只说「分」。
const points = (n: number, dict: 'zh' | 'en') => (dict === 'en' ? `${Math.round(n)} pts` : `${Math.round(n)} 分`);
const dayKey = () => new Date().toLocaleDateString('en-CA');
const THROTTLE_MS = 60_000;
const FETCH_AT_KEY = 'nesio-family-strip-fetch-at-v1';
const snoozeKey = () => `nesio-family-strip-snoozed-${dayKey()}`;

interface Board extends BoardView { familyName: string; }

function choreLabel(c: ChoreInstanceView, fallback: string): string {
  return (c.title && c.title.trim()) || fallback;
}
function loadSnoozed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(snoozeKey()) || '[]') as string[]); } catch { return new Set(); }
}
function persistSnoozed(s: Set<string>): void {
  try { localStorage.setItem(snoozeKey(), JSON.stringify([...s])); } catch { /* 配额/隐私模式:失败就当没记,顶多下次还提示 */ }
}

function openFamilySheet() {
  try { window.dispatchEvent(new CustomEvent('nesio-open-family')); } catch { /* noop */ }
}

export default function FamilyTodayStrip() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [boards, setBoards] = useState<Board[]>(() => readPortalCache<Board[]>(PORTAL_CACHE_KEYS.family) ?? []);
  const [busyId, setBusyId] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [snoozed, setSnoozed] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : loadSnoozed()));
  const inFlight = useRef(false);

  const fetchNow = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const fr = await listFamilies();
      if (!fr.ok || !fr.data.families.length) { setBoards([]); writePortalCache(PORTAL_CACHE_KEYS.family, []); return; }
      const next: Board[] = [];
      for (const fam of fr.data.families) {
        const br = await getBoard(fam.familyId);
        if (br.ok) next.push({ ...br.data.board, familyName: fam.name });
      }
      setBoards(next);
      writePortalCache(PORTAL_CACHE_KEYS.family, next);
      for (const fam of next) void reconcileMyChorePoints(fam.familyId, dict === 'en' ? 'en' : 'zh');
      try { localStorage.setItem(FETCH_AT_KEY, String(Date.now())); } catch { /* noop */ }
    } finally {
      inFlight.current = false;
    }
  }, [dict]);

  // 节流:距上次拉取 < 60s 就跳过(缓存已在显示);force 绕过(用户动作 / family-updated)。
  const maybeRefresh = useCallback((force: boolean) => {
    if (!force) {
      let last = 0;
      try { last = parseInt(localStorage.getItem(FETCH_AT_KEY) || '0', 10); } catch { /* noop */ }
      if (Date.now() - last < THROTTLE_MS) return;
    }
    void fetchNow();
  }, [fetchNow]);

  useEffect(() => {
    maybeRefresh(false);
    const onVis = () => { if (document.visibilityState === 'visible') maybeRefresh(false); };
    const onUpdated = () => maybeRefresh(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('nesio-family-updated', onUpdated);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('nesio-family-updated', onUpdated);
    };
  }, [maybeRefresh]);

  const act = useCallback(async (familyId: string, instanceId: string, action: 'done' | 'approve' | 'send_back') => {
    setBusyId(instanceId + action); setActionErr('');
    const r = await choreAction(familyId, instanceId, action);
    setBusyId('');
    if (!r.ok) { setActionErr(t('那一下没成,再试一次。', 'That didn’t go through — try again.')); return; }
    // 家务挣积分。和家庭板走同一个函数(判据 + 幂等都在那儿)。
    void awardChorePoints(familyId, instanceId, dict === 'en' ? 'en' : 'zh');
    void fetchNow();
  }, [fetchNow, t, dict]);

  const snooze = useCallback((id: string) => {
    setSnoozed((prev) => { const next = new Set(prev).add(id); persistSnoozed(next); return next; });
  }, []);

  const nameFor = (b: Board, personId: string) => b.everyone.find((e) => e.member.id === personId)?.member.name ?? '';

  const myChores = boards.flatMap((b) => b.myChoresToday.map((c) => ({ b, c }))).filter(({ c }) => !snoozed.has(c.id));
  const toReview = boards.flatMap((b) => b.toReview.map((c) => ({ b, c }))).filter(({ c }) => !snoozed.has('rv:' + c.id));
  if (!myChores.length && !toReview.length) return null;

  return (
    <div className="nesio-proactive-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="nesio-proactive-card-inner" style={{ cursor: 'pointer' }} onClick={openFamilySheet} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFamilySheet(); } }}>
        <div className="nesio-proactive-card-text">
          <p className="nesio-proactive-card-title">{t('今天的家务', 'Today’s chores')}</p>
          <p className="nesio-proactive-card-body">
            {t('点这里打开家务板 · 成员积分与历史都在里面', 'Tap to open the family board — points & history live there')}
          </p>
          <div className="nesio-proactive-card-actions" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="soft" onClick={openFamilySheet}>
              {t('家务板 / 历史', 'Board / history')}
            </Button>
          </div>
        </div>
      </div>

      {actionErr && <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)', padding: '0 var(--space-4)' }}>{actionErr}</span>}

      {/* 回响:有人做完了家务,等你看一眼 */}
      {toReview.length > 0 && (
        <div style={{ padding: '0 var(--space-4) var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p className="nesio-proactive-card-body" style={{ margin: 0, fontWeight: 'var(--weight-semibold)' as unknown as number }}>
            {t('家里有人做完了', 'Someone finished a chore')}
          </p>
          {toReview.map(({ b, c }) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-body)' }}>
                <b>{nameFor(b, c.assigneeId) || t('家人', 'Family')}</b> {t('做完了', 'finished')} 「{choreLabel(c, t('家务', 'Chore'))}」
                <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}> · {points(c.value, dict)}</span>
              </div>
              <div className="nesio-proactive-card-actions" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Button size="sm" variant="primary" disabled={busyId === c.id + 'approve'} onClick={() => void act(b.familyId, c.id, 'approve')} layoutStyle={{ flex: 1 }}>
                  {t('看着不错', 'Looks good')}
                </Button>
                <Button size="sm" variant="soft" disabled={busyId === c.id + 'send_back'} onClick={() => void act(b.familyId, c.id, 'send_back')} layoutStyle={{ flex: 1 }}>
                  {t('再来一次', 'Try again')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => snooze('rv:' + c.id)}>{t('稍后', 'Later')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分给我的今天家务 */}
      {myChores.length > 0 && (
        <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {toReview.length > 0 && (
            <p className="nesio-proactive-card-body" style={{ margin: 0, fontWeight: 'var(--weight-semibold)' as unknown as number }}>
              {t('轮到你的', 'Yours to do')}
            </p>
          )}
          {myChores.map(({ b, c }) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{choreLabel(c, t('家务', 'Chore'))}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                  {c.state === 'done' ? t('已提交,等审核', 'Submitted — waiting') : t('干完点「完成」', 'Tap Done when finished')}{c.value > 0 ? ` · ${points(c.value, dict)}` : ''}
                </div>
              </div>
              {c.state === 'todo' && (
                <Button size="sm" variant="primary" disabled={busyId === c.id + 'done'} onClick={() => void act(b.familyId, c.id, 'done')}>
                  {t('完成', 'Done')}
                </Button>
              )}
              {c.state === 'done' && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{t('待审', 'In review')}</span>}
              <Button size="sm" variant="ghost" onClick={() => snooze(c.id)}>{t('稍后', 'Later')}</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
