'use client';

/**
 * CookingSheet — 做饭 / 库存(workshop 第二张脸)。「一张图,多张脸」:食材=生活图谱 object 节点,
 * 想做/购物清单=记忆节点,相机=拍一拍,营养=本地成分表查表,全复用,不重复造车轮。
 *
 * 视觉严格对齐 workshop 视觉稿(屏1-5):左对齐大标题 + 副标题 + 「‹返回」;白色抬起卡片(--portal-card
 * + shadow-card);快过期横向卡;用手上的能做=圆点 + 理由 + 状态 pill;营养每份四列;缺料闭环。
 * 主线全免费·确定性;云生成是 Pro 点缀。每个异步动作有显式失败态;全用设计 token、无 emoji、线性图标。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import NesioMark from '../NesioMark';
import { IconMapPin, IconCamera, IconCheckSquare, IconZap, IconChevronRight, IconSnowflake } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, consumePantry, removePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';
import { normalizeIngredient } from '@/lib/cooking/food-catalog';
import { loadRecipes, type Recipe } from '@/lib/cooking/food-data';
import { matchRecipe, matchRecipes, type RecipeMatch } from '@/lib/cooking/recipe-match';
import { getShoppingList, addToShopping, toggleShoppingItem, removeShoppingItem, checkoutBought, type ShoppingItem } from '@/lib/cooking/shopping';
import { recipeNutritionPerServing, recipeMainNutrition, type PerServing, type FoodNutrition } from '@/lib/cooking/nutrition';
import { getWishlist, addWish, removeWish, type WishDish } from '@/lib/cooking/wishlist';

type View =
  | { kind: 'home' }
  | { kind: 'pantry' }
  | { kind: 'wishlist' }
  | { kind: 'recipe'; match: RecipeMatch<Recipe> }
  | { kind: 'needs'; match: RecipeMatch<Recipe>; from: 'home' | 'wishlist' | 'recipe' };

export default function CookingSheet({ open, onClose, initialView, onExitTo }: {
  open: boolean; onClose: () => void;
  initialView?: 'home' | 'pantry' | 'wishlist';
  onExitTo?: (target: 'today' | 'capture' | 'insights' | 'chat') => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const t = useCallback((zh: string, en: string) => L(dict, zh, en), [dict]);

  const [items, setItems] = useState<PantryItem[]>([]);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>({ kind: 'home' });
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [recipesErr, setRecipesErr] = useState(false);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [wishes, setWishes] = useState<WishDish[]>([]);
  const camInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    try { setItems(listPantry()); } catch { setErr(t('读不出库存,刷新看看。', 'Could not read the pantry — refresh.')); }
    try { setShopping(getShoppingList()?.items ?? []); } catch { /* 购物清单读不出不致命 */ }
    try { setWishes(getWishlist()); } catch { /* 想做清单读不出不致命 */ }
  }, [t]);
  useEffect(() => { if (open) { reload(); setView({ kind: initialView ?? 'home' }); } }, [open, reload, initialView]);

  const loadRec = useCallback(() => {
    setRecipesErr(false);
    loadRecipes().then(setRecipes).catch(() => setRecipesErr(true));
  }, []);
  useEffect(() => { if (open && recipes === null && !recipesErr) loadRec(); }, [open, recipes, recipesErr, loadRec]);

  const soon = useMemo(() => expiringPantry(items, 4), [items]);
  const soonNames = useMemo(() => new Set(soon.map((i) => normalizeIngredient(i.name).name).filter(Boolean)), [soon]);
  const pantryNames = useMemo(() => new Set(items.map((i) => normalizeIngredient(i.name).name).filter(Boolean)), [items]);
  const matches = useMemo(
    () => (recipes && pantryNames.size ? matchRecipes(recipes, pantryNames, normalizeIngredient, { onlyWithPantry: true }).slice(0, 12) : []),
    [recipes, pantryNames],
  );

  const setTopView = useCallback((k: 'home' | 'pantry' | 'wishlist') => { setErr(''); setView({ kind: k }); }, []);
  const openCamera = useCallback(() => camInputRef.current?.click(), []);
  const onCamFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) window.dispatchEvent(new CustomEvent('nesio-open-cooking-camera', { detail: { file: f } }));
  }, []);

  const computeNeeds = useCallback((dishName: string, from: 'wishlist' | 'home' | 'recipe') => {
    if (!recipes) return;
    const r = recipes.find((x) => x.name === dishName)
      ?? recipes.find((x) => x.name.includes(dishName) || dishName.includes(x.name));
    if (!r) { setErr(t(`菜谱库里还没有「${dishName}」,先加进库存或换一道。`, `No recipe for "${dishName}" yet — add pantry items or pick another.`)); return; }
    setErr('');
    setView({ kind: 'needs', match: matchRecipe(r, pantryNames, normalizeIngredient), from });
  }, [recipes, pantryNames, t]);

  const consume = useCallback(async (id: string) => {
    setErr('');
    try { if (!consumePantry(id)) setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    catch { setErr(t('没扣上,再试一次。', 'Could not update — try again.')); }
    reload();
  }, [t, reload]);
  const remove = useCallback((id: string) => {
    setErr('');
    try { if (!removePantry(id)) setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    catch { setErr(t('没删成,再试一次。', 'Could not remove — try again.')); }
    reload();
  }, [t, reload]);

  if (!open) return null;

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('做饭 · 库存', 'Cooking · Pantry')} className="cooking-skin">
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onCamFile} />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

            {view.kind === 'home' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} title={t('做饭', 'Cooking')} subtitle={t('冰箱里还有这些', 'Here’s what’s in the fridge')} />
                <SubTabs active="home" onSelect={setTopView} t={t} />
                <HomeBody
                  soon={soon} matches={matches} recipes={recipes} recipesErr={recipesErr} soonNames={soonNames}
                  pantryCount={items.length} onLoadRec={loadRec} onOpenRecipe={(m) => setView({ kind: 'recipe', match: m })} t={t}
                />
              </>
            )}
            {view.kind === 'pantry' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} title={t('库存', 'Pantry')} />
                <SubTabs active="pantry" onSelect={setTopView} t={t} />
                <PantryBody items={items} shopping={shopping} onCamera={openCamera} onConsume={consume} onRemove={remove} onError={setErr} onChanged={reload} t={t} />
              </>
            )}
            {view.kind === 'wishlist' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} title={t('想做清单', 'Want to cook')} subtitle={t('想做的菜 · 先存这儿', 'Save what you want to make')} subtitleRight={wishes.length > 0 ? t(`${wishes.length} 道`, `${wishes.length}`) : undefined} />
                <SubTabs active="wishlist" onSelect={setTopView} t={t} />
                <WishlistBody wishes={wishes} onCompute={(n) => computeNeeds(n, 'wishlist')} onError={setErr} onChanged={reload} onCamera={openCamera} t={t} />
              </>
            )}
            {view.kind === 'recipe' && (
              <>
                <ScreenHead backLabel={t('做饭', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={view.match.recipe.name} />
                <RecipeBody match={view.match} soonNames={soonNames} onNeeds={() => setView({ kind: 'needs', match: view.match, from: 'recipe' })} t={t} />
              </>
            )}
            {view.kind === 'needs' && (
              <>
                <ScreenHead
                  backLabel={view.from === 'wishlist' ? t('想做清单', 'Want to cook') : view.from === 'recipe' ? view.match.recipe.name : t('做饭', 'Cooking')}
                  onBack={() => setView(view.from === 'wishlist' ? { kind: 'wishlist' } : view.from === 'recipe' ? { kind: 'recipe', match: view.match } : { kind: 'home' })}
                  title={view.match.recipe.name} />
                <NeedsBody match={view.match} onError={setErr} onDone={() => setView({ kind: 'home' })} t={t} />
              </>
            )}
          </div>
        </div>
        <CookingBottomNav locale={dict} onToday={() => (onExitTo ? onExitTo('today') : onClose())} onCapture={() => (onExitTo ? onExitTo('capture') : onClose())} onInsights={() => (onExitTo ? onExitTo('insights') : onClose())} onChat={() => onExitTo?.('chat')} t={t} />
      </div>
    </NesioSheet>
  );
}

// ── 屏1 做饭首页 ──────────────────────────────────────────────────────────────
function HomeBody({ soon, matches, recipes, recipesErr, soonNames, pantryCount, onLoadRec, onOpenRecipe, t }: {
  soon: PantryItem[]; matches: RecipeMatch<Recipe>[]; recipes: Recipe[] | null; recipesErr: boolean; soonNames: Set<string>;
  pantryCount: number; onLoadRec: () => void; onOpenRecipe: (m: RecipeMatch<Recipe>) => void; t: TT;
}) {
  const anyReady = matches.some((m) => m.canCook);
  return (
    <>
      {/* 快过期 · 先用掉 —— 横向白卡 + 琥珀 pill,别浪费 */}
      {soon.length > 0 && (
        <section>
          <SectionHead label={t('快过期 · 先用掉', 'Use these first')} right={t('别浪费', 'Don’t waste it')} />
          <div style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', paddingBottom: 'var(--space-1)', margin: '0 calc(-1 * var(--space-4))', padding: '0 var(--space-4) var(--space-1)', scrollSnapType: 'x proximity' }}>
            {soon.slice(0, 6).map((it) => (
              <div key={it.id} style={{ flex: 'none', width: 118, scrollSnapAlign: 'start', ...card, padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)', alignSelf: 'flex-start' }}>{daysPill(it.daysLeft, t)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 用手上的能做 —— 圆点 + 理由 + 状态 pill */}
      <section>
        <SectionHead label={t('用手上的能做', 'Cook with what you have')} right={anyReady ? t('免费 · 材料齐了', 'Free · ready') : undefined} rightGo />
        {recipesErr && <ErrorRow msg={t('菜谱没载出来。', 'Recipes didn’t load.')} onRetry={onLoadRec} t={t} />}
        {!recipesErr && recipes === null && <p style={hintLine}>{t('翻翻菜谱…', 'Looking through recipes…')}</p>}
        {!recipesErr && recipes !== null && matches.length === 0 && (
          <div style={{ ...card, padding: 'var(--space-4)' }}>
            <p style={{ ...hintLine, padding: 0, lineHeight: 1.6 }}>{pantryCount === 0
              ? t('先去「库存」加两样,这里就冒出「手上能做的菜」。', 'Add a couple of things to the pantry and cookable dishes appear here.')
              : t('现有的还凑不齐一道菜,再补两样试试。', 'Not quite enough for a dish yet — add a couple more.')}</p>
          </div>
        )}
        {matches.length > 0 && (
          <div style={card}>
            {matches.map((m, i) => (
              <button key={m.recipe.name} type="button" onClick={() => onOpenRecipe(m)}
                style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === matches.length - 1 ? 'none' : divider, cursor: 'pointer' }}>
                <Dot />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.recipe.name}</div>
                  <div style={subText}>{recipeReason(m, soonNames, t)}</div>
                </div>
                {m.canCook
                  ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('材料齐', 'Ready')}</span>
                  : <span style={{ ...pill, background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{t(`缺 ${m.missing.length} 样`, `${m.missing.length} to buy`)}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 生成新菜谱(Pro) */}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'cooking_recipe_ai' } }))}
        style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <IconZap size={16} />{t('生成新菜谱', 'Generate a recipe')}
        <span style={{ ...pill, background: 'rgba(255,255,255,.22)', color: '#fff', marginLeft: 'var(--space-1)' }}>Pro</span>
      </button>
    </>
  );
}

// ── 屏2 库存 ──────────────────────────────────────────────────────────────────
function PantryBody({ items, shopping, onCamera, onConsume, onRemove, onError, onChanged, t }: {
  items: PantryItem[]; shopping: ShoppingItem[]; onCamera: () => void; onConsume: (id: string) => void; onRemove: (id: string) => void;
  onError: (m: string) => void; onChanged: () => void; t: TT;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [shopMsg, setShopMsg] = useState('');
  const soon = useMemo(() => items.filter((i) => i.daysLeft != null && i.daysLeft <= 4), [items]);
  const soonIds = useMemo(() => new Set(soon.map((i) => i.id)), [soon]);
  const rest = useMemo(() => items.filter((i) => !soonIds.has(i.id)), [items, soonIds]);
  const shopChecked = shopping.filter((s) => s.checked).length;

  function toggleShop(name: string, checked: boolean) { try { toggleShoppingItem(name, checked); onChanged(); } catch { onError(t('没记上,再试一次。', 'Could not update — try again.')); } }
  function removeShop(name: string) { try { removeShoppingItem(name); onChanged(); } catch { onError(t('没删成,再试一次。', 'Could not remove — try again.')); } }
  function checkout() {
    try {
      const n = checkoutBought(); onChanged();
      setShopMsg(n > 0 ? t(`回流 ${n} 样进库存`, `${n} back in pantry`) : t('先勾上买到的', 'Check what you bought first'));
      setTimeout(() => setShopMsg(''), 1800);
    } catch { onError(t('没回流成,再试一次。', 'Could not update pantry — try again.')); }
  }

  return (
    <>
      {showAdd
        ? <AddForm onAdded={() => { setShowAdd(false); onChanged(); }} onCancel={() => setShowAdd(false)} onError={onError} t={t} />
        : <button type="button" onClick={onCamera} style={{ ...card, padding: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', cursor: 'pointer', color: 'var(--portal-ink)', fontWeight: 600, fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' }}>
            <IconCamera size={16} />{t('拍小票入库 · 或手动添加', 'Snap a receipt · or add by hand')}
          </button>}
      {!showAdd && <button type="button" onClick={() => setShowAdd(true)} style={{ ...ghostBtn, alignSelf: 'flex-start', marginTop: 'calc(-1 * var(--space-3))' }}>{t('手动添加', 'Add by hand')}</button>}

      {items.length === 0 && !showAdd && (
        <p style={{ ...hintLine, lineHeight: 1.6 }}>
          {t('还没记库存。拍张小票或手动加一样 —— 之后「快过期先用」「手上能做什么」就都有了。',
            'Pantry is empty. Snap a receipt or add by hand — then expiry nudges and cookable dishes appear.')}
        </p>
      )}

      {soon.length > 0 && (
        <section>
          <SectionHead label={t('快过期', 'Expiring soon')} right={t(`${soon.length} 项`, `${soon.length}`)} />
          <div style={card}>
            {soon.map((it, i) => <PantryRow key={it.id} it={it} last={i === soon.length - 1} soon onConsume={onConsume} onRemove={onRemove} t={t} />)}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <SectionHead label={t('充足', 'Well stocked')} />
          <div style={card}>
            {rest.map((it, i) => <PantryRow key={it.id} it={it} last={i === rest.length - 1} soon={false} onConsume={onConsume} onRemove={onRemove} t={t} />)}
          </div>
        </section>
      )}

      {/* 购物清单闭环:缺料 → 记忆 → 到店勾选 → 回流库存 */}
      {shopping.length > 0 && (
        <section>
          <SectionHead label={t('购物清单', 'Shopping list')} right={t(`${shopping.length} 样`, `${shopping.length}`)} />
          <div style={card}>
            {shopping.map((s, i) => (
              <div key={s.name} style={{ ...row, borderBottom: i === shopping.length - 1 ? 'none' : divider }}>
                <button type="button" onClick={() => toggleShop(s.name, !s.checked)} aria-label={s.checked ? t('取消勾选', 'Uncheck') : t('勾上', 'Check')}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: s.checked ? 'var(--status-go)' : 'var(--portal-muted)' }}>
                  {s.checked ? <IconCheckSquare size={20} /> : <span style={{ width: 18, height: 18, borderRadius: 4, border: '1.6px solid var(--portal-line)', display: 'inline-block' }} />}
                </button>
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', textDecoration: s.checked ? 'line-through' : 'none', color: s.checked ? 'var(--portal-muted)' : 'var(--portal-ink)' }}>{s.name}</span>
                <button type="button" onClick={() => removeShop(s.name)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button type="button" onClick={checkout} disabled={shopChecked === 0} style={{ ...primaryBtn, opacity: shopChecked === 0 ? 0.55 : 1 }}>{t('买到的 → 回流库存', 'Bought → into pantry')}</button>
            {shopMsg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>{shopMsg}</span>}
          </div>
        </section>
      )}

      <p style={caption}>{t('库存只在你自己的图谱里,随你的云备份走,不共享给别人。', 'Your pantry lives in your own graph and syncs to your cloud only.')}</p>
    </>
  );
}

function PantryRow({ it, last, soon, onConsume, onRemove, t }: { it: PantryItem; last: boolean; soon: boolean; onConsume: (id: string) => void; onRemove: (id: string) => void; t: TT }) {
  const frozen = it.category === '冷冻';
  return (
    <div style={{ ...row, borderBottom: last ? 'none' : divider }}>
      <Dot />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-body)', fontWeight: 600 }}>{qtyName(it)}</div>
        <div style={{ ...subText, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {it.addedAt ? <span>{buyLabel(it.addedAt, t)}</span> : it.category ? <span>{it.category}</span> : null}
          {it.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconMapPin size={10} />{it.location}</span>}
        </div>
      </div>
      {soon
        ? <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{daysPill(it.daysLeft, t)}</span>
        : frozen
          ? <span style={{ ...pill, background: 'var(--status-calm-soft)', color: 'var(--status-calm)', display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconSnowflake size={11} />{t('冷冻', 'Frozen')}</span>
          : <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('充足', 'Stocked')}</span>}
      <button type="button" onClick={() => void onConsume(it.id)} style={ghostBtn}>{t('用掉', 'Use')}</button>
      <button type="button" onClick={() => void onRemove(it.id)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
    </div>
  );
}

// ── 屏4 想做清单 ──────────────────────────────────────────────────────────────
function WishlistBody({ wishes, onCompute, onError, onChanged, onCamera, t }: {
  wishes: WishDish[]; onCompute: (name: string) => void; onError: (m: string) => void; onChanged: () => void; onCamera: () => void; t: TT;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  function add() {
    const nm = name.trim();
    if (!nm) { setAdding(false); return; }
    try { addWish(nm); setName(''); setAdding(false); onChanged(); }
    catch { onError(t('没加上,再试一次。', 'Could not add — try again.')); }
  }
  function drop(nm: string) { try { removeWish(nm); onChanged(); } catch { onError(t('没删成,再试一次。', 'Could not remove — try again.')); } }

  return (
    <>
      {wishes.length === 0 && !adding
        ? <p style={{ ...hintLine, lineHeight: 1.6 }}>{t('想做的菜先攒着 —— 朋友推荐的、刷到的、想给家人做的。选一道就能算「还缺什么」。', 'Save dishes you want to make — then pick one to see what’s missing.')}</p>
        : (
          <div style={card}>
            {wishes.map((w, i) => (
              <div key={w.name} style={{ ...row, borderBottom: i === wishes.length - 1 ? 'none' : divider }}>
                <Dot />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 600 }}>{w.name}</div>
                  {w.note && <div style={subText}>{w.note}</div>}
                </div>
                <button type="button" onClick={() => onCompute(w.name)} style={i === 0 ? primaryBtn : ghostBtn}>{t('算缺料', 'What’s missing')}</button>
                <button type="button" onClick={() => drop(w.name)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
        )}

      {adding
        ? <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder={t('菜名(如「番茄炒蛋」)', 'Dish (e.g. tomato & egg)')} value={name} autoFocus
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" onClick={add} style={primaryBtn}>{t('加进来', 'Add')}</button>
          </div>
        : <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => setAdding(true)} style={{ ...ghostBtn, flex: 1, padding: 'var(--space-3)', fontSize: 'var(--text-body)' }}>+ {t('搜个菜', 'Search a dish')}</button>
            <button type="button" onClick={onCamera} aria-label={t('拍一张加进来', 'Snap to add')} style={{ ...ghostBtn, padding: 'var(--space-3)' }}><IconCamera size={16} /></button>
          </div>}
      <p style={caption}>{t('浏览、朋友推荐、拍一张都能加进来 —— 直接复用「记忆」,随云走。', 'Add from browsing, a friend, or a photo — stored as a memory, synced to your cloud.')}</p>
    </>
  );
}

// ── 屏3 菜谱详情 ──────────────────────────────────────────────────────────────
function RecipeBody({ match, soonNames, onNeeds, t }: { match: RecipeMatch<Recipe>; soonNames: Set<string>; onNeeds: () => void; t: TT }) {
  const r = match.recipe;
  const [per, setPer] = useState<PerServing | null>(null);
  const [main, setMain] = useState<FoodNutrition[] | null>(null);
  useEffect(() => {
    let live = true;
    recipeNutritionPerServing(r.quantities).then((p) => { if (live) setPer(p); }).catch(() => { if (live) setPer(null); });
    recipeMainNutrition(r.ingredients).then((m) => { if (live) setMain(m); }).catch(() => { if (live) setMain([]); });
    return () => { live = false; };
  }, [r.quantities, r.ingredients]);

  return (
    <>
      {/* 绿色横幅:材料齐 → 就能做;缺料 → 去缺料屏 */}
      {match.canCook
        ? <div style={{ ...banner, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{recipeReason(match, soonNames, t)}</div>
        : <button type="button" onClick={onNeeds} style={{ ...banner, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)', border: 'none', cursor: 'pointer', width: '100%', justifyContent: 'space-between', textAlign: 'left' }}>
            <span>{t(`还缺 ${match.missing.length} 样 · 看看要买什么`, `${match.missing.length} to buy · plan the shopping`)}</span><IconChevronRight size={16} />
          </button>}

      <section>
        <SectionHead label={t('步骤', 'Steps')} />
        <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              <span style={stepNum}>{i + 1}</span><span style={{ paddingTop: 2 }}>{s}</span>
            </div>
          ))}
        </div>
        <p style={caption}>{t('步骤里的克数是餐厅出餐量,自家做按人数缩着来。', 'Amounts are restaurant-batch sizes — scale down for home.')}</p>
      </section>

      {/* 营养 · 每份 · 四列 */}
      <section>
        <SectionHead label={t('营养', 'Nutrition')} right={t('每份', 'per serving')} rightGo={false} />
        {per
          ? <>
              <div style={{ ...card, display: 'flex', padding: 'var(--space-4) 0' }}>
                <NutriCol v={`${per.energyKCal}`} label={t('千卡', 'kcal')} />
                <NutriCol v={`${per.protein}g`} label={t('蛋白', 'Protein')} />
                <NutriCol v={`${per.cho}g`} label={t('碳水', 'Carbs')} />
                <NutriCol v={`${per.fat}g`} label={t('脂肪', 'Fat')} last />
              </div>
              <p style={caption}>{t(`估算 · 约 ${per.servings} 份 · 基于《中国食物成分表》查表 + 用量加法,非精确值。`, `Estimate · ≈${per.servings} servings · China Food Composition Table + arithmetic, not exact.`)}</p>
            </>
          : main && main.length > 0
            ? <>
                <div style={card}>
                  {main.map((f, i) => (
                    <div key={f.foodName} style={{ ...row, borderBottom: i === main.length - 1 ? 'none' : divider }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.foodName}</span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{Math.round(f.energyKCal)} kcal · {t('蛋白', 'P')} {f.protein}g</span>
                    </div>
                  ))}
                </div>
                <p style={caption}>{t('每100g 可食部 · 部分食材名对不齐时只显对上的,基于《中国食物成分表》,估算。', 'Per 100g edible · from China Food Composition Table, estimate.')}</p>
              </>
            : <p style={hintLine}>{main === null ? t('查营养中…', 'Looking up nutrition…') : t('这道菜的食材名暂时对不齐成分表,先不显示假数。', 'Ingredient names don’t line up with the table yet — no fake numbers.')}</p>}
      </section>

      {/* 配饮(Pro) */}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'cooking_pairing_ai' } }))}
        style={{ ...card, padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'left', cursor: 'pointer' }}>
        <Dot />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 'var(--text-body)', fontWeight: 600 }}>{t('配个饮 · 搭配建议', 'Pair a drink · suggestions')}</span>
          <span style={{ display: 'block', ...subText }}>{t('云生成 · 按口味给搭配', 'Cloud · tailored to the dish')}</span>
        </span>
        <span style={{ ...pill, background: 'var(--portal-accent)', color: '#fff' }}>Pro</span>
      </button>
    </>
  );
}

// ── 屏5 缺料 ──────────────────────────────────────────────────────────────────
function NeedsBody({ match, onError, onDone, t }: { match: RecipeMatch<Recipe>; onError: (m: string) => void; onDone: () => void; t: TT }) {
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  function save() {
    try { addToShopping(match.missing); setSaved(true); setMsg(t(`存了 ${match.missing.length} 样进「记忆」`, `${match.missing.length} saved to memory`)); setTimeout(onDone, 900); }
    catch { onError(t('没存上,再试一次。', 'Could not save — try again.')); }
  }
  const rows = [...match.have.map((n) => ({ n, have: true })), ...match.missing.map((n) => ({ n, have: false }))];
  return (
    <>
      <div style={{ ...banner, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('家庭份 · 已把餐厅用量缩放到家庭份', 'Scaled a restaurant portion down to a home serving')}</div>

      <section>
        <SectionHead label={t('需要这些', 'You’ll need')} right={t('对照你的库存', 'vs your pantry')} />
        <div style={card}>
          {rows.map((r, i) => (
            <div key={r.n} style={{ ...row, borderBottom: i === rows.length - 1 && match.staples.length === 0 ? 'none' : divider }}>
              <Dot />
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', fontWeight: 600 }}>{r.n}</span>
              {r.have
                ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('有', 'Have')}</span>
                : <span style={{ ...pill, background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{t('缺 · 要买', 'Buy')}</span>}
            </div>
          ))}
          {match.staples.length > 0 && (
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('常备(盐/油等,默认你有)', 'Staples (salt/oil, assumed on hand)')}: {match.staples.join(' · ')}</span>
            </div>
          )}
        </div>
      </section>

      {match.missing.length > 0 ? (
        <>
          <button type="button" onClick={save} disabled={saved} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', opacity: saved ? 0.55 : 1 }}>
            {t(`把缺的 ${match.missing.length} 样 · 存进「记忆」当购物清单`, `Save the ${match.missing.length} missing to your shopping list`)}
          </button>
          {msg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
          <p style={caption}>{t('到超市按清单勾一勾;买回自动进库存 —— 闭环。', 'Check items off at the store; what you buy flows back into the pantry — full loop.')}</p>
        </>
      ) : (
        <p style={{ ...hintLine, color: 'var(--status-go)' }}>{t('都齐了 · 直接开做。', 'All set — cook it now.')}</p>
      )}
    </>
  );
}

// ── 进货表单 ──────────────────────────────────────────────────────────────────
function AddForm({ onAdded, onCancel, onError, t }: { onAdded: () => void; onCancel: () => void; onError: (m: string) => void; t: TT }) {
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
    <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <input style={inputStyle} placeholder={t('食材(如「牛奶」「菠菜」)', 'Food (e.g. milk, spinach)')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input style={{ ...inputStyle, flex: 1 }} inputMode="numeric" placeholder={t('数量(可空)', 'Qty (optional)')} value={qty} onChange={(e) => setQty(e.target.value)} />
        <input style={{ ...inputStyle, flex: 1 }} type="date" aria-label={t('有效期', 'Expiry')} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <input style={inputStyle} placeholder={t('放哪(如「冰箱」,可空)', 'Where (e.g. fridge, optional)')} value={location} onChange={(e) => setLocation(e.target.value)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {PANTRY_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory((v) => (v === c ? '' : c))} style={{ ...chip, ...(category === c ? chipOn : {}) }}>{c}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>{busy ? t('加入中…', 'Adding…') : t('加进库存', 'Add to pantry')}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}

// ── 结构件 & 小工具 ───────────────────────────────────────────────────────────
type TT = (zh: string, en: string) => string;

function ScreenHead({ backLabel, onBack, title, subtitle, subtitleRight }: { backLabel: string; onBack: () => void; title: string; subtitle?: string; subtitleRight?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <button type="button" onClick={onBack} style={backLink}>‹ {backLabel}</button>
      <h1 style={{ margin: 0, fontSize: 'var(--text-h1)', fontWeight: 700, lineHeight: 1.15, color: 'var(--portal-ink)' }}>{title}</h1>
      {subtitle && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{subtitle}</span>
          {subtitleRight && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{subtitleRight}</span>}
        </div>
      )}
    </div>
  );
}
function SectionHead({ label, right, rightGo }: { label: string; right?: string; rightGo?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)', margin: '0 0 var(--space-3)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', fontWeight: 600 }}>{label}</span>
      {right && <span style={{ fontSize: 'var(--text-xs)', color: rightGo ? 'var(--status-go)' : 'var(--portal-muted)', fontWeight: 600 }}>{right}</span>}
    </div>
  );
}
/** 做饭内部子 tab:做饭 / 库存 / 想做清单(在洞察下,做饭的子导航)。 */
function SubTabs({ active, onSelect, t }: { active: 'home' | 'pantry' | 'wishlist'; onSelect: (k: 'home' | 'pantry' | 'wishlist') => void; t: TT }) {
  const tabs: Array<{ k: 'home' | 'pantry' | 'wishlist'; label: string }> = [
    { k: 'home', label: t('做饭', 'Cook') },
    { k: 'pantry', label: t('库存', 'Pantry') },
    { k: 'wishlist', label: t('想做清单', 'Wishlist') },
  ];
  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
      {tabs.map((tb) => {
        const on = tb.k === active;
        return (
          <button key={tb.k} type="button" onClick={() => onSelect(tb.k)}
            style={{ flex: 1, border: 'none', borderRadius: 'var(--radius-pill)', padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: on ? 700 : 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: on ? 'var(--portal-card)' : 'transparent', color: on ? 'var(--portal-accent)' : 'var(--portal-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none' }}>
            {tb.label}
          </button>
        );
      })}
    </div>
  );
}

/** 底部导航 —— 复用 app 真导航(今天 / 记录 / 洞察),点了退出做饭跳对应页。洞察态高亮。 */
function CookingBottomNav({ onToday, onCapture, onInsights, onChat, t }: { locale: string; onToday: () => void; onCapture: () => void; onInsights: () => void; onChat: () => void; t: TT }) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = () => { fired.current = false; pressTimer.current = setTimeout(() => { fired.current = true; onChat(); }, 450); };
  const end = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } if (!fired.current) onCapture(); };
  const cancel = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  return (
    <nav style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-around', background: 'var(--portal-card)', borderTop: divider, padding: 'var(--space-2) var(--space-4)', paddingBottom: 'calc(var(--space-2) + env(safe-area-inset-bottom, 0px))' }}>
      <button type="button" onClick={onToday} aria-label={t('今天', 'Today')} style={navBtn(false)}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.25" /><path d="M12 7.5V12l3 2.2" /></svg>
        <span style={navLabel}>{t('今天', 'Today')}</span>
      </button>
      <button type="button" onPointerDown={start} onPointerUp={end} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}
        aria-label={t('记录 / 问一问', 'Capture / Ask')} style={{ border: 'none', background: 'var(--portal-accent)', width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-card)', marginTop: -18 }}>
        <NesioMark style={{ width: 26, height: 26 }} />
      </button>
      <button type="button" onClick={onInsights} aria-label={t('洞察', 'Insights')} style={navBtn(true)}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l3 5-9 13L3 8z" /><path d="M3 8h18M9 3 7.5 8 12 21M15 3l1.5 5L12 21" /></svg>
        <span style={navLabel}>{t('洞察', 'Insights')}</span>
      </button>
    </nav>
  );
}
function navBtn(active: boolean): React.CSSProperties {
  return { border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 'var(--space-1) var(--space-3)', color: active ? 'var(--portal-accent)' : 'var(--portal-muted)', fontFamily: 'var(--font-sans)' };
}
const navLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600 };
function NutriCol({ v, label, last }: { v: string; label: string; last?: boolean }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 var(--space-2)', borderRight: last ? 'none' : divider }}>
      <div style={{ fontSize: 'var(--text-h2)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--portal-ink)' }}>{v}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Dot() {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--portal-accent)', flex: 'none' }} />;
}
function qtyName(it: PantryItem): string {
  return it.quantity != null && it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name;
}
/** 「用手上的能做」行的理由句:优先「正好用掉快过期的 X+Y」,否则列有的料 / 缺 N 样。 */
function recipeReason(m: RecipeMatch<Recipe>, soonNames: Set<string>, t: TT): string {
  const useSoon = m.have.filter((n) => soonNames.has(n));
  if (useSoon.length > 0) return t(`正好用掉快过期的 ${useSoon.slice(0, 2).join(' + ')}`, `Uses up ${useSoon.slice(0, 2).join(' + ')} before it expires`);
  if (m.canCook) return t(`${m.have.slice(0, 2).join(' · ')} · 手上都有`, `${m.have.slice(0, 2).join(' · ')} · all on hand`);
  return t(`还缺 ${m.missing.length} 样`, `${m.missing.length} to buy`);
}
function daysPill(daysLeft: number | null, t: TT): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return t('过期', 'Past');
  if (daysLeft === 0) return t('今天', 'Today');
  return t(`${daysLeft} 天`, `${daysLeft}d`);
}
function buyLabel(addedAt: string, t: TT): string {
  const m = addedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const mo = Number(m[2]), d = Number(m[3]);
  return t(`${mo}月${d}日买入`, `bought ${mo}/${d}`);
}
function ErrorRow({ msg, onRetry, t }: { msg: string; onRetry: () => void; t: TT }) {
  return (
    <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{msg}</span>
      <button type="button" onClick={onRetry} style={ghostBtn}>{t('重试', 'Retry')}</button>
    </div>
  );
}

const divider = '1px solid var(--portal-line)';
const card: React.CSSProperties = { background: 'var(--portal-card)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', borderBottom: divider };
const subText: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginTop: 2 };
const hintLine: React.CSSProperties = { color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', margin: 0 };
const caption: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 'var(--space-1) 0 0' };
const banner: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, lineHeight: 1.5 };
const backLink: React.CSSProperties = { alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', padding: '0', fontFamily: 'var(--font-sans)' };
const stepNum: React.CSSProperties = { flex: 'none', width: 24, height: 24, borderRadius: '50%', background: 'var(--portal-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 'var(--text-xs)', fontWeight: 700 };
const pill: React.CSSProperties = { flex: 'none', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 600, padding: '3px var(--space-2)', whiteSpace: 'nowrap' };
const primaryBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent)', color: '#fff', fontWeight: 700, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontWeight: 600, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: divider, borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };
const chip: React.CSSProperties = { border: divider, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const chipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 700 };
