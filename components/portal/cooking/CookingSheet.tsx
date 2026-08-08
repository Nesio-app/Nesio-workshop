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
import SegTabs from '../ui/SegTabs';
import { IconBookOpen, IconCamera, IconCheckSquare, IconZap, IconUtensils } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, removePantry, updatePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';
import { normalizeIngredient, CUISINES } from '@/lib/cooking/food-catalog';
import { loadRecipes, loadTips, recipeImageUrl, type Recipe, type CookingTip } from '@/lib/cooking/food-data';
import { matchRecipe, matchRecipes, type RecipeMatch } from '@/lib/cooking/recipe-match';
import { getShoppingList, addToShopping, toggleShoppingItem, removeShoppingItem, checkoutBought, type ShoppingItem } from '@/lib/cooking/shopping';
import { scaleAmountsInText, servingFactor } from '@/lib/cooking/scale-recipe';
import { recipeNutritionPerServing, recipeMainNutrition, lookupNutrition, type PerServing, type FoodNutrition } from '@/lib/cooking/nutrition';
import { getWishlist, addWish, type WishDish } from '@/lib/cooking/wishlist';
import SpendClaimRow from '../finance/SpendClaimRow';
import Button from '../ui/Button';
import LocationPicker from '../LocationPicker';
import { addMeal, getMeals, type MealSource, type MealItem } from '@/lib/cooking/meals';
import { planWeek } from '@/lib/cooking/meal-plan-core';
import {
  MEAL_SLOTS, MEAL_SLOT_LABEL, MEAL_CALENDAR_EVENT, getDayPlan, setMealPlan,
  upcomingDayKeys, plannedDishes, dayKey, type MealSlot,
} from '@/lib/cooking/meal-calendar';
import { saveGeneratedRecipe, findGeneratedRecipe } from '@/lib/cooking/generated-recipes';
import { canUsePaidCloudAi, guardPaidCloudAi } from '@/lib/portal/entitlement';
import { localDayKey } from '@/lib/portal/local-day';

type View =
  | { kind: 'home' }
  | { kind: 'pantry' }
  | { kind: 'wishlist' }
  | { kind: 'recipe'; match: RecipeMatch<Recipe> }
  | { kind: 'needs'; match: RecipeMatch<Recipe>; from: 'home' | 'wishlist' | 'recipe' }
  | { kind: 'logmeal' }
  | { kind: 'plan' }
  // 图25/27:日历里的一格改成「点进详情页编辑」,不再在列表里就地打字。
  | { kind: 'planEdit'; date: string; slot: MealSlot }
  | { kind: 'generate' }
  | { kind: 'tips' };

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
  // 原始文件留给 AI 识别用(objectURL 只能显示,识别要重新压缩出 base64)。
  const [mealPhotoFile, setMealPhotoFile] = useState<File | null>(null);

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
    setMealPhotoFile(f);
    setErr('');
    setView({ kind: 'logmeal' });
  }, []);
  const finishLogMeal = useCallback(() => {
    setMealPhoto((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      return '';
    });
    setMealPhotoFile(null);
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
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" className="nesio-visually-hidden" onChange={onCamFile} />
      <input ref={mealCamRef} type="file" accept="image/*" capture="environment" className="nesio-visually-hidden" onChange={onMealCamFile} />
      <div style={{ minHeight: '100%', background: 'transparent', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div>
          <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

            {view.kind === 'home' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} page={t('美味', 'Cooking')} t={t} />
                <SubTabs active="home" onSelect={setTopView} t={t} />
                <HomeBody
                  soon={soon} recipes={recipes} recipesErr={recipesErr} soonNames={soonNames} pantryNames={pantryNames}
                  onLoadRec={loadRec} onOpenRecipe={(m) => setView({ kind: 'recipe', match: m })}
                  onLogMeal={startLogMeal} onCamera={openCamera} onTips={() => { setErr(''); setView({ kind: 'tips' }); }}
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
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} page={t('美味', 'Cooking')} t={t} />
                <SubTabs active="pantry" onSelect={setTopView} t={t} />
                <PantryBody items={items} shopping={shopping} onCamera={openCamera} onRemove={remove} onError={setErr} onChanged={reload} t={t} />
              </>
            )}
            {view.kind === 'wishlist' && (
              <>
                <ScreenHead backLabel={t('洞察', 'Insights')} onBack={onClose} page={t('美味', 'Cooking')} t={t} />
                <SubTabs active="wishlist" onSelect={setTopView} t={t} />
                <WishlistBody wishes={wishes} recipes={recipes} onCompute={(n) => computeNeeds(n, 'wishlist')} onOpenDish={openRecipeByName} onPlan={() => setView({ kind: 'plan' })} onError={setErr} onChanged={reload} onCamera={openCamera} t={t} />
              </>
            )}
            {view.kind === 'recipe' && (
              <>
                <ScreenHead backLabel={t('美味', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={view.match.recipe.name} t={t} />
                <RecipeBody match={view.match} t={t} />
              </>
            )}
            {view.kind === 'needs' && (
              <>
                <ScreenHead
                  backLabel={view.from === 'wishlist' ? t('想做清单', 'Want to cook') : view.from === 'recipe' ? view.match.recipe.name : t('美味', 'Cooking')}
                  onBack={() => setView(view.from === 'wishlist' ? { kind: 'wishlist' } : view.from === 'recipe' ? { kind: 'recipe', match: view.match } : { kind: 'home' })}
                  t={t} />
                {/* 图28:大标题删掉 —— 从菜谱页进来时返回链已经写着同一个菜名,标题是复读。 */}
                <NeedsBody match={view.match} onError={setErr} onDone={() => setView({ kind: 'home' })} t={t} />
              </>
            )}
            {view.kind === 'logmeal' && (
              <>
                <ScreenHead backLabel={t('美味', 'Cooking')} onBack={finishLogMeal} title={t('记一餐', 'Log a meal')} t={t} />
                <MealLogBody photoUrl={mealPhoto} photoFile={mealPhotoFile} onError={setErr} onDone={finishLogMeal} t={t} />
              </>
            )}
            {view.kind === 'generate' && (
              <>
                <ScreenHead backLabel={t('美味', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={t('生成新菜谱', 'Generate a recipe')} t={t} />
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
                <ScreenHead backLabel={t('想做清单', 'Want to cook')} onBack={() => setView({ kind: 'wishlist' })} t={t} />
                <PlanBody recipes={recipes} pantryNames={pantryNames} onError={setErr}
                  onEdit={(date, slot) => setView({ kind: 'planEdit', date, slot })} t={t} />
              </>
            )}
            {view.kind === 'planEdit' && (
              <>
                <ScreenHead backLabel={t('美食日历', 'Meal calendar')} onBack={() => setView({ kind: 'plan' })} t={t} />
                <PlanEditBody date={view.date} slot={view.slot} recipes={recipes} matches={planMatches} t={t} />
              </>
            )}
            {view.kind === 'tips' && (
              <>
                <ScreenHead backLabel={t('美味', 'Cooking')} onBack={() => setView({ kind: 'home' })} title={t('新手技法', 'Techniques')} t={t} />
                <TipsBody t={t} />
              </>
            )}
          </div>
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 屏1 做饭首页 ──────────────────────────────────────────────────────────────
function HomeBody({ soon, recipes, recipesErr, soonNames, pantryNames, onLoadRec, onOpenRecipe, onLogMeal, onCamera, onGenerate, onTips, t }: {
  soon: PantryItem[]; recipes: Recipe[] | null; recipesErr: boolean; soonNames: Set<string>; pantryNames: Set<string>;
  onLoadRec: () => void; onOpenRecipe: (m: RecipeMatch<Recipe>) => void; onLogMeal: () => void; onCamera: () => void;
  onGenerate: () => void; onTips: () => void; t: TT;
}) {
  // 菜谱由用户自选/输入,不再用库存自动塞固定列表。
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [tool, setTool] = useState('');

  // 器具筛选 + 联想:「家里只有电饭煲能做什么」——只选器具不打字时,按库存命中率推 6 道。
  const suggestions = useMemo(() => {
    if (!recipes) return [];
    const query = q.trim();
    const have = new Set(picked);
    const pool = recipes.filter((r) => !have.has(r.name) && (!tool || (r.tools ?? []).includes(tool)));
    if (query) return pool.filter((r) => r.name.includes(query)).slice(0, 6);
    if (!tool) return [];
    return matchRecipes(pool, pantryNames, normalizeIngredient).slice(0, 6).map((m) => m.recipe);
  }, [q, recipes, picked, tool, pantryNames]);

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
    setQ(''); setTool(''); setAdding(false);
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
              <button type="button" onClick={() => { setAdding(false); setQ(''); setTool(''); }} style={ghostBtn}>{t('取消', 'Cancel')}</button>
            </div>
            {/* 器具筛选:只筛库里标了该器具的菜(importer 从步骤推导) */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              {TOOL_CHIPS.map(([zh, en]) => (
                <button key={zh} type="button" onClick={() => setTool((v) => (v === zh ? '' : zh))}
                  style={{ ...chip, ...(tool === zh ? chipOn : {}) }}>{t(zh, en)}</button>
              ))}
            </div>
            {tool && suggestions.length === 0 && (
              <p style={hintLine}>{t(`库里暂时没配到「${tool}」能做的菜 —— 换个器具,或直接打菜名。`, 'No recipes tagged for this tool yet — try another, or type a dish.')}</p>
            )}
            {suggestions.length > 0 && (
              <div style={{ ...card, marginTop: 'var(--space-2)' }}>
                {suggestions.map((r, i) => (
                  <button key={r.name} type="button" onClick={() => addDish(r.name)}
                    style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : divider, cursor: 'pointer' }}>
                    <RecipeThumb name={r.name} image={r.image} size={32} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>{[r.category, r.difficulty ? '★'.repeat(r.difficulty) : ''].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
        : <CaptureRow manualLabel={`+ ${t('选个菜', 'Pick a dish')}`} onManual={() => setAdding(true)} onCamera={onCamera} t={t} />}

      {/* 图30:「快过期 · 先用掉」+「别浪费」那行小标题删掉 —— 卡片上本来就写着还剩几天,
          再加一句「别浪费」是催,不是信息。卡片本身留着(它是这一屏唯一有时效的东西)。 */}
      {soon.length > 0 && (
        <section>
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
        {/* 图30:「自己选几道想做的 —— 搜库里的,或直接打菜名」删掉 ——
            上面那颗「+ 选个菜」按钮已经说明了要干什么,这句是同一件事的第二遍。 */}
        {rows.length > 0 && (
          <div style={card}>
            {rows.map((rowItem, i) => (
              <div key={rowItem.name} style={{ ...row, borderBottom: i === rows.length - 1 ? 'none' : divider }}>
                <RecipeThumb name={rowItem.name} image={rowItem.match?.recipe.image} size={44} />
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

      {/* 图30:三条通栏按钮(生成新菜谱 / 记一餐 / 新手技法)占了半屏,
          但它们都是「偶尔用一次」的次要动作。压成一排小图标,文字进 aria-label 与 title。 */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        {([
          [t('生成新菜谱', 'Generate a recipe'), <IconZap key="z" size={17} />, onGenerate, !canUsePaidCloudAi()],
          [t('记一餐', 'Log a meal'), <IconCamera key="c" size={17} />, onLogMeal, false],
          [t('新手技法', 'Techniques'), <IconBookOpen key="b" size={17} />, onTips, false],
        ] as const).map(([label, icon, onClick, pro]) => (
          <button key={label} type="button" onClick={onClick} aria-label={label} title={label}
            style={{ ...ghostBtn, position: 'relative', flex: 'none', width: 44, height: 44, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
            {pro && <span style={{ position: 'absolute', top: -4, right: -4, ...pill, padding: '0 5px', fontSize: 'var(--text-xs)', background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)' }}>Pro</span>}
          </button>
        ))}
      </div>
    </>
  );
}

/** 图29:存放位置 tag —— 和分类同一套形态。值是存进 PantryItem.location 的规范名。 */
const PANTRY_LOCATIONS: Array<[string, string]> = [
  ['冰箱', 'Fridge'], ['冷冻', 'Freezer'], ['橱柜', 'Cupboard'], ['台面', 'Counter'], ['其他', 'Other'],
];

/** 器具筛选 chips:值对齐 importer 的 TOOL_PATTERNS 规范名(蒸锅/破壁机太常见或太小众,不进筛选)。 */
const TOOL_CHIPS: Array<[string, string]> = [
  ['电饭煲', 'Rice cooker'], ['烤箱', 'Oven'], ['空气炸锅', 'Air fryer'],
  ['微波炉', 'Microwave'], ['高压锅', 'Pressure cooker'], ['平底锅', 'Pan'],
];

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
            {soon.map((it, i) => <PantryRow key={it.id} it={it} last={i === soon.length - 1} soon onRemove={onRemove} onChanged={onChanged} onError={onError} t={t} />)}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <SectionHead label={t('充足', 'Well stocked')} />
          <div style={card}>
            {rest.map((it, i) => <PantryRow key={it.id} it={it} last={i === rest.length - 1} soon={false} onRemove={onRemove} onChanged={onChanged} onError={onError} t={t} />)}
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

/**
 * #39(2026-07-30 真机):「黄瓜」这张卡点了没反应 —— 整行只有右边那个 ✕ 是可点的,
 * 行本身是个 <div>。而它偏偏标着「过期」:效期多半是记进来时按默认保质期估的,
 * 估错了,用户却**没有任何地方能改**。两件事其实是一件:
 * 这一行没有「去处」,所以既点不动,也改不了。
 *
 * 现在点开就是编辑:数量 / 效期 / 放哪。收起时也把效期日期本身印出来 ——
 * 只写一个「过期」而不说是哪天,用户根本没法判断它是不是记错了。
 */
function PantryRow({ it, last, soon, onRemove, onChanged, onError, t }: {
  it: PantryItem; last: boolean; soon: boolean;
  onRemove: (id: string) => void; onChanged: () => void; onError: (m: string) => void; t: TT;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(it.quantity == null ? '' : String(it.quantity));
  const [exp, setExp] = useState(it.expiry || '');
  const [loc, setLoc] = useState(it.location || '');

  const meta = [
    it.addedAt ? buyLabel(it.addedAt, t) : it.category || '',
    it.location,
    it.expiry ? t(`效期 ${it.expiry}`, `use by ${it.expiry}`) : '',
  ].filter(Boolean).join(' · ');

  function save() {
    const n = qty.trim() === '' ? null : Number(qty);
    if (qty.trim() !== '' && !Number.isFinite(n as number)) { onError(t('数量填个数字就行。', 'Quantity needs to be a number.')); return; }
    try {
      if (!updatePantry(it.id, { quantity: n, expiry: exp.trim(), location: loc.trim() })) {
        onError(t('没改成 —— 再试一次。', 'That didn’t save — try again.'));
        return;
      }
      setOpen(false);
      onChanged();
    } catch {
      onError(t('没改成 —— 再试一次。', 'That didn’t save — try again.'));
    }
  }

  return (
    <div style={{ borderBottom: last ? 'none' : divider }}>
      <div style={{ ...row, borderBottom: 'none' }}>
        <Dot />
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          style={{ flex: 1, minWidth: 0, minHeight: 44, textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)', color: 'var(--portal-ink)' }}>
          <span style={{ display: 'block', fontSize: 'var(--text-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qtyName(it)}</span>
          {meta && <span style={{ ...subText, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>}
        </button>
        {soon && <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{daysPill(it.daysLeft, t)}</span>}
        <button type="button" onClick={() => void onRemove(it.id)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
      </div>
      {open && (
        <div style={{ padding: '0 var(--space-3) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric"
            placeholder={t('数量(空 = 不计数)', 'Quantity (blank = not counted)')} style={inputStyle} />
          <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} style={inputStyle} />
          <LocationPicker value={loc} onChange={(v) => setLoc(v)} />
          <p style={{ ...subText, margin: 0 }}>
            {t('效期留空 = 这东西没有效期,不再进「快过期」。', 'Leave the date blank if it has no expiry — it drops out of “expiring soon”.')}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => { setOpen(false); setQty(it.quantity == null ? '' : String(it.quantity)); setExp(it.expiry || ''); setLoc(it.location || ''); }} style={{ ...ghostBtn, flex: 1 }}>{t('稍后', 'Later')}</button>
            {/* 合并音乐分支时新加的一颗。primaryBtn 就是原语的 primary(accent 底 / 白字 / 胶囊),
                flex:1 是布局 —— 正好是 layoutStyle 窄口的标准用法,不必再多一颗裸按钮。 */}
            <Button variant="primary" layoutStyle={{ flex: 1 }} onClick={save}>{t('存下来', 'Save')}</Button>
          </div>
        </div>
      )}
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
  // 图26:长按排期。450ms 与底部导航长按同节奏;抬手/移开/右键菜单都要能取消,
  // 否则手指滑一下就误触发排期层。
  const [scheduling, setScheduling] = useState<string | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 长按已经触发过就把随后那一次 click 吃掉 —— 否则松手时排期层和菜谱页会一起打开。
  const heldRef = useRef(false);
  const cancelHold = useCallback(() => {
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
  }, []);
  const startHold = useCallback((dish: string) => {
    cancelHold();
    heldRef.current = false;
    holdRef.current = setTimeout(() => { heldRef.current = true; navigator.vibrate?.(12); setScheduling(dish); }, 450);
  }, [cancelHold]);
  useEffect(() => cancelHold, [cancelHold]);
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
                    <RecipeThumb name={r.name} image={r.image} size={32} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', whiteSpace: 'nowrap' }}>{[r.category, r.difficulty ? '★'.repeat(r.difficulty) : ''].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
        : <CaptureRow manualLabel={`+ ${t('搜菜谱', 'Search recipes')}`} onManual={() => setAdding(true)} onCamera={onCamera} t={t} />}

      {/* 图26:「排一周食谱」改叫「美食日历」—— 进去的那一页现在就是一份日历,
          不再是一键排出来的一周。 */}
      <button type="button" onClick={onPlan} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-3)', fontSize: 'var(--text-body)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <IconUtensils size={16} />{t('美食日历', 'Meal calendar')}
      </button>

      {wishes.length === 0 && !adding
        ? <p style={{ ...hintLine, lineHeight: 1.6 }}>{t('想做的菜先攒着 —— 搜库里的,或直接打菜名。点一道看步骤,长按选哪天做。', 'Save dishes you want — search or type. Tap for steps, long-press to schedule.')}</p>
        : (
          /* 封面卡网格。这一屏是「挑今天做哪道」——照片帮得上,所以走两列大图卡;
             自选列表那屏是状态列表(材料齐 / 缺 3 样),行式更好扫,保持不动。
             ⚠️ 库里只有一半的菜有图(354/704),所以无图态必须自己站得住 ——
             见 RecipeCover:同尺寸的浅色面 + 菜名排版,不是把 32px 的字母占位放大。 */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
            {wishes.map((w) => {
              const rec = recipes?.find((x) => x.name === w.name);
              return (
                <div key={w.name} style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* 图26:长按一张菜卡 → 选哪天做。点开还是看步骤,长按才是排期 ——
                      和记忆卡「点开/长按」的分工一致。 */}
                  <button type="button" onClick={() => { if (heldRef.current) { heldRef.current = false; return; } onOpenDish(w.name); }}
                    onPointerDown={() => startHold(w.name)} onPointerUp={cancelHold}
                    onPointerLeave={cancelHold} onPointerCancel={cancelHold}
                    onContextMenu={(e) => { e.preventDefault(); setScheduling(w.name); }}
                    style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)' }}>
                    <RecipeCover image={rec?.image} />
                    <div style={{ padding: 'var(--space-3) var(--space-3) var(--space-2)' }}>
                      <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                      <div style={{ ...subText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.note || [rec?.category, rec?.difficulty ? '★'.repeat(rec.difficulty) : ''].filter(Boolean).join(' · ') || t('还没配上菜谱', 'No recipe matched yet')}
                      </div>
                    </div>
                  </button>
                  <button type="button" onClick={() => onCompute(w.name)}
                    style={{ margin: '0 var(--space-3) var(--space-3)', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                    {t('还缺什么', "What's missing")}
                  </button>
                </div>
              );
            })}
          </div>
        )}

      {/* 图26:长按后的排期层 —— 挑哪天、哪一顿,直接写进美食日历。 */}
      {scheduling && (
        <NesioSheet variant="bottom" card={false} elevated open onOpenChange={(o) => { if (!o) setScheduling(null); }}
          ariaLabel={t('选哪天做', 'Pick a day')}>
          <div style={{ padding: 'var(--space-4)', paddingBottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--portal-ink)' }}>
              {t(`哪天做「${scheduling}」?`, `When to cook “${scheduling}”?`)}
            </p>
            {upcomingDayKeys(7).map((date) => {
              const d = new Date(`${date}T00:00:00`);
              const isToday = date === dayKey(new Date());
              return (
                <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ flex: 'none', width: 72, fontSize: 'var(--text-xs)', color: isToday ? 'var(--portal-accent)' : 'var(--portal-muted)', fontWeight: isToday ? 700 : 400 }}>
                    {isToday ? t('今天', 'Today') : `${d.getMonth() + 1}/${d.getDate()}`}
                  </span>
                  {MEAL_SLOTS.map((slot) => (
                    <button key={slot} type="button" style={{ ...chip, flex: 1 }}
                      onClick={() => { setMealPlan(date, slot, scheduling); setScheduling(null); }}>
                      {t(MEAL_SLOT_LABEL[slot].zh, MEAL_SLOT_LABEL[slot].en)}
                    </button>
                  ))}
                </div>
              );
            })}
            <button type="button" style={ghostBtn} onClick={() => setScheduling(null)}>{t('稍后', 'Later')}</button>
          </div>
        </NesioSheet>
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
    // 去重(QA:同名食材两条 → 菜谱食材清单「黄瓜」列两次)
    () => [...new Set(pantryItems.map((i) => normalizeIngredient(i.name).name).filter(Boolean))],
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
    </>
  );
}

// ── 屏3 菜谱详情 ──────────────────────────────────────────────────────────────
function RecipeBody({ match, t }: { match: RecipeMatch<Recipe>; t: TT }) {
  const r = match.recipe;
  // 小贴士不是步骤:从 steps 里拆出来单列(老乡鸡数据把「小贴士:」塞进了最后一步)。
  const [cookSteps, cookTips] = useMemo(() => {
    const steps: string[] = []; const tips: string[] = [];
    for (const s of r.steps || []) (/^\s*小贴士[:：]/.test(s) ? tips : steps).push(s.replace(/^\s*小贴士[:：]\s*/, ''));
    return [steps, tips];
  }, [r.steps]);
  const [per, setPer] = useState<PerServing | null>(null);
  const [main, setMain] = useState<FoodNutrition[] | null>(null);
  // 图26:「步骤里的克数是餐厅出餐量,自家做按人数缩着来」。
  // ⚠️ 只对餐厅语料成立。HowToCook 那 368 道本来就是**家庭份量**(鳝丝 400 g、蒜 40 g),
  //    再按人数缩一次就把对的量改错了 —— 老乡鸡那批才是出餐量(水 5600 g、鸡精 40 g)。
  //    所以缩量整套(选人数的 chip + factor)只在非 howtocook 语料上开。
  const scalable = r.source !== 'howtocook';
  const [eaters, setEaters] = useState<number | null>(null);
  const factor = scalable && per && eaters ? servingFactor(eaters, per.servings) : 1;
  const [heroErr, setHeroErr] = useState(false);
  useEffect(() => {
    let live = true;
    recipeNutritionPerServing(r.quantities).then((p) => { if (live) setPer(p); }).catch(() => { if (live) setPer(null); });
    recipeMainNutrition(r.ingredients).then((m) => { if (live) setMain(m); }).catch(() => { if (live) setMain([]); });
    return () => { live = false; };
  }, [r.quantities, r.ingredients]);

  return (
    <>
      {r.image && !heroErr && (
        <img src={recipeImageUrl(r.image)} alt={r.name} loading="lazy" onError={() => setHeroErr(true)}
          style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius-md)', display: 'block', background: 'var(--portal-accent-soft)' }} />
      )}
      {(r.difficulty || r.calories != null) && (
        <p style={{ ...hintLine, marginTop: 0 }}>{[
          r.difficulty ? `${'★'.repeat(r.difficulty)} ${t('难度', 'difficulty')}` : '',
          r.calories != null ? t(`约 ${r.calories} 千卡 / 份`, `≈${r.calories} kcal / serving`) : '',
        ].filter(Boolean).join(' · ')}</p>
      )}
      <section>
        <SectionHead label={t('步骤', 'Steps')} right={per ? t(`原方 ${per.servings} 份`, `${per.servings} servings`) : undefined} rightGo={false} />
        {/* 几个人吃 —— 选了就把步骤里的用量按比例缩。只缩用量,时间/温度/次数不动
            (见 lib/cooking/scale-recipe.ts 的白名单)。 */}
        {scalable && per && per.servings > 1 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" onClick={() => setEaters((cur) => (cur === n ? null : n))} style={{
                ...pill,
                border: '1px solid var(--portal-line)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                padding: 'var(--space-1) var(--space-3)',
                background: eaters === n ? 'var(--portal-accent-soft-md)' : 'transparent',
                color: eaters === n ? 'var(--portal-accent)' : 'var(--portal-muted)',
              }}>
                {t(`${n} 人`, `${n}`)}
              </button>
            ))}
          </div>
        )}
        <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {cookSteps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              <span style={stepNum}>{i + 1}</span><span style={{ paddingTop: 2 }}>{scaleAmountsInText(s, factor)}</span>
            </div>
          ))}
        </div>
        <p style={caption}>{r.source === 'howtocook'
          ? t('克数就是家庭每份量,照着做就行。', 'Amounts are per home serving — cook as written.')
          : t('步骤里的克数是餐厅出餐量,自家做按人数缩着来。', 'Amounts are restaurant-batch sizes — scale down for home.')}</p>
      </section>

      {/* 小贴士不是一个步骤:单独一块,不占编号(用户标注)。 */}
      {cookTips.length > 0 && (
        <section>
          <SectionHead label={t('小贴士', 'Tips')} />
          <div style={{ ...card, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {cookTips.map((s, i) => (
              <p key={i} style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--portal-muted)' }}>{s}</p>
            ))}
          </div>
        </section>
      )}

      {/* 营养 · 每份 · 四列 */}
      <section>
        <SectionHead label={t('营养', 'Nutrition')} right={per ? t(`每份 · 约 ${per.servings} 份`, `per serving · ≈${per.servings}`) : t('每份', 'per serving')} rightGo={false} />
        {per
          ? <>
              <div style={{ ...card, display: 'flex', padding: 'var(--space-4) 0' }}>
                <NutriCol v={`${per.energyKCal}`} label={t('千卡', 'kcal')} />
                <NutriCol v={`${per.protein}g`} label={t('蛋白', 'Protein')} />
                <NutriCol v={`${per.cho}g`} label={t('碳水', 'Carbs')} />
                <NutriCol v={`${per.fat}g`} label={t('脂肪', 'Fat')} last />
              </div>
              {/* 2026-07-28 标注 图26:营养表下面那行出处/免责说明划掉 —— 自己用,知道数从哪来。
                  份数是有信息量的(决定要不要按人数缩),留在小节头右边的「每份」旁边即可。 */}
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
  // 图28:缺的东西不再是「一按全存进去」——每一样先自己点一下选中(pill 从「缺」变「要买」),
  // 底部按钮只加勾过的。缺 8 样但这次只想买 2 样,以前没有办法表达。
  const [picked, setPicked] = useState<string[]>([]);
  function save() {
    if (picked.length === 0) return;
    try { addToShopping(picked); setSaved(true); setMsg(t(`加了 ${picked.length} 样进购物清单`, `${picked.length} added to your list`)); setTimeout(onDone, 900); }
    catch { onError(t('没存上,再试一次。', 'Could not save — try again.')); }
  }
  const rows = [...match.have.map((n) => ({ n, have: true })), ...match.missing.map((n) => ({ n, have: false }))];
  return (
    <>
      {/* 图28:「家庭份量 · 每份用量」那条横幅删掉 —— 份量在菜谱页已经说过一次。 */}

      <section>
        {/* 图28:「需要这些 · 对照你的库存」小标题删掉 —— 右边的「有 / 缺」pill 自己就在做对照。 */}
        <div style={card}>
          {rows.map((r, i) => {
            const on = picked.includes(r.n);
            return (
              <div key={r.n} style={{ ...row, borderBottom: i === rows.length - 1 ? 'none' : divider }}>
                <Dot />
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', fontWeight: 600 }}>{r.n}</span>
                {r.have
                  ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('有', 'Have')}</span>
                  : (
                    <button type="button" aria-pressed={on}
                      onClick={() => setPicked((cur) => (cur.includes(r.n) ? cur.filter((x) => x !== r.n) : [...cur, r.n]))}
                      style={{
                        ...pill, cursor: 'pointer', border: 'none', fontFamily: 'var(--font-sans)',
                        background: on ? 'var(--portal-accent)' : 'var(--portal-accent-soft)',
                        color: on ? 'var(--sheet-opaque, #fff)' : 'var(--portal-muted)',
                      }}>
                      {on ? t('要买', 'Buy') : t('缺', 'Missing')}
                    </button>
                  )}
              </div>
            );
          })}
          {/* 图28:「常备(盐/油等,默认你有)」那一行删掉 —— 它不是这次要处理的东西。 */}
        </div>
      </section>

      {match.missing.length > 0 ? (
        <>
          <button type="button" onClick={save} disabled={saved || picked.length === 0}
            style={{ ...primaryBtn, width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-body)', opacity: saved || picked.length === 0 ? 0.55 : 1 }}>
            {picked.length > 0
              ? t(`加入购物清单 · ${picked.length} 样`, `Add ${picked.length} to shopping list`)
              : t('加入购物清单', 'Add to shopping list')}
          </button>
          {msg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
        </>
      ) : (
        <p style={{ ...hintLine, color: 'var(--status-go)' }}>{t('都齐了 · 直接开做。', 'All set — cook it now.')}</p>
      )}
    </>
  );
}

// ── 新手技法(HowToCook tips 技法文,分组手风琴)─────────────────────────────────
function TipsBody({ t }: { t: TT }) {
  const [tips, setTips] = useState<CookingTip[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [openId, setOpenId] = useState('');
  const load = useCallback(() => {
    setLoadErr(false);
    loadTips().then(setTips).catch(() => setLoadErr(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const order = ['基础', '技法', '进阶'];
    return order
      .map((g) => ({ group: g, items: (tips ?? []).filter((x) => x.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [tips]);

  if (loadErr) return <ErrorRow msg={t('技法文没载出来。', 'Techniques didn’t load.')} onRetry={load} t={t} />;
  if (tips === null) return <p style={hintLine}>{t('翻翻技法…', 'Loading techniques…')}</p>;

  return (
    <>
      {groups.map(({ group, items }) => (
        <section key={group}>
          <SectionHead label={t(group === '基础' ? '先看这些' : group === '技法' ? '基本技法' : '进阶一点', group === '基础' ? 'Start here' : group === '技法' ? 'Core techniques' : 'Going further')} />
          <div style={card}>
            {items.map((tip, i) => {
              const open = openId === tip.id;
              return (
                <div key={tip.id} style={{ borderBottom: i === items.length - 1 ? 'none' : divider }}>
                  <button type="button" onClick={() => setOpenId(open ? '' : tip.id)} aria-expanded={open}
                    style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--portal-ink)' }}>{tip.title}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{open ? t('收起', 'Fold') : t('展开', 'Open')}</span>
                  </button>
                  {open && <TipContent content={tip.content} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p style={caption}>{t('摘自开源家常烹饪手册(HowToCook,公有领域),做菜前翻一眼少踩坑。', 'From the open-source HowToCook handbook (public domain).')}</p>
    </>
  );
}

/** tips Markdown 轻渲染:小标题加粗、列表加点、去强调记号 —— 不引 md 渲染库。 */
function TipContent({ content }: { content: string }) {
  const clean = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
  const blocks = content.split('\n').map((line) => {
    const h = line.match(/^#{2,}\s+(.+)/);
    if (h) return { kind: 'head' as const, text: clean(h[1]) };
    const b = line.match(/^\s*[-*+•]\s+(.+)/);
    if (b) return { kind: 'bullet' as const, text: clean(b[1]) };
    const n = line.match(/^\s*(\d+)[.、)]\s*(.+)/);
    if (n) return { kind: 'bullet' as const, text: `${n[1]}. ${clean(n[2])}` };
    const text = clean(line);
    return text ? { kind: 'para' as const, text } : null;
  }).filter(Boolean) as Array<{ kind: 'head' | 'bullet' | 'para'; text: string }>;

  return (
    <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {blocks.map((b, i) => b.kind === 'head'
        ? <div key={i} style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--portal-ink)', marginTop: i === 0 ? 0 : 'var(--space-2)' }}>{b.text}</div>
        : b.kind === 'bullet'
          ? <div key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.7, paddingLeft: 'var(--space-3)' }}>· {b.text}</div>
          : <div key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.7 }}>{b.text}</div>)}
    </div>
  );
}

// ── 记一餐(进食事件)──────────────────────────────────────────────────────────
const MEAL_SOURCES: MealSource[] = ['自己做', '餐厅', '外卖', '其他'];
/** 记一餐识别指令:认菜品(不是食材),名字用通用名,估克数进 attributes.grams。 */
function mealPhotoPrompt(en: boolean): string {
  return en
    ? 'This is a photo of a meal about to be eaten. For EACH distinct dish/food on the plate(s), create ONE object node named with the dish\'s common name (e.g. "fried rice", "grilled chicken leg", "tomato & egg stir-fry"). If you can estimate this serving\'s weight, put it in attributes.grams (a number, grams). Do NOT list raw ingredients separately, do NOT create place/person nodes, and do NOT create a summary node.'
    : '这是一张正要吃的餐食照片。请为照片里每一道菜/食物单独生成一个 object 节点,节点名用菜品的通用名(如「蛋炒饭」「烤鸡腿」「番茄炒蛋」);能估出这一份的克数就放进 attributes.grams(数字,克)。不要把一道菜拆成生食材,不要生成地点或人物节点,不要生成汇总节点。';
}
function MealLogBody({ photoUrl, photoFile, onError, onDone, t }: { photoUrl?: string; photoFile?: File | null; onError: (m: string) => void; onDone: () => void; t: TT }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<MealSource>('自己做');
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [price, setPrice] = useState('');   // 餐厅/外卖花了多少 —— 用来认领银行流水,不记账
  const [nutri, setNutri] = useState<{ ek: number; p: number; f: number; c: number; matched: number } | null>(null);
  const [saved, setSaved] = useState(false);
  // 拍照识别三态:loading / error(带重试) / done。异步动作必须有可见失败态。
  const [recog, setRecog] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const recognizePhoto = useCallback(async () => {
    if (!photoFile) return;
    setRecog('loading');
    try {
      const { compressToDataUrl } = await import('@/lib/portal/local-image-store');
      const dataUrl = await compressToDataUrl(photoFile);
      if (!dataUrl) throw new Error('compress_failed');
      const en = dict.toLowerCase().startsWith('en');
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
        body: JSON.stringify({
          type: 'image',
          content: mealPhotoPrompt(en),
          imageBase64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg',
          uiLocale: dict,
        }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: Array<{ name?: string; attributes?: Record<string, unknown> }> };
      if (!data.ok || !data.nodes?.length) throw new Error('no_result');
      const found: MealItem[] = [];
      for (const n of data.nodes) {
        const nm = String(n.name || '').trim();
        if (!nm || nm.length > 40) continue;
        const g = Number(n.attributes?.grams);
        found.push({ name: nm, ...(Number.isFinite(g) && g > 0 ? { grams: Math.round(g) } : {}) });
      }
      if (!found.length) throw new Error('no_result');
      setItems((prev) => {
        const have = new Set(prev.map((i) => i.name));
        return [...prev, ...found.filter((i) => !have.has(i.name))];
      });
      setRecog('done');
    } catch {
      setRecog('error');
    }
  }, [photoFile, dict]);
  useEffect(() => { if (photoFile) void recognizePhoto(); }, [photoFile, recognizePhoto]);

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
      const today = localDayKey();
      const p = Number(price);
      addMeal({
        source, items: next, energyKCal: nutri?.ek ?? 0, protein: nutri?.p ?? 0, fat: nutri?.f ?? 0, cho: nutri?.c ?? 0,
        occurredAt: today,
        // 只在真填了正数时带上 —— 空字符串 Number() 是 0,存 0 会让「没记价格」
        // 和「免费」长得一模一样(actualSpend 那条注释说的就是这个)。
        ...(Number.isFinite(p) && p > 0 ? { price: p } : {}),
      });
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
          {recog === 'loading' && (
            <p style={{ margin: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }} role="status">
              {t('正在认这餐吃了什么…', 'Recognizing what this meal is…')}
            </p>
          )}
          {recog === 'error' && (
            <p style={{ margin: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--status-risk)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }} role="alert">
              {t('没认出来 —— 可以手动加,或', 'Could not recognize — add manually, or')}
              <button type="button" onClick={() => void recognizePhoto()} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--portal-accent)', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {t('再试一次', 'retry')}
              </button>
            </p>
          )}
          {recog === 'done' && (
            <p style={{ margin: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }} role="status">
              {t('已按照片预填,不对可以删掉或改克数。', 'Prefilled from the photo — remove or edit anything that looks off.')}
            </p>
          )}
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

      {/* 花了多少 —— 只在「餐厅/外卖」时问:自己做的饭没有单笔价格。
          ⚠️ 这个数**不记一笔账**。在外面吃是刷卡的,Plaid 已经有那条流水,
          再记一笔就是双计(月支出凭空多一份,两条看起来都对)。
          它的用途是让这一餐能去**认领**银行里的那笔钱 —— 认领之后
          「这顿饭花了多少」才是一个能回答的问题。 */}
      {(source === '餐厅' || source === '外卖') && (
        <section>
          <SectionHead label={t('花了多少', 'What it cost')} right={t('可留空', 'optional')} />
          <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input style={{ ...inputStyle, flex: 1 }} inputMode="decimal"
              placeholder={t('金额(用来对上银行那笔,不会重复记账)', 'Amount — used to match your bank, not double-logged')}
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </section>
      )}

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

      {/* 最近记了价格的几餐 —— 在这里认领银行里的那笔钱。
          不列没记价格的:那些配不了(claimCandidates 要求 price>0),摆出来就是一排
          点了没反应的按钮。 */}
      <RecentMealsToClaim t={t} />
    </>
  );
}

/**
 * RecentMealsToClaim — 「这顿饭花了多少」。
 *
 * 记了价格的几餐,每一餐一行「这笔钱是哪一笔」。认领的是**银行里已有的那笔流水**,
 * 不是再记一笔账。认领之后金额以银行为准 —— 你填的是回忆,银行是事实。
 */
function RecentMealsToClaim({ t }: { t: TT }) {
  const dict = t('zh', 'en');
  const [tick, setTick] = useState(0);
  const meals = useMemo(() => {
    void tick;
    try { return getMeals().filter((m) => (m.price ?? 0) > 0).slice(0, 5); } catch { return []; }
  }, [tick]);
  if (!meals.length) return null;
  return (
    <section>
      <SectionHead label={t('这几顿花了多少', 'What these cost')} right={t('对上银行', 'match bank')} />
      <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {meals.map((m) => (
          <div key={m.id}>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--portal-ink)' }}>
              {m.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(' · ') || t('一餐', 'A meal')}
              <span style={{ color: 'var(--portal-muted)', fontWeight: 400 }}> · {m.occurredAt}</span>
            </p>
            <SpendClaimRow
              itemNodeId={m.id}
              item={{ id: m.id, name: m.items.map((i) => i.name).filter(Boolean)[0] || t('一餐', 'A meal'), price: m.price ?? 0, occurredAt: m.occurredAt }}
              dict={dict}
              onChanged={() => setTick((v) => v + 1)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 美食日历(Bug4 图25 / 图27)──────────────────────────────────────────────
//
// 从「做饭计划」改过来。旧版是一份**算出来**的一周排菜:七行长得一样、右边七个 pill、
// 每行就地打字改菜名 —— 而且改完不落盘,退出去就没了。用户的三条要求把它整个换了个方向:
//   ① 一天应该有三顿饭(早/午/晚),不是一天一格;
//   ② 这里**只显示已经有的安排** —— 没排的格子就是空的,不替你猜、不替你填;
//   ③ 编辑是点进详情页,不在列表里就地改。
// 「外食」那个状态也一并删掉:没安排 ≠ 出去吃,把空当成一个状态是在替用户下结论。
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CAL_DAYS = 7;

function PlanBody({ recipes, pantryNames, onError, onEdit, t }: {
  recipes: Recipe[] | null; pantryNames: Set<string>; onError: (m: string) => void;
  onEdit: (date: string, slot: MealSlot) => void; t: TT;
}) {
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);
  const dict = t('zh', 'en');
  const days = dict === 'zh' ? WEEK_DAYS : WEEK_DAYS_EN;

  useEffect(() => {
    const h = () => setTick((n) => n + 1);
    window.addEventListener(MEAL_CALENDAR_EVENT, h);
    return () => window.removeEventListener(MEAL_CALENDAR_EVENT, h);
  }, []);

  const dates = useMemo(() => upcomingDayKeys(CAL_DAYS), []);
  // tick 是刻意的依赖:日历是同步读快照,靠上面的事件通知重读。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cal = useMemo(() => dates.map((d) => ({ date: d, plan: getDayPlan(d) })), [dates, tick]);

  /** 排上的菜合起来还差什么 —— 只按已安排的算,不含没排的格子。 */
  const missingAll = useMemo(() => {
    if (!recipes) return [];
    const miss = new Set<string>();
    for (const name of plannedDishes(dates)) {
      const r = recipes.find((x) => x.name === name) ?? recipes.find((x) => x.name.includes(name) || name.includes(x.name));
      if (!r) continue;
      const m = matchRecipe(r, pantryNames, normalizeIngredient);
      if (!m.canCook) m.missing.forEach((x) => miss.add(x));
    }
    return [...miss];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, pantryNames, dates, tick]);

  function save() {
    if (!missingAll.length) return;
    try {
      addToShopping(missingAll);
      setSaved(true);
      setMsg(t(`${missingAll.length} 样加进购物清单了`, `${missingAll.length} added to your shopping list`));
      setTimeout(() => setMsg(''), 2200);
    } catch { onError(t('没存上,再试一次。', 'Could not save — try again.')); }
  }

  const todayKey = dayKey(new Date());
  return (
    <>
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {cal.map(({ date, plan }, i) => {
          const d = new Date(`${date}T00:00:00`);
          const isToday = date === todayKey;
          return (
            <div key={date} style={{
              padding: 'var(--space-3)',
              borderBottom: i === cal.length - 1 ? 'none' : divider,
              background: isToday ? 'var(--portal-accent-soft)' : 'transparent',
            }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: isToday ? 'var(--portal-accent)' : 'var(--portal-muted)', marginBottom: 'var(--space-2)' }}>
                {isToday ? t('今天', 'Today') : `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {MEAL_SLOTS.map((slot) => {
                  const dish = plan[slot];
                  return (
                    <button key={slot} type="button" onClick={() => onEdit(date, slot)}
                      aria-label={t(`${MEAL_SLOT_LABEL[slot].zh}餐 · ${dish || '还没排'}`, `${MEAL_SLOT_LABEL[slot].en} · ${dish || 'not planned'}`)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                        padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: divider,
                        background: dish ? 'var(--glass-bg-solid)' : 'transparent',
                      }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t(MEAL_SLOT_LABEL[slot].zh, MEAL_SLOT_LABEL[slot].en)}</span>
                      <span style={{
                        display: 'block', fontSize: 'var(--text-sm)', marginTop: 2,
                        color: dish ? 'var(--portal-ink)' : 'var(--portal-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{dish || '+'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {missingAll.length > 0 && (
        <button type="button" onClick={save} disabled={saved}
          style={{ ...primaryBtn, width: '100%', padding: 'var(--space-3)', fontSize: 'var(--text-body)', opacity: saved ? 0.55 : 1 }}>
          {saved ? t('已加进购物清单', 'Added to shopping list') : t(`差 ${missingAll.length} 样 · 加进购物清单`, `${missingAll.length} short · add to shopping list`)}
        </button>
      )}
      {msg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
    </>
  );
}

/** 图27:日历一格的详情页 —— 排哪道菜、或把这一顿清掉。 */
function PlanEditBody({ date, slot, recipes, matches, t }: {
  date: string; slot: MealSlot; recipes: Recipe[] | null; matches: RecipeMatch<Recipe>[]; t: TT;
}) {
  const [q, setQ] = useState(() => getDayPlan(date)[slot] ?? '');
  const suggestions = useMemo(() => {
    const query = q.trim();
    if (query) return (recipes ?? []).filter((r) => r.name.includes(query)).slice(0, 8);
    // 没打字时给「手上材料最接近」的几道 —— 排菜时最想先看到的就是这几道。
    return matches.slice(0, 8).map((m) => m.recipe);
  }, [q, recipes, matches]);

  const d = new Date(`${date}T00:00:00`);
  return (
    <>
      <p style={{ ...hintLine, margin: 0 }}>
        {t(`${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${MEAL_SLOT_LABEL[slot].zh}餐`, `${d.getMonth() + 1}/${d.getDate()} · ${MEAL_SLOT_LABEL[slot].en}`)}
      </p>
      <div style={{ ...card, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 0 }} value={q} autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setMealPlan(date, slot, q); }} />
        <button type="button" style={primaryBtn} onClick={() => setMealPlan(date, slot, q)}>{t('排上', 'Set')}</button>
      </div>
      {getDayPlan(date)[slot] && (
        <button type="button" style={{ ...ghostBtn, width: '100%' }} onClick={() => { setMealPlan(date, slot, null); setQ(''); }}>
          {t('这一顿不排了', 'Clear this meal')}
        </button>
      )}
      {suggestions.length > 0 && (
        <div style={card}>
          {suggestions.map((r, i) => (
            <button key={r.name} type="button" onClick={() => { setQ(r.name); setMealPlan(date, slot, r.name); }}
              style={{ ...row, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === suggestions.length - 1 ? 'none' : divider, cursor: 'pointer' }}>
              <RecipeThumb name={r.name} image={r.image} size={32} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            </button>
          ))}
        </div>
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
      {/* 图29:每格的占位文字删掉 —— 上面已经有标题,框里再写一遍「如『牛奶』」是重复,
          而且它看着像已经填了内容。「可空」更是把「不必填」说成了输入建议。 */}
      <label style={fieldLabel}>{t('食材', 'Food')}
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {/* 图29「日期框飘出界面」:两格并排时 flex item 默认 min-width:auto,
          date 输入自带的日历图标 + 固定内容宽把它撑过父容器 —— minWidth:0 才收得住。 */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <label style={{ ...fieldLabel, flex: 1, minWidth: 0 }}>{t('数量', 'Qty')}
          <input style={{ ...inputStyle, maxWidth: '100%' }} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label style={{ ...fieldLabel, flex: 1, minWidth: 0 }}>{t('有效期', 'Expiry')}
          <input style={{ ...inputStyle, maxWidth: '100%' }} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
      </div>
      {/* 图29:「放哪」从自由输入改成**和分类一模一样**的 tag —— 存放位置本来就只有那几处,
          打字既慢又会把「冰箱」「冰箱里」存成两个地方。
          注意是「和分类一样」:分类那排是纯文字 pill,所以这排也不挂图标,
          否则两排 tag 一排带图标一排不带,又是一处不一致。再点一下取消选择。 */}
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('放哪', 'Where')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {PANTRY_LOCATIONS.map(([zh, en]) => (
          <button key={zh} type="button" onClick={() => setLocation((v) => (v === zh ? '' : zh))}
            style={{ ...chip, ...(location === zh ? chipOn : {}) }}>{t(zh, en)}</button>
        ))}
      </div>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('分类', 'Category')}</span>
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

/**
 * Bug4 图25-30:每一屏顶上都补一个「今天」—— 美味是从洞察宫格里点进来的全屏页,
 * 想回今天原本要「‹ 洞察 → 今天」两步。同时那几屏的大标题按标注删掉(title 不传即可),
 * 屏名由下面的分段 tab 说明,不必再用一行 h1 复述。
 */
function ScreenHead({ backLabel, onBack, page, title, subtitle, subtitleRight, t }: { backLabel: string; onBack: () => void; page?: string; title?: string; subtitle?: string; subtitleRight?: string; t: TT }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <button type="button" onClick={onBack} style={backLink}>‹ {backLabel}</button>
        {/* #37(2026-07-30 真机):三个顶层屏的页头只剩一个「‹ 洞察」,不写自己叫什么。
            左边说的是「点它去哪」,中间说的是「你现在在哪」—— 两件事不能互相顶替。
            大标题 h1 之前按标注删过,所以这里只补一个小号页名,不把标题加回来。 */}
        {page && (
          <span style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page}</span>
        )}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-go-today'))}
          style={{
            flex: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
            color: 'var(--portal-accent)', background: 'var(--portal-accent-soft)', border: '1px solid var(--portal-line)',
            borderRadius: 'var(--radius-pill)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer',
          }}>{t('今天', 'Today')}</button>
      </div>
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
// 2026-07-29:这套内联 tab 是全站五套之一,收敛到 SegTabs。
function SubTabs({ active, onSelect, t }: { active: 'home' | 'pantry' | 'wishlist'; onSelect: (k: 'home' | 'pantry' | 'wishlist') => void; t: TT }) {
  return (
    <SegTabs
      items={[
        { key: 'home' as const, label: t('做饭', 'Cook') },
        { key: 'pantry' as const, label: t('库存', 'Pantry') },
        { key: 'wishlist' as const, label: t('想做清单', 'Wishlist') },
      ]}
      active={active}
      onSelect={onSelect}
      ariaLabel={t('美味视图', 'Cooking view')}
    />
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
/** 菜谱缩略图:无图/加载失败回退菜名首字占位(不出现破图,失败态可见但安静)。 */
/**
 * 卡片尺寸的封面图。和 RecipeThumb 的区别不只是大小 ——
 * **无图态得自己站得住**:库里只有 354/704 道有图,如果把小缩略图那个「方块里一个字」
 * 直接放大到 160px,半屏卡片会像一片没加载出来的破图。
 *
 * 第一版是无图时在封面里排菜名 —— 截图一看就废了:卡脚本来就有菜名,同一个名字
 * 一张卡上出现两次,更像 bug。所以封面无图时只放一枚线性餐具图标(和「排一周食谱」
 * 同一枚),安静地占住位置,名字仍然只由卡脚负责讲一次。
 */
function RecipeCover({ image }: { image?: string | null }) {
  const [err, setErr] = useState(false);
  const url = image ? recipeImageUrl(image) : '';
  const box: React.CSSProperties = { width: '100%', aspectRatio: '4 / 3', display: 'block' };
  if (!url || err) {
    return (
      <span aria-hidden style={{
        ...box, background: 'var(--portal-accent-soft)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--portal-accent-border)',
      }}>
        <IconUtensils size={26} />
      </span>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setErr(true)}
    style={{ ...box, objectFit: 'cover', background: 'var(--portal-accent-soft)' }} />;
}
function RecipeThumb({ name, image, size }: { name: string; image?: string | null; size: number }) {
  const [err, setErr] = useState(false);
  const url = image ? recipeImageUrl(image) : '';
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 'var(--radius-sm)', flex: 'none' };
  if (!url || err) {
    return (
      <span aria-hidden style={{ ...box, background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size >= 40 ? 'var(--text-body)' : 'var(--text-xs)', fontWeight: 700 }}>
        {(name || '').slice(0, 1)}
      </span>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setErr(true)} style={{ ...box, objectFit: 'cover', background: 'var(--portal-accent-soft)' }} />;
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
/* 图28:计划行里的轻动作(换一道 / 这天外食)—— 文字链,不跟主按钮抢注意力。 */
const linkBtn: React.CSSProperties = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--portal-accent)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)' };
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', fontFamily: 'var(--font-sans)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: divider, borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };
const chip: React.CSSProperties = { border: divider, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const chipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 700 };
