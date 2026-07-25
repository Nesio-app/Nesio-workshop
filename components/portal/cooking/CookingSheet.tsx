'use client';

/**
 * CookingSheet — 做饭 / 库存(workshop 域实验 · M1 库存 + M2-c 手上能做什么)。
 * 主视图:① 快过期先用 ② 手上能做什么(库存∩菜谱,缺料=配料−库存−常备)③ 进货 ④ 库存清单。
 * 菜谱详情视图:配图 + 有的/缺的/常备 + 步骤。
 * 数据 = 本地 object 节点(食材)+ 打包菜谱;随生活图谱上你自己的云,不共享。每个异步动作有显式失败态。
 * 文案暖教练、不用红色制造焦虑;全用设计 token、无 emoji、线性图标。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { IconUtensils, IconClock, IconBox, IconMapPin, IconCamera, IconCheckSquare } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, consumePantry, removePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';
import { normalizeIngredient } from '@/lib/cooking/food-catalog';
import { loadRecipes, recipeImageUrl, type Recipe } from '@/lib/cooking/food-data';
import { matchRecipes, type RecipeMatch } from '@/lib/cooking/recipe-match';
import { getShoppingList, addToShopping, toggleShoppingItem, removeShoppingItem, checkoutBought, type ShoppingItem } from '@/lib/cooking/shopping';

type View = { kind: 'pantry' } | { kind: 'recipe'; match: RecipeMatch<Recipe> };

export default function CookingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = (zh: string, en: string) => L(dict, zh, en);

  const [items, setItems] = useState<PantryItem[]>([]);
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [view, setView] = useState<View>({ kind: 'pantry' });
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [recipesErr, setRecipesErr] = useState(false);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [shopMsg, setShopMsg] = useState('');

  const reloadShopping = useCallback(() => { try { setShopping(getShoppingList()?.items ?? []); } catch { /* 购物清单读不出不致命,静默 */ } }, []);
  const reload = useCallback(() => {
    try { setItems(listPantry()); } catch { setErr(t('读不出库存,刷新看看。', 'Could not read the pantry — refresh.')); }
    reloadShopping();
  }, [t, reloadShopping]);
  useEffect(() => { if (open) reload(); }, [open, reload]);

  const loadRec = useCallback(() => {
    setRecipesErr(false);
    loadRecipes().then(setRecipes).catch(() => setRecipesErr(true));
  }, []);
  useEffect(() => { if (open && recipes === null && !recipesErr) loadRec(); }, [open, recipes, recipesErr, loadRec]);

  const soon = useMemo(() => expiringPantry(items, 4), [items]);
  // 库存食材归一化成标准名集合(全系统 join key),供菜谱匹配。
  const pantryNames = useMemo(() => new Set(items.map((i) => normalizeIngredient(i.name).name).filter(Boolean)), [items]);
  const matches = useMemo(
    () => (recipes && pantryNames.size ? matchRecipes(recipes, pantryNames, normalizeIngredient, { onlyWithPantry: true }).slice(0, 12) : []),
    [recipes, pantryNames],
  );

  if (!open) return null;

  async function consume(id: string) {
    setBusyId(id + 'use'); setErr('');
    try { if (!consumePantry(id)) setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    catch { setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    setBusyId(''); reload();
  }
  async function remove(id: string) {
    setBusyId(id + 'del'); setErr('');
    try { if (!removePantry(id)) setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    catch { setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    setBusyId(''); reload();
  }

  function addMissing(names: string[]) {
    try { addToShopping(names); reloadShopping(); setShopMsg(t('加进购物清单了', 'Added to shopping list')); setTimeout(() => setShopMsg(''), 1500); }
    catch { setErr(t('没加上购物清单,再试一次。', 'Could not add to list — try again.')); }
  }
  function toggleShop(name: string, checked: boolean) { try { toggleShoppingItem(name, checked); reloadShopping(); } catch { setErr(t('没记上,再试一次。', 'Could not update — try again.')); } }
  function removeShop(name: string) { try { removeShoppingItem(name); reloadShopping(); } catch { setErr(t('没删成,再试一次。', 'Could not remove — try again.')); } }
  function checkout() {
    try {
      const n = checkoutBought(); reload();
      setShopMsg(n > 0 ? t(`回流 ${n} 样进库存`, `${n} back in pantry`) : t('先勾上买到的', 'Check what you bought first'));
      setTimeout(() => setShopMsg(''), 1800);
    } catch { setErr(t('没回流成,再试一次。', 'Could not update pantry — try again.')); }
  }

  const inRecipe = view.kind === 'recipe';
  const shopChecked = shopping.filter((s) => s.checked).length;

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('做饭 · 库存', 'Cooking · Pantry')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--portal-line)' }}>
          {inRecipe
            ? <button type="button" onClick={() => setView({ kind: 'pantry' })} style={backBtn}>‹ {t('返回', 'Back')}</button>
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}><IconUtensils size={20} /></span>}
          <h2 style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inRecipe ? view.match.recipe.name : t('做饭 · 库存', 'Cooking · Pantry')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('关闭', 'Close')} style={{ ...backBtn, textAlign: 'right' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {inRecipe ? (
            <RecipeDetail match={view.match} onAddToShopping={addMissing} shopMsg={shopMsg} t={t} />
          ) : (
            <>
              {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

              {/* 快过期先用 —— 主线:用光你已有的、快过期的 */}
              {soon.length > 0 && (
                <section>
                  <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconClock size={12} />{t('快过期先用', 'Use these first')}</p>
                  <div style={{ ...cardStyle, background: 'var(--status-gentle-soft)', borderColor: 'transparent' }}>
                    {soon.map((it, i) => (
                      <div key={it.id} style={{ ...rowStyle, borderBottom: i === soon.length - 1 ? 'none' : rowStyle.borderBottom }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{qtyName(it)}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{freshLabel(it.daysLeft, t)}</div>
                        </div>
                        <button type="button" onClick={() => void consume(it.id)} disabled={busyId === it.id + 'use'} style={primaryBtn}>{t('用掉一份', 'Use one')}</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 手上能做什么(库存 ∩ 菜谱) */}
              {items.length > 0 && (
                <section>
                  <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconUtensils size={12} />{t('手上能做什么', 'What you can cook')}</p>
                  {recipesErr && <ErrorRow msg={t('菜谱没载出来。', 'Recipes didn’t load.')} onRetry={loadRec} t={t} />}
                  {!recipesErr && recipes === null && <p style={{ ...mutedRow }}>{t('翻翻菜谱…', 'Looking through recipes…')}</p>}
                  {!recipesErr && recipes !== null && matches.length === 0 && (
                    <p style={{ ...mutedRow }}>{t('先加点库存,这里就会冒出「手上能做的菜」。', 'Add some pantry items and cookable dishes will show up here.')}</p>
                  )}
                  {matches.length > 0 && (
                    <div style={{ ...cardStyle }}>
                      {matches.map((mtc, i) => (
                        <button key={mtc.recipe.name} type="button" onClick={() => setView({ kind: 'recipe', match: mtc })}
                          style={{ ...rowStyle, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === matches.length - 1 ? 'none' : '1px solid var(--portal-line)', cursor: 'pointer' }}>
                          <RecipeThumb image={mtc.recipe.image} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mtc.recipe.name}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: mtc.canCook ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                              {mtc.recipe.category} · {mtc.canCook ? t('手上齐了', 'ready to cook') : t(`还缺 ${mtc.missing.length} 样`, `${mtc.missing.length} to buy`)}
                            </div>
                          </div>
                          <span style={{ color: 'var(--portal-muted)' }}>›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* 进货:拍一拍(复用现有相机)或手动加一样 */}
              {showAdd
                ? <AddForm onAdded={() => { setShowAdd(false); reload(); }} onCancel={() => setShowAdd(false)} onError={setErr} t={t} />
                : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-cooking-camera'))} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconCamera size={14} />{t('拍一拍进货', 'Snap to stock up')}</button>
                    <button type="button" onClick={() => { setShowAdd(true); setErr(''); }} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconBox size={14} />{t('手动加一样', 'Add by hand')}</button>
                  </div>
                )}

              {/* 库存清单 */}
              <section>
                <p style={sectLabel}>{t('家里有的', 'On hand')} {items.length > 0 ? `· ${items.length}` : ''}</p>
                <div style={cardStyle}>
                  {items.length === 0 && (
                    <p style={{ ...mutedRow, lineHeight: 1.6 }}>
                      {t('还没记库存。点上面「进货」加一样 —— 之后就能看到「快过期先用」「手上能做什么」。',
                        'Pantry is empty. Add something above — then you’ll see what’s expiring and what you can cook.')}
                    </p>
                  )}
                  {items.map((it, i) => (
                    <div key={it.id} style={{ ...rowStyle, borderBottom: i === items.length - 1 ? 'none' : rowStyle.borderBottom }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{qtyName(it)}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: it.daysLeft != null && it.daysLeft <= 2 ? 'var(--status-gentle)' : 'var(--portal-muted)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                          {it.category && <span>{it.category}</span>}
                          {it.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconMapPin size={10} />{it.location}</span>}
                          {it.daysLeft != null && <span>{freshLabel(it.daysLeft, t)}</span>}
                        </div>
                      </div>
                      <button type="button" onClick={() => void consume(it.id)} disabled={busyId === it.id + 'use'} style={ghostBtn}>{t('用掉一份', 'Use one')}</button>
                      <button type="button" onClick={() => void remove(it.id)} disabled={busyId === it.id + 'del'} aria-label={t('删除', 'Remove')} style={{ border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' }}>✕</button>
                    </div>
                  ))}
                </div>
              </section>

              {/* 购物清单(反向闭环:缺料 → 清单 → 到店勾选 → 回流库存)。它是一条「记忆」,可搜、随云走。 */}
              {shopping.length > 0 && (
                <section>
                  <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconCheckSquare size={12} />{t('购物清单', 'Shopping list')} · {shopping.length}</p>
                  <div style={cardStyle}>
                    {shopping.map((s, i) => (
                      <div key={s.name} style={{ ...rowStyle, borderBottom: i === shopping.length - 1 ? 'none' : rowStyle.borderBottom }}>
                        <button type="button" onClick={() => toggleShop(s.name, !s.checked)} aria-label={s.checked ? t('取消勾选', 'Uncheck') : t('勾上', 'Check')}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: s.checked ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                          {s.checked ? <IconCheckSquare size={20} /> : <span style={{ width: 18, height: 18, borderRadius: 4, border: '1.6px solid var(--portal-line)', display: 'inline-block' }} />}
                        </button>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', textDecoration: s.checked ? 'line-through' : 'none', color: s.checked ? 'var(--portal-muted)' : 'var(--portal-ink)' }}>{s.name}</span>
                        <button type="button" onClick={() => removeShop(s.name)} aria-label={t('删除', 'Remove')} style={{ border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <button type="button" onClick={checkout} disabled={shopChecked === 0} style={{ ...primaryBtn, opacity: shopChecked === 0 ? 0.6 : 1 }}>{t('买到的 → 回流库存', 'Bought → into pantry')}</button>
                    {shopMsg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>{shopMsg}</span>}
                  </div>
                </section>
              )}

              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 0 }}>
                {t('库存只在你自己的图谱里,随你的云备份走,不共享给别人。快到期会在今天页轻轻提醒你先用掉。',
                  'Your pantry lives in your own graph and syncs to your cloud only. Nesio nudges you to use things before they expire.')}
              </p>
            </>
          )}
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 菜谱详情 ──────────────────────────────────────────────────────────────────
function RecipeDetail({ match, onAddToShopping, shopMsg, t }: {
  match: RecipeMatch<Recipe>; onAddToShopping: (names: string[]) => void; shopMsg: string; t: (a: string, b: string) => string;
}) {
  const r = match.recipe;
  const img = recipeImageUrl(r.image);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {img
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" style={{ width: '100%', maxHeight: '34vh', objectFit: 'cover', borderRadius: 'var(--radius-md)' }} draggable={false} />
        : <div style={{ width: '100%', height: 120, borderRadius: 'var(--radius-md)', background: 'var(--portal-accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--portal-accent)' }}><IconUtensils size={32} /></div>}

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{r.category} · {match.canCook ? t('手上就能做', 'ready to cook') : t(`还缺 ${match.missing.length} 样`, `${match.missing.length} to buy`)}</div>

      {match.have.length > 0 && (
        <div>
          <p style={sectLabel}>{t('你有的', 'You have')}</p>
          <div style={chipWrap}>{match.have.map((n) => <span key={n} style={{ ...chip, ...chipHave }}>{n}</span>)}</div>
        </div>
      )}
      {match.missing.length > 0 && (
        <div>
          <p style={sectLabel}>{t('还缺', 'Still need')}</p>
          <div style={chipWrap}>{match.missing.map((n) => <span key={n} style={{ ...chip, ...chipMiss }}>{n}</span>)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={() => onAddToShopping(match.missing)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconCheckSquare size={14} />{t('把缺的加进购物清单', 'Add missing to shopping list')}</button>
            {shopMsg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>{shopMsg}</span>}
          </div>
        </div>
      )}
      {match.staples.length > 0 && (
        <div>
          <p style={sectLabel}>{t('常备调料', 'Staples')}</p>
          <div style={chipWrap}>{match.staples.map((n) => <span key={n} style={{ ...chip, color: 'var(--portal-muted)' }}>{n}</span>)}</div>
        </div>
      )}

      <section>
        <p style={sectLabel}>{t('做法', 'Steps')}</p>
        <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              <span style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', display: 'grid', placeItems: 'center', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>{i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 'var(--space-2) 0 0' }}>
          {t('步骤里的克数是餐厅出餐量,自家做按人数缩着来。', 'Amounts are restaurant-batch sizes — scale down for home.')}
        </p>
      </section>
    </div>
  );
}

// ── 进货表单 ──────────────────────────────────────────────────────────────────
function AddForm({ onAdded, onCancel, onError, t }: {
  onAdded: () => void; onCancel: () => void; onError: (m: string) => void; t: (a: string, b: string) => string;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [expiry, setExpiry] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  function submit() {
    if (!name.trim()) { onError(t('先给它起个名字。', 'Give it a name first.')); return; }
    setBusy(true);
    try {
      const q = Number(qty);
      addPantry({ name: name.trim(), quantity: qty.trim() && Number.isFinite(q) ? q : undefined, expiry: expiry || undefined, location: location.trim() || undefined, category: category || undefined });
      onAdded();
    } catch { onError(t('没加上,再试一次。', 'Could not add — try again.')); setBusy(false); }
  }

  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <input style={inputStyle} placeholder={t('食材(如「牛奶」「菠菜」)', 'Food (e.g. milk, spinach)')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input style={{ ...inputStyle, flex: 1 }} inputMode="numeric" placeholder={t('数量(可空)', 'Qty (optional)')} value={qty} onChange={(e) => setQty(e.target.value)} />
        <input style={{ ...inputStyle, flex: 1 }} type="date" aria-label={t('有效期', 'Expiry')} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <input style={inputStyle} placeholder={t('放哪(如「冰箱」,可空)', 'Where (e.g. fridge, optional)')} value={location} onChange={(e) => setLocation(e.target.value)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {PANTRY_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory((v) => (v === c ? '' : c))}
            style={{ ...chip, ...(category === c ? chipOn : {}) }}>{c}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>{busy ? t('加入中…', 'Adding…') : t('加进库存', 'Add to pantry')}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}

// ── 小工具 ────────────────────────────────────────────────────────────────────
function RecipeThumb({ image }: { image: string | null }) {
  const url = recipeImageUrl(image);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={44} height={44} style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover', flex: 'none' }} draggable={false} />;
  }
  return <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', display: 'grid', placeItems: 'center', flex: 'none' }}><IconUtensils size={20} /></span>;
}
function qtyName(it: PantryItem): string {
  return it.quantity != null && it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name;
}
function freshLabel(daysLeft: number | null, t: (a: string, b: string) => string): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return t('过了保质期 · 看看还能不能用', 'Past date · check if still good');
  if (daysLeft === 0) return t('今天到期 · 今天用掉', 'Due today · use today');
  if (daysLeft === 1) return t('还有 1 天', '1 day left');
  return t(`还有 ${daysLeft} 天`, `${daysLeft} days left`);
}

function ErrorRow({ msg, onRetry, t }: { msg: string; onRetry: () => void; t: (a: string, b: string) => string }) {
  return (
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{msg}</span>
      <button type="button" onClick={onRetry} style={ghostBtn}>{t('重试', 'Retry')}</button>
    </div>
  );
}

const backBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, cursor: 'pointer', minWidth: 44, padding: 'var(--space-1)' };
const cardStyle: React.CSSProperties = { background: 'var(--portal-bg)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderBottom: '1px solid var(--portal-line)' };
const mutedRow: React.CSSProperties = { ...rowStyle, borderBottom: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' };
const sectLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, margin: '0 0 var(--space-2)' };
const primaryBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent)', color: '#fff', fontWeight: 'var(--weight-semibold)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontWeight: 'var(--weight-medium)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };
const chipWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' };
const chip: React.CSSProperties = { border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'default', fontFamily: 'var(--font-sans)' };
const chipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 'var(--weight-semibold)' as unknown as number, cursor: 'pointer' };
const chipHave: React.CSSProperties = { background: 'var(--status-go-soft)', color: 'var(--status-go)', borderColor: 'transparent' };
const chipMiss: React.CSSProperties = { background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)', borderColor: 'transparent' };
