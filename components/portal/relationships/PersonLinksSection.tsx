'use client';

/**
 * PersonLinksSection — 人物详情页的「关联」区(People 升级,2026-07-29)。
 *
 * 用户要的是「点一个人能看到 TA 关联的一切」。这里接两块目前真的存在的:
 *
 *   · 健康 —— 本机、同步、一定有(personHealthItems 合并了手写记录 + 四类健康 Signal)。
 *   · 家务活 —— 服务端、要登录、按邮箱认人。拿不到就说拿不到,不装作「TA 没有家务」。
 *
 * 家务这块是异步的,所以按红线办:有明确失败态 + 重试,不许静默回到空白。
 * 「没连家庭 / 这个人不在家庭里」和「网络没成」是**两回事**,分开说 ——
 * 混成一句「暂无」是最容易骗到人的写法。
 */

import { useCallback, useEffect, useState } from 'react';
import { personHealthItems, type PersonHealthItem } from '@/lib/health/person-health';
import { listFamilies, listFamilyMembers, getBoard, type ChoreInstanceView } from '@/lib/family/family-client';
import { normalizeEmail } from '@/lib/portal/relationships';
import { IconLock } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const MAX_ROWS = 6;

type ChorePhase =
  | { s: 'loading' }
  | { s: 'none' }                                   // 没连家庭,或这个人不在家庭里 —— 明确的「没有」
  | { s: 'ok'; chores: ChoreInstanceView[]; familyName: string }
  | { s: 'error'; msg: string };

function flagColor(flag?: string): string {
  // 日常偏高一律 amber,不用红 —— 红只留给真实风险。
  if (flag === 'high') return 'var(--status-gentle)';
  if (flag === 'low') return 'var(--status-calm)';
  return 'var(--portal-ink)';
}

function fmtDate(d: string | undefined, dict: string): string {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d.slice(0, 10);
  return t.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
}

export default function PersonLinksSection({ personKey, email }: { personKey: string; email?: string }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [health, setHealth] = useState<PersonHealthItem[]>([]);
  const [chore, setChore] = useState<ChorePhase>({ s: 'loading' });
  const [showAllHealth, setShowAllHealth] = useState(false);
  const [openHealth, setOpenHealth] = useState(true);
  const [openChore, setOpenChore] = useState(true);

  useEffect(() => {
    const rebuild = () => setHealth(personHealthItems(personKey));
    rebuild();
    window.addEventListener('nesio-person-records-updated', rebuild);
    window.addEventListener('nesio-life-graph-updated', rebuild);
    return () => {
      window.removeEventListener('nesio-person-records-updated', rebuild);
      window.removeEventListener('nesio-life-graph-updated', rebuild);
    };
  }, [personKey]);

  const loadChores = useCallback(async () => {
    setChore({ s: 'loading' });
    // 按邮箱认人 —— 没有邮箱就没法和家庭成员对上,这是「没有」不是「出错」。
    const mine = email ? normalizeEmail(email) : normalizeEmail(personKey);
    if (!mine.includes('@')) { setChore({ s: 'none' }); return; }
    const fams = await listFamilies();
    if (!fams.ok) {
      // 未登录也走这条 —— 但那不是错,是「这块现在看不了」。
      setChore(fams.error === 'unauthorized'
        ? { s: 'none' }
        : { s: 'error', msg: t('家务这块没读出来。', "Couldn't load chores.") });
      return;
    }
    for (const fam of fams.data.families) {
      const mem = await listFamilyMembers(fam.familyId);
      if (!mem.ok) { setChore({ s: 'error', msg: t('家务这块没读出来。', "Couldn't load chores.") }); return; }
      const hit = mem.data.members.find((m) => m.email && normalizeEmail(m.email) === mine);
      if (!hit) continue;
      const board = await getBoard(fam.familyId);
      if (!board.ok) { setChore({ s: 'error', msg: t('家务这块没读出来。', "Couldn't load chores.") }); return; }
      const b = board.data.board;
      const theirs = [...b.assigned, ...b.myChoresToday, ...b.toReview].filter((c) => c.assigneeId === hit.id);
      // 同一条可能同时出现在两个桶里,按 id 去重
      const seen = new Set<string>();
      const chores = theirs.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      setChore({ s: 'ok', chores, familyName: fam.name });
      return;
    }
    setChore({ s: 'none' });
  }, [personKey, email, dict]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadChores(); }, [loadChores]);

  const healthShown = showAllHealth ? health : health.slice(0, MAX_ROWS);

  return (
    <>
      {/* ── 健康 ─────────────────────────────────────────────── */}
      <div className="nesio-rel-cat" style={{ marginTop: 'var(--space-4)' }}>
        <button type="button" className="nesio-rel-cat-head" onClick={() => setOpenHealth((v) => !v)} aria-expanded={openHealth}>
          <span className="nesio-rel-cat-title">
            {openHealth ? '▾' : '▸'} {t('健康', 'Health')}{health.length ? ` · ${health.length}` : ''}
          </span>
          {health.length > 0 && (
            <span className="nesio-rel-rec-local" title={t('仅你可见', 'Only you')}>
              <IconLock size={11} />{t('仅本机', 'On device')}
            </span>
          )}
        </button>
        {openHealth && (health.length > 0 ? (
          <>
            <div className="nesio-rel-rec-list nesio-rel-rec-list--nested">
              {healthShown.map((h) => (
                <div key={h.id} className="nesio-rel-rec-row">
                  <div className="nesio-rel-rec-main">
                    <span className="nesio-rel-rec-title" style={{ color: flagColor(h.flag) }}>{h.title}</span>
                    <span className="nesio-rel-rec-sub">
                      {[fmtDate(h.date, dict), h.detail].filter(Boolean).join(' · ')}
                      {h.origin === 'signal' ? t(' · 来自记录', ' · from records') : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {health.length > MAX_ROWS && !showAllHealth && (
              <button type="button" className="nesio-rel-showall" onClick={() => setShowAllHealth(true)}>
                {t(`显示全部 ${health.length} 条`, `Show all ${health.length}`)}
              </button>
            )}
          </>
        ) : (
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
            {t('还没有 TA 的健康记录。上面「挂一条」可以记医疗/药物/健康。', 'No health records yet — use “Add” above to note medical/medication/health.')}
          </p>
        ))}
      </div>

      {/* ── 家务活 ───────────────────────────────────────────── */}
      <div className="nesio-rel-cat" style={{ marginTop: 'var(--space-4)' }}>
        <button type="button" className="nesio-rel-cat-head" onClick={() => setOpenChore((v) => !v)} aria-expanded={openChore}>
          <span className="nesio-rel-cat-title">
            {openChore ? '▾' : '▸'} {t('家务活', 'Chores')}
            {chore.s === 'ok' && chore.chores.length ? ` · ${chore.chores.length}` : ''}
          </span>
          {chore.s === 'ok' && <span className="nesio-rel-rec-sub">{chore.familyName}</span>}
        </button>

        {openChore && (
          <>
        {chore.s === 'loading' && (
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>{t('看看…', 'Checking…')}</p>
        )}

        {/* 红线:异步失败要看得见 + 能重试,不许悄悄变成「暂无」*/}
        {chore.s === 'error' && (
          <div role="alert" style={{ marginTop: 'var(--space-1)' }}>
            <p className="nesio-rel-detail-err" style={{ margin: 0 }}>{chore.msg}</p>
            <button type="button" className="nesio-rel-log-btn" style={{ marginTop: 'var(--space-2)' }} onClick={() => void loadChores()}>
              {t('再试一次', 'Try again')}
            </button>
          </div>
        )}

        {chore.s === 'none' && (
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
            {t('TA 还不在你的家庭组里。在记忆详情里「分派给家人」就能把活派给 TA。',
              'They’re not in your family group yet — use “Assign to family” on a memory to give them a task.')}
          </p>
        )}

        {chore.s === 'ok' && (chore.chores.length > 0 ? (
          <div className="nesio-rel-rec-list nesio-rel-rec-list--nested">
            {chore.chores.slice(0, MAX_ROWS).map((c) => (
              <div key={c.id} className="nesio-rel-rec-row">
                <div className="nesio-rel-rec-main">
                  <span className="nesio-rel-rec-title">{c.title || t('一件家务', 'A chore')}</span>
                  <span className="nesio-rel-rec-sub">
                    {[fmtDate(c.dueDate, dict),
                      c.state === 'todo' ? t('待完成', 'To do')
                        : c.state === 'done' ? t('等你看一眼', 'Awaiting review')
                          : c.state === 'approved' ? t('已完成', 'Done') : t('已结清', 'Paid'),
                      c.value ? `${c.value}` : ''].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-1) 0 0' }}>
            {t('TA 手上现在没有活。', 'Nothing on their plate right now.')}
          </p>
        ))}
          </>
        )}
      </div>
    </>
  );
}
