'use client';

/**
 * CookingSheet — 做饭 / 库存(workshop 第二张脸)。「一张图,多张脸」:食材=生活图谱 object 节点,
 * 想做/购物清单=记忆节点,相机=拍一拍,营养=本地成分表查表,全复用,不重复造车轮。
 *
 * 入口对齐记一物品(手动 + 小相机);做饭/想做清单去大标题;菜谱自选输入;记一餐相机先行。
 * 主线全免费·确定性;云生成是 Pro 点缀。每个异步动作有显式失败态;全用设计 token、无 emoji、线性图标。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { IconCamera, IconCheckSquare, IconZap, IconUtensils } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, removePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';
import { normalizeIngredient, CUISINES } from '@/lib/cooking/food-catalog';
import { loadRecipes, type Recipe } from '@/lib/cooking/food-data';
import { matchRecipe, matchRecipes, type RecipeMatch } from '@/lib/cooking/recipe-match';
import { getShoppingList, addToShopping, toggleShoppingItem, removeShoppingItem, checkoutBought, type ShoppingItem } from '@/lib/cooking/shopping';
import { recipeNutritionPerServing, recipeMainNutrition, lookupNutrition, type PerServing, type FoodNutrition } from '@/lib/cooking/nutrition';
import { getWishlist, addWish, type WishDish } from '@/lib/cooking/wishlist';
import { addMeal, type MealSource, type MealItem } from '@/lib/cooking/meals';
import { planWeek, type WeekPlan } from '@/lib/cooking/meal-plan-core';
import { saveGeneratedRecipe, findGeneratedRecipe } from '@/lib/cooking/generated-recipes';
import { canUsePaidCloudAi, guardPaidCloudAi } from '@/lib/portal/entitlement';

type View =
  | { kind: 'home' }
  | { kind: 'pantry' }
  | { kind: 'wishlist' }
  | { kind: 'recipe'; match: RecipeMatch<Recipe> }
  | { kind: 'needs'; match: RecipeMatch<Recipe>; from: 'home' | 'wishlist' | 'recipe' }
  | { kind: 'logmeal' }
  | { kind: 'plan' }
  | { kind: 'generate' };

export default function CookingSheet({ open, onClose, initialView }: {
  open: boolean; onClose: () => void;
  initialView?: 'home' | 'pantry' | 'wishlist';
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
  const mealCamRef = useRef<HTMLInputElement>(null);
  const [mealPhoto, setMealPhoto] = useState('');

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

  // 7 天窗:「快过期」要覆盖「这周内先用」的日常节奏(牛奶/叶菜常是 3–7 天),4 天太窄会漏。
  const soon = useMemo(() => expiringPantry(items, 7), [items]);
  const soonNames = useMemo(() => new Set(soon.map((i) => normalizeIngredient(i.name).name).filter(Boolean)), [soon]);
  const pantryNames = useMemo(() => new Set(items.map((i) => normalizeIngredient(i.name).name).filter(Boolean)), [items]);
  // 排周计划用更宽的候选集(含少量需采购),给一周排满。
  const planMatches = useMemo(
    () => (recipes && pantryNames.size ? matchRecipes(recipes, pantryNames, normalizeIngredient, { onlyWithPantry: true }).slice(0, 30) : []),
    [recipes, pantryNames],
  );

  const setTopView = useCallback((k: 'home' | 'pantry' | 'wishlist') => { setErr(''); setView({ kind: k }); }, []);
  const openCamera = useCallback(() => camInputRef.current?.click(), []);
  const onCamFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) window.dispatchEvent(new CustomEvent('nesio-open-cooking-camera', { detail: { file: f } }));
  }, []);
  /** 记一餐:点一下先开相机,拍好带图进记一餐页(页内不再放相机)。 */
  const startLogMeal = useCallback(() => { mealCamRef.current?.click(); }, []);
  const onMealCamFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setMealPhoto((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      try { return URL.createObjectURL(f); } catch { return ''; }
    });
    setErr('');
    setView({ kind: 'logmeal' });
  }, []);
  const finishLogMeal = useCallback(() => {
    setMealPhoto((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      return '';
    });
    setView({ kind: 'home' });
  }, []);

  const computeNeeds = useCallback((dishName: string, from: 'wishlist' | 'home' | 'recipe') => {
    const r = (recipes || []).find((x) => x.name === dishName)
      ?? (recipes || []).find((x) => x.name.includes(dishName) || dishName.includes(x.name))
      ?? findGeneratedRecipe(dishName);
    if (!r) { setErr(t(`菜谱库里还没有「${dishName}」,先加进库存或换一道。`, `No recipe for "${dishName}" yet — add pantry items or pick another.`)); return; }
    setErr('');
    setView({ kind: 'needs', match: matchRecipe(r, pantryNames, normalizeIngredient), from });
  }, [recipes, pantryNames, t]);

  // 想做清单点一道菜 → 目录/AI 生成库找到就打开菜谱详情。
  const openRecipeByName = useCallback((name: string) => {
    const r = (recipes || []).find((x) => x.name === name)
      ?? (recipes || []).find((x) => x.name.includes(name) || name.includes(x.name))
      ?? findGeneratedRecipe(name);
    if (!r) { setErr(t(`「${name}」还没有步骤(自定义菜)—— 之后可以自己补。`, `No steps for "${name}" yet (custom dish).`)); return; }
    setErr('');
    setView({ kind: 'recipe', match: matchRecipe(r, pantryNames, normalizeIngredient) });
  }, [recipes, pantryNames, t]);

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
      <input ref={mealCamRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onMealCamFile} />
      <div style={{ minHeight: '100%', background: 'transparent', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div>
          <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

            {view.kind === 'home' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} />
                <SubTabs active="home" onSelect={setTopView} t={t} />
                <HomeBody
                  soon={soon} recipes={recipes} recipesErr={recipesErr} soonNames={soonNames} pantryNames={pantryNames}
                  onLoadRec={loadRec} onOpenRecipe={(m) => setView({ kind: 'recipe', match: m })}
                  onLogMeal={startLogMeal} onCamera={openCamera}
                  onGenerate={() => {
                    if (!guardPaidCloudAi('cooking_recipe_ai')) return;
                    setErr('');
                    setView({ kind: 'generate' });
                  }}
                  t={t}
                />
              </>
            )}
            {view.kind === 'pantry' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} title={t('库存', 'Pantry')} />
                <SubTabs active="pantry" onSelect={setTopView} t={t} />
                <PantryBody items={items} shopping={shopping} onCamera={openCamera} onRemove={remove} onError={setErr} onChanged={reload} t={t} />
              </>
            )}
            {view.kind === 'wishlist' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} />
                <SubTabs active="wishlist" onSelect={setTopView} t={t} />
                <WishlistBody wishes={wishes} recipes={recipes} onCompute={(n) => computeNeeds(n, 'wishlist')} onOpenDish={openRecipeByName} onPlan={() => setView({ kind: 'plan' })} onError={setErr} onChanged={reload} onCamera={openCamera} t={t} />
              </>
            )}
            {view.kind === 'recipe' && (
              <>
                <ScreenHead backLabel={t('做饭', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={view.match.recipe.name} />
                <RecipeBody match={view.match} t={t} />
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
            {view.kind === 'logmeal' && (
              <>
                <ScreenHead backLabel={t('做饭', 'Cooking')} onBack={finishLogMeal} title={t('记一餐', 'Log a meal')} />
                <MealLogBody photoUrl={mealPhoto} onError={setErr} onDone={finishLogMeal} t={t} />
              </>
            )}
            {view.kind === 'generate' && (
              <>
                <ScreenHead backLabel={t('做饭', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={t('生成新菜谱', 'Generate a recipe')} />
                <GenerateBody
                  pantryItems={items}
                  soonNames={soonNames}
                  locale={dict}
                  onDone={(recipe) => {
                    try { addWish(recipe.name, t('AI 生成', 'AI generated')); } catch { /* wishlist 失败不挡打开 */ }
                    reload();
                    setView({ kind: 'recipe', match: matchRecipe(recipe, pantryNames, normalizeIngredient) });
                  }}
                  t={t}
                />
              </>
            )}
            {view.kind === 'plan' && (
              <>
                <ScreenHead backLabel={t('想做清单', 'Want to cook')} onBack={() => setView({ kind: 'wishlist' })} title={t('做饭计划', 'Meal plan')} />
                <PlanBody matches={planMatches} recipes={recipes} soonNames={soonNames} pantryNames={pantryNames} onError={setErr} t={t} />
              </>
            )}
          </div>
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 屏1 做饭首页 ──────────────────────────────────────────────────────────────
function HomeBody({ soon, recipes, recipesErr, soonNames, pantryNames, onLoadRec, onOpenRecipe, onLogMeal, onCamera, onGenerate, t }: {
  soon: PantryItem[]; recipes: Recipe[] | null; recipesErr: boolean; soonNames: Set<string>; pantryNames: Set<string>;
  onLoadRec: () => void; onOpenRecipe: (m: RecipeMatch<Recipe>) => void; onLogMeal: () => void; onCamera: () => void;
  onGenerate: () => void; t: TT;
}) {
  // 菜谱由用户自选/输入,不再用库存自动塞固定列表。
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');

  const suggestions = useMemo(() => {
    const query = q.trim();
    if (!query || !recipes) return [];
    const have = new Set(picked);
    return recipes.filter((r) => r.name.includes(query) && !have.has(r.name)).slice(0, 6);
  }, [q, recipes, picked]);

  const rows = useMemo(() => {
    if (!recipes) return picked.map((name) => ({ name, match: null as RecipeMatch<Recipe> | null }));
    return picked.map((name) => {
      const r = recipes.find((x) => x.name === name)
        ?? recipes.find((x) => x.name.includes(name) || name.includes(x.name));
      return { name, match: r ? matchRecipe(r, pantryNames, normalizeIngredient) : null };
    });
  }, [picked, recipes, pantryNames]);

  function addDish(nm?: string) {
    const v = (nm ?? q).trim();
    if (!v) { setAdding(false); return; }
    setPicked((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setQ(''); setAdding(false);
  }
  function removeDish(name: string) { setPicked((prev) => prev.filter((n) => n !== name)); }

  return (
    <>
      {/* 入口对齐记一物品:手动选菜 + 小相机 */}
      {adding
        ? (
          <div>
            <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder={t('搜或输入菜名', 'Search or type a dish')} value={q} autoFocus
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addDish(); }} />
              <button type="button" onClick={() => addDish()} style={primaryBtn}>{t('加进来', 'Add')}</button>
              <button type="button" onClick={() => { setAdding(false); setQ(''); }} style={ghostBtn}>{t('取消', 'Cancel')}</button>
            </div>
            {suggestions.length > 0 && (
              <div style={{ ...card, marginTop: 'var(--space-2)' }}>
                {suggestions.map((r, i) => (
                  <button key={r.name} type="button" onClick={() => addDish(r.name)}
                    style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : divider, cursor: 'pointer' }}>
                    <Dot />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>{[r.category, r.difficulty ? '★'.repeat(r.difficulty) : ''].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
        : <CaptureRow manualLabel={`+ ${t('选个菜', 'Pick a dish')}`} onManual={() => setAdding(true)} onCamera={onCamera} t={t} />}

      {/* 快过期 · 先用掉 —— 横向白卡 + 软色 pill +「别浪费」 */}
      {soon.length > 0 && (
        <section>
          <SectionHead label={t('快过期 · 先用掉', 'Use these first')} right={t('别浪费', 'Don’t waste it')} />
          <div style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', paddingBottom: 'var(--space-1)', margin: '0 calc(-1 * var(--space-4))', padding: '0 var(--space-4) var(--space-1)', scrollSnapType: 'x proximity' }}>
            {soon.slice(0, 6).map((it) => {
              const tone = soonPillTone(it.daysLeft);
              return (
                <div key={it.id} style={{ flex: 'none', width: 118, scrollSnapAlign: 'start', ...card, padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                  <span style={{ ...pill, background: tone.bg, color: tone.fg, alignSelf: 'flex-start' }}>{daysPill(it.daysLeft, t)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 自选菜谱列表(无「用手上的能做」标题) */}
      <section>
        {recipesErr && <ErrorRow msg={t('菜谱没载出来。', 'Recipes didn’t load.')} onRetry={onLoadRec} t={t} />}
        {!recipesErr && recipes === null && <p style={hintLine}>{t('翻翻菜谱…', 'Looking through recipes…')}</p>}
        {rows.length === 0 && !adding && (
          <p style={{ ...hintLine, lineHeight: 1.6 }}>{t('自己选几道想做的 —— 搜库里的,或直接打菜名。', 'Pick dishes yourself — search the library or type a name.')}</p>
        )}
        {rows.length > 0 && (
          <div style={card}>
            {rows.map((rowItem, i) => (
              <div key={rowItem.name} style={{ ...row, borderBottom: i === rows.length - 1 ? 'none' : divider }}>
                <Dot />
                <button type="button"
                  onClick={() => { if (rowItem.match) onOpenRecipe(rowItem.match); }}
                  disabled={!rowItem.match}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: rowItem.match ? 'pointer' : 'default', padding: 0, fontFamily: 'var(--font-sans)' }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowItem.name}</div>
                  <div style={subText}>{rowItem.match ? recipeReason(rowItem.match, soonNames, t) : t('自定义菜 · 可先记下', 'Custom · saved for now')}</div>
                </button>
                {rowItem.match
                  ? (rowItem.match.canCook
                    ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('材料齐', 'Ready')}</span>
                    : <span style={{ ...pill, background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{t(`缺 ${rowItem.match.missing.length} 样`, `${rowItem.match.missing.length} to buy`)}</span>)
                  : <span style={{ ...pill, background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{t('自定义', 'Custom')}</span>}
                <button type="button" onClick={() => removeDish(rowItem.name)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <button type="button" onClick={onGenerate}
        style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <IconZap size={16} />{t('生成新菜谱', 'Generate a recipe')}
        {!canUsePaidCloudAi() && <span style={{ ...pill, background: 'rgba(255,255,255,.22)', color: '#fff', marginLeft: 'var(--space-1)' }}>Pro</span>}
      </button>

      {/* 记一餐:点一下开相机 → 拍完进记一餐页 */}
      <button type="button" onClick={onLogMeal} style={{ ...ghostBtn, width: '100%', padding: 'var(--space-3)', fontSize: 'var(--text-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <IconCamera size={16} />{t('记一餐', 'Log a meal')}
      </button>
    </>
  );
}

// ── 屏2 库存 ──────────────────────────────────────────────────────────────────
function PantryBody({ items, shopping, onCamera, onRemove, onError, onChanged, t }: {
  items: PantryItem[]; shopping: ShoppingItem[]; onCamera: () => void; onRemove: (id: string) => void;
  onError: (m: string) => void; onChanged: () => void; t: TT;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [shopMsg, setShopMsg] = useState('');
  const soon = useMemo(() => items.filter((i) => i.daysLeft != null && i.daysLeft <= 7), [items]);
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
      {/* 对齐记一物品:手动记 + 小相机 */}
      {showAdd
        ? <AddForm onAdded={() => { setShowAdd(false); onChanged(); }} onCancel={() => setShowAdd(false)} onError={onError} t={t} />
        : <CaptureRow manualLabel={`+ ${t('手动记', 'Add by hand')}`} onManual={() => setShowAdd(true)} onCamera={onCamera} t={t} />}

      {items.length === 0 && !showAdd && (
        <p style={{ ...hintLine, lineHeight: 1.6 }}>
          {t('还没记库存。手动加一样,或拍张小票 —— 之后「快过期先用」就有了。',
            'Pantry is empty. Add by hand or snap a receipt — then expiry nudges appear.')}
        </p>
      )}

      {soon.length > 0 && (
        <section>
          <SectionHead label={t('快过期', 'Expiring soon')} right={t(`${soon.length} 项`, `${soon.length}`)} />
          <div style={card}>
            {soon.map((it, i) => <PantryRow key={it.id} it={it} last={i === soon.length - 1} soon onRemove={onRemove} t={t} />)}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <SectionHead label={t('充足', 'Well stocked')} />
          <div style={card}>
            {rest.map((it, i) => <PantryRow key={it.id} it={it} last={i === rest.length - 1} soon={false} onRemove={onRemove} t={t} />)}
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

function PantryRow({ it, last, soon, onRemove, t }: { it: PantryItem; last: boolean; soon: boolean; onRemove: (id: string) => void; t: TT }) {
  const meta = [it.addedAt ? buyLabel(it.addedAt, t) : it.category || '', it.location].filter(Boolean).join(' · ');
  return (
    <div style={{ ...row, borderBottom: last ? 'none' : divider }}>
      <Dot />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qtyName(it)}</div>
        {meta && <div style={{ ...subText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>}
      </div>
      {soon && <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{daysPill(it.daysLeft, t)}</span>}
      <button type="button" onClick={() => void onRemove(it.id)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
    </div>
  );
}

// ── 屏4 想做清单 ──────────────────────────────────────────────────────────────
function WishlistBody({ wishes, recipes, onCompute, onOpenDish, onPlan, onError, onChanged, onCamera, t }: {
  wishes: WishDish[]; recipes: Recipe[] | null; onCompute: (name: string) => void; onOpenDish: (name: string) => void; onPlan: () => void;
  onError: (m: string) => void; onChanged: () => void; onCamera: () => void; t: TT;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // 搜的时候模糊匹配已登记在库的菜谱,dropdown 给 ≤5 条。
  const suggestions = useMemo(() => {
    const q = name.trim();
    if (!q || !recipes) return [];
    const have = new Set(wishes.map((w) => w.name));
    return recipes.filter((r) => r.name.includes(q) && !have.has(r.name)).slice(0, 5);
  }, [name, recipes, wishes]);

  function add(nm?: string) {
    const v = (nm ?? name).trim();
    if (!v) { setAdding(false); return; }
    try { addWish(v); setName(''); setAdding(false); onChanged(); }
    catch { onError(t('没加上,再试一次。', 'Could not add — try again.')); }
  }

  return (
    <>
      {/* 入口置顶:手动搜 + 小相机(对齐记一物品) */}
      {adding
        ? (
          <div>
            <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder={t('搜或输入菜名', 'Search or type a dish')} value={name} autoFocus
                onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
              <button type="button" onClick={() => add()} style={primaryBtn}>{t('加进来', 'Add')}</button>
              <button type="button" onClick={() => { setAdding(false); setName(''); }} style={ghostBtn}>{t('取消', 'Cancel')}</button>
            </div>
            {suggestions.length > 0 && (
              <div style={{ ...card, marginTop: 'var(--space-2)' }}>
                {suggestions.map((r, i) => (
                  <button key={r.name} type="button" onClick={() => add(r.name)}
                    style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : divider, cursor: 'pointer' }}>
                    <Dot />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>{[r.category, r.difficulty ? '★'.repeat(r.difficulty) : ''].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
        : <CaptureRow manualLabel={`+ ${t('搜个菜', 'Search a dish')}`} onManual={() => setAdding(true)} onCamera={onCamera} t={t} />}

      <button type="button" onClick={onPlan} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-3)', fontSize: 'var(--text-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <IconUtensils size={16} />{t('排一周食谱', 'Plan the week')}
      </button>

      {wishes.length === 0 && !adding
        ? <p style={{ ...hintLine, lineHeight: 1.6 }}>{t('想做的菜先攒着 —— 搜库里的,或直接打菜名。点一道看步骤,或算「还缺什么」。', 'Save dishes you want — search or type. Tap for steps, or see what’s missing.')}</p>
        : (
          <div style={card}>
            {wishes.map((w, i) => (
              <div key={w.name} style={{ ...row, borderBottom: i === wishes.length - 1 ? 'none' : divider }}>
                <Dot />
                <button type="button" onClick={() => onOpenDish(w.name)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)' }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                  {w.note && <div style={subText}>{w.note}</div>}
                </button>
                <button type="button" onClick={() => onCompute(w.name)} aria-label={t('算缺料', 'What’s missing')}
                  style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{t('缺', '?')}</button>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

// ── 生成新菜谱(Pro) ──────────────────────────────────────────────────────────
function GenerateBody({ pantryItems, soonNames, locale, onDone, t }: {
  pantryItems: PantryItem[]; soonNames: Set<string>; locale: string;
  onDone: (r: Recipe) => void; t: TT;
}) {
  const pantryNames = useMemo(
    () => pantryItems.map((i) => normalizeIngredient(i.name).name).filter(Boolean),
    [pantryItems],
  );
  const seedIngredients = useMemo(() => {
    const soon = pantryNames.filter((n) => soonNames.has(n));
    const rest = pantryNames.filter((n) => !soonNames.has(n));
    return [...soon, ...rest].slice(0, 12);
  }, [pantryNames, soonNames]);

  const [cuisineId, setCuisineId] = useState(CUISINES[2]?.id || CUISINES[0]?.id || 'chuan');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');

  async function run() {
    setFail('');
    if (!guardPaidCloudAi('cooking_recipe_ai')) return;
    const ingredients = seedIngredients.length
      ? seedIngredients
      : extra.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (!ingredients.length) {
      setFail(t('先在库存记几样,或在下面打几个食材名。', 'Add pantry items first, or type a few ingredients below.'));
      return;
    }
    setBusy(true);
    const ac = new AbortController();
    const kill = window.setTimeout(() => ac.abort(), 90_000);
    try {
      const res = await fetch('/api/portal/cooking-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients,
          cuisineId,
          customPrompt: extra.trim() || undefined,
          locale,
        }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; recipe?: Recipe; error?: string } | null;
      if (!res.ok || !data?.ok || !data.recipe) {
        const msg = data?.error === 'parse_failed'
          ? t('这次没写清楚步骤,再试一次。', 'That draft was unclear — try again.')
          : t('生成没成功,稍后再试。', 'Couldn’t generate — try again in a bit.');
        setFail(msg);
        return;
      }
      const saved = saveGeneratedRecipe(data.recipe);
      onDone(saved);
    } catch {
      setFail(t('网络不稳,生成没发出去。', 'Network hiccup — generate didn’t go through.'));
    } finally {
      window.clearTimeout(kill);
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ ...hintLine, lineHeight: 1.6 }}>
        {t('用手上的食材 + 选个菜系,云端帮你写一道带步骤的新菜(Pro)。',
          'Use pantry ingredients + a cuisine — cloud writes a new recipe with steps (Pro).')}
      </p>

      <section>
        <SectionHead label={t('会用到的食材', 'Ingredients')} right={seedIngredients.length ? t(`${seedIngredients.length} 样`, `${seedIngredients.length}`) : undefined} />
        {seedIngredients.length > 0
          ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {seedIngredients.map((n) => (
                <span key={n} style={{ ...pill, background: soonNames.has(n) ? 'var(--status-gentle-soft)' : 'var(--portal-accent-soft)', color: soonNames.has(n) ? 'var(--status-gentle)' : 'var(--portal-ink)' }}>{n}</span>
              ))}
            </div>
          )
          : <p style={hintLine}>{t('库存还空 —— 在下面打几个食材,或先去「库存」记几样。', 'Pantry empty — type ingredients below, or add some in Pantry first.')}</p>}
      </section>

      <section>
        <SectionHead label={t('菜系', 'Cuisine')} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {CUISINES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCuisineId(c.id)}
              style={{
                ...pill,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                background: cuisineId === c.id ? 'var(--portal-accent)' : 'var(--portal-accent-soft)',
                color: cuisineId === c.id ? '#fff' : 'var(--portal-ink)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              {c.name.replace(/大师$/, '')}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHead label={t('额外要求(可选)', 'Extra notes (optional)')} />
        <input
          style={{ ...inputStyle, width: '100%' }}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder={t('少油 / 给孩子吃 / 只要 20 分钟…', 'Less oil / for kids / 20 min only…')}
        />
      </section>

      {fail && <ErrorRow msg={fail} onRetry={() => { setFail(''); void run(); }} t={t} />}

      <div style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        paddingTop: 'var(--space-3)',
        paddingBottom: 'calc(var(--space-3) + env(safe-area-inset-bottom, 0px))',
        background: 'linear-gradient(180deg, transparent, var(--portal-bg) 28%)',
      }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
        >
          <IconZap size={16} />{busy ? t('正在生成…', 'Generating…') : t('开始生成', 'Generate')}
        </button>
      </div>
      <p style={caption}>{t('步骤会存进本机,并加进想做清单。营养仍用本地成分表估算。', 'Steps stay on-device and go to your wishlist. Nutrition still uses the local table.')}</p>
    </>
  );
}

// ── 屏3 菜谱详情 ──────────────────────────────────────────────────────────────
function RecipeBody({ match, t }: { match: RecipeMatch<Recipe>; t: TT }) {
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
      {(r.difficulty || r.calories != null) && (
        <p style={{ ...hintLine, marginTop: 0 }}>{[
          r.difficulty ? `${'★'.repeat(r.difficulty)} ${t('难度', 'difficulty')}` : '',
          r.calories != null ? t(`约 ${r.calories} 千卡 / 份`, `≈${r.calories} kcal / serving`) : '',
        ].filter(Boolean).join(' · ')}</p>
      )}
      <section>
        <SectionHead label={t('步骤', 'Steps')} />
        <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              <span style={stepNum}>{i + 1}</span><span style={{ paddingTop: 2 }}>{s}</span>
            </div>
          ))}
        </div>
        <p style={caption}>{r.source === 'howtocook'
          ? t('克数就是家庭每份量,照着做就行。', 'Amounts are per home serving — cook as written.')
          : t('步骤里的克数是餐厅出餐量,自家做按人数缩着来。', 'Amounts are restaurant-batch sizes — scale down for home.')}</p>
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
      <div style={{ ...banner, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{match.recipe.source === 'howtocook'
        ? t('家庭份量 · 每份用量,可直接照做', 'Home portions — cook as written')
        : t('家庭份 · 已把餐厅用量缩放到家庭份', 'Scaled a restaurant portion down to a home serving')}</div>

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

// ── 记一餐(进食事件)──────────────────────────────────────────────────────────
const MEAL_SOURCES: MealSource[] = ['自己做', '餐厅', '外卖', '其他'];
function MealLogBody({ photoUrl, onError, onDone, t }: { photoUrl?: string; onError: (m: string) => void; onDone: () => void; t: TT }) {
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<MealSource>('自己做');
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [nutri, setNutri] = useState<{ ek: number; p: number; f: number; c: number; matched: number } | null>(null);
  const [saved, setSaved] = useState(false);

  // 营养 = Σ(每100g × 克/100),查本地成分表;没克数的项按 100g 估。全标估算。
  useEffect(() => {
    let live = true;
    if (!items.length) { setNutri(null); return; }
    (async () => {
      let ek = 0, p = 0, f = 0, c = 0, matched = 0;
      for (const it of items) {
        const n = await lookupNutrition(it.name).catch(() => null);
        if (!n) continue;
        matched += 1;
        const fac = (it.grams && it.grams > 0 ? it.grams : 100) / 100;
        ek += n.energyKCal * fac; p += n.protein * fac; f += n.fat * fac; c += n.cho * fac;
      }
      if (live) setNutri({ ek: Math.round(ek), p: Math.round(p * 10) / 10, f: Math.round(f * 10) / 10, c: Math.round(c * 10) / 10, matched });
    })();
    return () => { live = false; };
  }, [items]);

  function addItem() {
    const nm = name.trim(); if (!nm) return;
    const g = Number(grams);
    setItems((v) => [...v, { name: nm, ...(grams.trim() && Number.isFinite(g) ? { grams: g } : {}) }]);
    setName(''); setGrams('');
  }
  function removeItem(i: number) { setItems((v) => v.filter((_, idx) => idx !== i)); }
  function save() {
    // 输入框有字但忘点「加」→ 自动并入,避免「先加一样吃的」+ 无效 Retry。
    let next = items;
    const pending = name.trim();
    if (pending) {
      const g = Number(grams);
      next = [...items, { name: pending, ...(grams.trim() && Number.isFinite(g) ? { grams: g } : {}) }];
      setItems(next);
      setName(''); setGrams('');
    }
    if (!next.length) { onError(t('先加一样吃的(输入名字后点「加」,或填完直接「记入」)。', 'Add a food name first — tap Add, or fill the name and Log.')); return; }
    try {
      const today = new Date().toISOString().slice(0, 10);
      addMeal({ source, items: next, energyKCal: nutri?.ek ?? 0, protein: nutri?.p ?? 0, fat: nutri?.f ?? 0, cho: nutri?.c ?? 0, occurredAt: today });
      setSaved(true); setTimeout(onDone, 800);
    } catch { onError(t('没记上,再试一次。', 'Could not save — try again.')); }
  }

  return (
    <>
      {/* 照片由入口相机带入,页内不再放相机按钮 */}
      {photoUrl && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="" style={{ width: '100%', maxHeight: '30vh', objectFit: 'cover', display: 'block' }} draggable={false} />
        </div>
      )}

      {/* 吃了什么 */}
      <section>
        <SectionHead label={t('吃了什么', 'What you ate')} right={items.length > 0 ? t(`${items.length} 样`, `${items.length}`) : undefined} />
        {items.length > 0 && (
          <div style={{ ...card, marginBottom: 'var(--space-2)' }}>
            {items.map((it, i) => (
              <div key={`${it.name}-${i}`} style={{ ...row, borderBottom: i === items.length - 1 ? 'none' : divider }}>
                <Dot />
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                {it.grams ? <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{it.grams}g</span> : null}
                <button type="button" onClick={() => removeItem(i)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder={t('吃了啥(如「米饭」)', 'Item (e.g. rice)')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} />
          <input style={{ ...inputStyle, width: 72 }} inputMode="numeric" placeholder="g" value={grams} onChange={(e) => setGrams(e.target.value)} />
          <button type="button" onClick={addItem} style={ghostBtn}>{t('加', 'Add')}</button>
        </div>
      </section>

      {/* 来源 */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
        {MEAL_SOURCES.map((s) => {
          const on = s === source;
          return (
            <button key={s} type="button" onClick={() => setSource(s)}
              style={{ flex: 1, border: 'none', borderRadius: 'var(--radius-pill)', padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: on ? 700 : 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', background: on ? 'var(--portal-accent)' : 'transparent', color: on ? '#fff' : 'var(--portal-muted)' }}>
              {t(s, s === '自己做' ? 'Home' : s === '餐厅' ? 'Dine-in' : s === '外卖' ? 'Takeout' : 'Other')}
            </button>
          );
        })}
      </div>

      {/* 营养四列 */}
      <section>
        <SectionHead label={t('营养', 'Nutrition')} right={t('估算', 'est.')} />
        <div style={{ ...card, display: 'flex', padding: 'var(--space-4) 0' }}>
          <NutriCol v={`${nutri?.ek ?? 0}`} label={t('千卡', 'kcal')} />
          <NutriCol v={`${nutri?.p ?? 0}g`} label={t('蛋白', 'Protein')} />
          <NutriCol v={`${nutri?.c ?? 0}g`} label={t('碳水', 'Carbs')} />
          <NutriCol v={`${nutri?.f ?? 0}g`} label={t('脂肪', 'Fat')} last />
        </div>
        <p style={caption}>{items.length && nutri && nutri.matched < items.length
          ? t(`估算 · ${nutri.matched}/${items.length} 样对上成分表;点项加克数更准。`, `Estimate · ${nutri.matched}/${items.length} matched. Add grams for accuracy.`)
          : t('估算 · 基于《中国食物成分表》· 加克数更准。', 'Estimate · China Food Composition Table · add grams for accuracy.')}</p>
      </section>

      <button type="button" onClick={save} disabled={saved} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', opacity: saved ? 0.55 : 1 }}>
        {saved ? t('已记入 ✓', 'Logged ✓') : t('记入今日账本', 'Log to today')}
      </button>
      <p style={caption}>{t('记下这一餐,身体账本按吃的日子求和。餐厅/外卖不扣库存。', 'Logged to your body ledger by the day you ate. Dine-in/takeout don’t touch the pantry.')}</p>
    </>
  );
}

// ── 做饭计划(周)──────────────────────────────────────────────────────────────
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function PlanBody({ matches, recipes, soonNames, pantryNames, onError, t }: {
  matches: RecipeMatch<Recipe>[]; recipes: Recipe[] | null; soonNames: Set<string>; pantryNames: Set<string>; onError: (m: string) => void; t: TT;
}) {
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  const dict = t('zh', 'en');
  const days = dict === 'zh' ? WEEK_DAYS : WEEK_DAYS_EN;
  const plan: WeekPlan = useMemo(() => planWeek(matches, days, soonNames), [matches, soonNames, days]);
  // 每天可自选/输入菜名;空 = 用自动排的,用户改了以输入为准。
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    setEdits((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const d of plan.days) {
        if (next[d.day] === undefined) next[d.day] = d.dishName ?? '';
      }
      return next;
    });
  }, [plan.days]);

  const dayStatus = useCallback((dishName: string) => {
    const nm = dishName.trim();
    if (!nm) return { status: '餐厅' as const, missing: 0 };
    if (!recipes) return { status: '需采购' as const, missing: 0 };
    const r = recipes.find((x) => x.name === nm) ?? recipes.find((x) => x.name.includes(nm) || nm.includes(x.name));
    if (!r) return { status: '需采购' as const, missing: 0 };
    const m = matchRecipe(r, pantryNames, normalizeIngredient);
    return { status: m.canCook ? '库存够' as const : '需采购' as const, missing: m.missing.length };
  }, [recipes, pantryNames]);

  const missingAll = useMemo(() => {
    if (!recipes) return plan.missingAll;
    const miss = new Set<string>();
    for (const d of days) {
      const nm = (edits[d] ?? '').trim();
      if (!nm) continue;
      const r = recipes.find((x) => x.name === nm) ?? recipes.find((x) => x.name.includes(nm) || nm.includes(x.name));
      if (!r) continue;
      for (const x of matchRecipe(r, pantryNames, normalizeIngredient).missing) miss.add(x);
    }
    return [...miss];
  }, [edits, days, recipes, pantryNames, plan.missingAll]);

  function save() {
    if (!missingAll.length) { setMsg(t('本周库存都够,不用买。', 'Fully stocked this week.')); setTimeout(() => setMsg(''), 1800); return; }
    try { addToShopping(missingAll); setSaved(true); setMsg(t(`存了 ${missingAll.length} 样进「记忆」`, `${missingAll.length} saved to memory`)); setTimeout(() => setMsg(''), 2200); }
    catch { onError(t('没存上,再试一次。', 'Could not save — try again.')); }
  }

  const recipeNames = useMemo(() => (recipes ?? []).map((r) => r.name), [recipes]);

  return (
    <>
      <div style={card}>
        {days.map((day, i) => {
          const dish = edits[day] ?? '';
          const st = dayStatus(dish);
          return (
            <div key={day} style={{ ...row, borderBottom: i === days.length - 1 ? 'none' : divider, alignItems: 'center' }}>
              <span style={{ flex: 'none', width: 34, fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', fontWeight: 600 }}>{day}</span>
              <input
                list="cooking-plan-dishes"
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'transparent' }}
                placeholder={t('选或输入菜名', 'Pick or type a dish')}
                value={dish}
                onChange={(e) => setEdits((prev) => ({ ...prev, [day]: e.target.value }))}
              />
              {st.status === '库存够'
                ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('库存够', 'Stocked')}</span>
                : st.status === '需采购'
                  ? <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{t('需采购', 'To buy')}</span>
                  : <span style={{ ...pill, background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{t('餐厅', 'Out')}</span>}
            </div>
          );
        })}
      </div>
      <datalist id="cooking-plan-dishes">
        {recipeNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div style={{ ...banner, background: missingAll.length ? 'var(--status-gentle-soft)' : 'var(--status-go-soft)', color: missingAll.length ? 'var(--status-gentle)' : 'var(--status-go)' }}>
        {missingAll.length ? t(`本周缺 ${missingAll.length} 样 —— 一次性汇总成购物清单`, `${missingAll.length} short this week — one shopping list`) : t('本周库存都够 —— 不用买', 'Fully stocked — nothing to buy')}
      </div>

      {missingAll.length > 0 && (
        <>
          <button type="button" onClick={save} disabled={saved} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', opacity: saved ? 0.55 : 1 }}>
            {t('存进「记忆」· 一周购物清单', 'Save to memory · week’s shopping list')}
          </button>
          {msg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
        </>
      )}
      {msg && !missingAll.length && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
      <p style={caption}>{t('每天可改菜名;缺料一次性存进「记忆」当购物清单。', 'Edit each day; gaps become one shopping list in memory.')}</p>
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

function ScreenHead({ backLabel, onBack, title, subtitle, subtitleRight }: { backLabel: string; onBack: () => void; title?: string; subtitle?: string; subtitleRight?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <button type="button" onClick={onBack} style={backLink}>‹ {backLabel}</button>
      {title && <h1 style={{ margin: 0, fontSize: 'var(--text-h1)', fontWeight: 700, lineHeight: 1.15, color: 'var(--portal-ink)' }}>{title}</h1>}
      {subtitle && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{subtitle}</span>
          {subtitleRight && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{subtitleRight}</span>}
        </div>
      )}
    </div>
  );
}
/** 记一物品式入口:主按钮手动记 + 右侧小相机。 */
function CaptureRow({ manualLabel, onManual, onCamera, t }: { manualLabel: string; onManual: () => void; onCamera: () => void; t: TT }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <button type="button" onClick={onManual} style={{ ...ghostBtn, flex: 1, padding: 'var(--space-3)', fontSize: 'var(--text-body)' }}>{manualLabel}</button>
      <button type="button" onClick={onCamera} aria-label={t('拍照', 'Camera')}
        style={{ ...ghostBtn, flex: 'none', width: 48, padding: 'var(--space-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <IconCamera size={18} />
      </button>
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
/** 视觉稿:近 2 天写「还剩 N 天」,更远写「N 天」。 */
function daysPill(daysLeft: number | null, t: TT): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return t('过期', 'Past');
  if (daysLeft === 0) return t('今天', 'Today');
  if (daysLeft <= 2) return t(`还剩 ${daysLeft} 天`, `${daysLeft}d left`);
  return t(`${daysLeft} 天`, `${daysLeft}d`);
}
/** pill 色阶对齐视觉稿: ≤2 琥珀 · 3–4 浅红 · ≥5 浅绿。 */
function soonPillTone(daysLeft: number | null): { fg: string; bg: string } {
  if (daysLeft == null) return { fg: 'var(--status-gentle)', bg: 'var(--status-gentle-soft)' };
  if (daysLeft <= 0) return { fg: 'var(--status-risk)', bg: 'var(--status-risk-soft)' };
  if (daysLeft <= 2) return { fg: 'var(--status-gentle)', bg: 'var(--status-gentle-soft)' };
  if (daysLeft <= 4) return { fg: 'var(--status-risk)', bg: 'var(--status-risk-soft)' };
  return { fg: 'var(--status-go)', bg: 'var(--status-go-soft)' };
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
