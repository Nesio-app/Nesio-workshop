'use client';

/**
 * CookingSheet — 做饭 / 库存(workshop 第二张脸)。「一张图,多张脸」:食材=生活图谱 object 节点,
 * 想做清单/购物清单=记忆节点,相机=拍一拍,营养=本地成分表查表,全复用,不重复造车轮。
 *
 * 五屏路由(对齐设计稿):
 *   home    做饭首页 —— 冰箱里还有这些 · 快过期先用掉 · 用手上的能做 · 生成新菜谱(Pro)· 去库存/想做
 *   pantry  库存    —— 拍小票入库/手动 · 快过期分组 · 充足分组
 *   wishlist 想做清单 —— 攒着想做的菜,选一道算缺料
 *   recipe  菜谱详情 —— 步骤 · 每份营养四列(本地成分表,估算)· 配饮(Pro)
 *   needs   缺料    —— 家庭份缩放 · 有/缺 · 把缺的存进「记忆」当购物清单(闭环)
 *
 * 主线全免费·确定性(有什么→做什么 / 快过期→先用);云生成是 Pro 点缀。
 * 每个异步动作有显式失败态;文案暖教练、不用红色制造焦虑;全用设计 token、无 emoji、线性图标。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { IconUtensils, IconClock, IconBox, IconMapPin, IconCamera, IconCheckSquare, IconZap, IconStar, IconChevronRight, IconSnowflake } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  listPantry, addPantry, consumePantry, removePantry, expiringPantry,
  PANTRY_CATEGORIES, type PantryItem,
} from '@/lib/cooking/pantry';
import { normalizeIngredient } from '@/lib/cooking/food-catalog';
import { loadRecipes, recipeImageUrl, type Recipe } from '@/lib/cooking/food-data';
import { matchRecipe, matchRecipes, type RecipeMatch } from '@/lib/cooking/recipe-match';
import { getShoppingList, addToShopping, toggleShoppingItem, removeShoppingItem, checkoutBought, type ShoppingItem } from '@/lib/cooking/shopping';
import { recipeNutritionPerServing, recipeMainNutrition, type PerServing, type FoodNutrition } from '@/lib/cooking/nutrition';
import { getWishlist, addWish, removeWish, type WishDish } from '@/lib/cooking/wishlist';

type View =
  | { kind: 'home' }
  | { kind: 'pantry' }
  | { kind: 'wishlist' }
  | { kind: 'recipe'; match: RecipeMatch<Recipe> }
  | { kind: 'needs'; match: RecipeMatch<Recipe> };

export default function CookingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  useEffect(() => { if (open) { reload(); setView({ kind: 'home' }); } }, [open, reload]);

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

  const openCamera = useCallback(() => camInputRef.current?.click(), []);
  const onCamFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    // 拍一拍:先原生拍照拿到文件,再交给现有主相机识别(同一条已验证路径,不走无文件取景)。
    if (f) window.dispatchEvent(new CustomEvent('nesio-open-cooking-camera', { detail: { file: f } }));
  }, []);

  // 想做清单选一道 → 在菜谱库找同名 → 去缺料屏;找不到就轻提示。
  const computeNeeds = useCallback((dishName: string) => {
    if (!recipes) return;
    const r = recipes.find((x) => x.name === dishName)
      ?? recipes.find((x) => x.name.includes(dishName) || dishName.includes(x.name));
    if (!r) { setErr(t(`菜谱库里还没有「${dishName}」,先加进库存或换一道。`, `No recipe for "${dishName}" yet — add pantry items or pick another.`)); return; }
    setErr('');
    setView({ kind: 'needs', match: matchRecipe(r, pantryNames, normalizeIngredient) });
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

  const title = view.kind === 'recipe' ? view.match.recipe.name
    : view.kind === 'needs' ? t('缺什么', 'Shopping for it')
    : view.kind === 'pantry' ? t('库存', 'Pantry')
    : view.kind === 'wishlist' ? t('想做清单', 'Want to cook')
    : t('做饭', 'Cooking');
  const atHome = view.kind === 'home';

  return (
    <NesioSheet variant="fullscreen" open={open} onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel={t('做饭 · 库存', 'Cooking · Pantry')}>
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onCamFile} />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--portal-line)' }}>
          {atHome
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--portal-accent)' }}><IconUtensils size={20} /></span>
            : <button type="button" onClick={() => setView({ kind: 'home' })} style={backBtn}>‹ {t('返回', 'Back')}</button>}
          <h2 style={{ margin: 0, fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('关闭', 'Close')} style={{ ...backBtn, textAlign: 'right' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {err && <ErrorRow msg={err} onRetry={() => { setErr(''); reload(); }} t={t} />}

          {view.kind === 'home' && (
            <HomeView
              soon={soon} matches={matches} recipes={recipes} recipesErr={recipesErr}
              pantryCount={items.length} wishCount={wishes.length} shopCount={shopping.length}
              onLoadRec={loadRec} onConsume={consume} onOpenRecipe={(m) => setView({ kind: 'recipe', match: m })}
              onGoPantry={() => setView({ kind: 'pantry' })} onGoWishlist={() => setView({ kind: 'wishlist' })}
              t={t}
            />
          )}
          {view.kind === 'pantry' && (
            <PantryView items={items} shopping={shopping} onCamera={openCamera} onConsume={consume} onRemove={remove} onError={setErr} onChanged={reload} t={t} />
          )}
          {view.kind === 'wishlist' && (
            <WishlistView wishes={wishes} onCompute={computeNeeds} onError={setErr} onChanged={reload} onCamera={openCamera} t={t} />
          )}
          {view.kind === 'recipe' && (
            <RecipeDetail match={view.match} onNeeds={() => setView({ kind: 'needs', match: view.match })} t={t} />
          )}
          {view.kind === 'needs' && (
            <NeedsView match={view.match} onError={setErr} onDone={() => setView({ kind: 'home' })} t={t} />
          )}
        </div>
      </div>
    </NesioSheet>
  );
}

// ── 屏1 做饭首页 ──────────────────────────────────────────────────────────────
function HomeView({ soon, matches, recipes, recipesErr, pantryCount, wishCount, shopCount, onLoadRec, onConsume, onOpenRecipe, onGoPantry, onGoWishlist, t }: {
  soon: PantryItem[]; matches: RecipeMatch<Recipe>[]; recipes: Recipe[] | null; recipesErr: boolean;
  pantryCount: number; wishCount: number; shopCount: number;
  onLoadRec: () => void; onConsume: (id: string) => void; onOpenRecipe: (m: RecipeMatch<Recipe>) => void;
  onGoPantry: () => void; onGoWishlist: () => void; t: TT;
}) {
  return (
    <>
      <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{t('冰箱里还有这些', 'Here’s what’s in the fridge')}</p>

      {/* 快过期·先用掉 —— 横向卡片,琥珀,别浪费 */}
      {soon.length > 0 && (
        <section>
          <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconClock size={12} />{t('快过期 · 先用掉', 'Use these first')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 'var(--space-1)', margin: '0 calc(-1 * var(--space-1))', scrollSnapType: 'x proximity' }}>
            {soon.slice(0, 6).map((it) => (
              <div key={it.id} style={{ flex: 'none', width: 148, scrollSnapAlign: 'start', background: 'var(--status-gentle-soft)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)' as unknown as number, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qtyName(it)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--status-gentle)' }}>{freshLabel(it.daysLeft, t)}</div>
                <button type="button" onClick={() => void onConsume(it.id)} style={{ ...primaryBtn, background: 'var(--status-gentle)', marginTop: 'auto' }}>{t('用掉一份', 'Use one')}</button>
              </div>
            ))}
          </div>
          <p style={caption}>{t('别浪费 —— 快到期的先动手。', 'Don’t let it go to waste — start with what’s expiring.')}</p>
        </section>
      )}

      {/* 用手上的能做 —— 免费·材料齐了 */}
      <section>
        <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconUtensils size={12} />{t('用手上的能做', 'Cook with what you have')}</p>
        {recipesErr && <ErrorRow msg={t('菜谱没载出来。', 'Recipes didn’t load.')} onRetry={onLoadRec} t={t} />}
        {!recipesErr && recipes === null && <p style={mutedLine}>{t('翻翻菜谱…', 'Looking through recipes…')}</p>}
        {!recipesErr && recipes !== null && matches.length === 0 && (
          <p style={mutedLine}>{pantryCount === 0
            ? t('先去库存加两样,这里就冒出「手上能做的菜」。', 'Add a couple of things to the pantry and cookable dishes appear here.')
            : t('现有的还凑不齐一道菜,再补两样试试。', 'Not quite enough for a dish yet — add a couple more.')}</p>
        )}
        {matches.length > 0 && (
          <div style={cardStyle}>
            {matches.map((m, i) => (
              <button key={m.recipe.name} type="button" onClick={() => onOpenRecipe(m)}
                style={{ ...rowStyle, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: i === matches.length - 1 ? 'none' : '1px solid var(--portal-line)', cursor: 'pointer' }}>
                <RecipeThumb image={m.recipe.image} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.recipe.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{m.recipe.category}</div>
                </div>
                {m.canCook
                  ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('材料齐', 'Ready')}</span>
                  : <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{t(`缺 ${m.missing.length} 样`, `${m.missing.length} to buy`)}</span>}
              </button>
            ))}
          </div>
        )}
        {matches.some((m) => m.canCook) && <p style={caption}>{t('免费 · 这些手上材料齐了,直接开做。', 'Free · these are ready with what you already have.')}</p>}
      </section>

      {/* 生成新菜谱(Pro 点缀,云) */}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'cooking_recipe_ai' } }))}
        style={{ ...primaryBtn, width: '100%', padding: 'var(--space-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-body)' }}>
        <IconZap size={16} />{t('生成新菜谱', 'Generate a new recipe')}
        <span style={{ ...pill, background: 'rgba(255,255,255,.22)', color: '#fff', marginLeft: 'var(--space-1)' }}>Pro</span>
      </button>

      {/* 去 库存 / 想做清单 */}
      <div style={cardStyle}>
        <NavRow icon={<IconBox size={18} />} label={t('库存', 'Pantry')}
          sub={pantryCount > 0 ? t(`${pantryCount} 样 · ${shopCount > 0 ? `购物清单 ${shopCount}` : '看看还有啥'}`, `${pantryCount} items${shopCount > 0 ? ` · ${shopCount} to buy` : ''}`) : t('还没记 · 拍小票入库', 'Empty · snap a receipt')}
          onClick={onGoPantry} last={false} />
        <NavRow icon={<IconStar size={18} />} label={t('想做清单', 'Want to cook')}
          sub={wishCount > 0 ? t(`${wishCount} 道想做的菜`, `${wishCount} saved`) : t('攒着想做的菜,选一道算缺料', 'Save dishes, plan the shopping')}
          onClick={onGoWishlist} last />
      </div>
    </>
  );
}

// ── 屏2 库存 ──────────────────────────────────────────────────────────────────
function PantryView({ items, shopping, onCamera, onConsume, onRemove, onError, onChanged, t }: {
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
        : (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button type="button" onClick={onCamera} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconCamera size={14} />{t('拍小票入库', 'Snap a receipt')}</button>
            <button type="button" onClick={() => setShowAdd(true)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><IconBox size={14} />{t('手动添加', 'Add by hand')}</button>
          </div>
        )}

      {items.length === 0 && !showAdd && (
        <p style={{ ...mutedLine, lineHeight: 1.6 }}>
          {t('还没记库存。拍张小票或手动加一样 —— 之后「快过期先用」「手上能做什么」就都有了。',
            'Pantry is empty. Snap a receipt or add by hand — then expiry nudges and cookable dishes appear.')}
        </p>
      )}

      {soon.length > 0 && (
        <section>
          <p style={{ ...sectLabel, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--status-gentle)' }}><IconClock size={12} />{t('快过期', 'Expiring soon')}</p>
          <div style={{ ...cardStyle, background: 'var(--status-gentle-soft)', borderColor: 'transparent' }}>
            {soon.map((it, i) => <PantryRow key={it.id} it={it} last={i === soon.length - 1} onConsume={onConsume} onRemove={onRemove} t={t} />)}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <p style={sectLabel}>{t('充足', 'Well stocked')}</p>
          <div style={cardStyle}>
            {rest.map((it, i) => <PantryRow key={it.id} it={it} last={i === rest.length - 1} onConsume={onConsume} onRemove={onRemove} t={t} />)}
          </div>
        </section>
      )}

      {/* 购物清单闭环:缺料 → 记忆 → 到店勾选 → 回流库存。它是一条「记忆」,可搜、随云走。 */}
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
                <button type="button" onClick={() => removeShop(s.name)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={checkout} disabled={shopChecked === 0} style={{ ...primaryBtn, opacity: shopChecked === 0 ? 0.6 : 1 }}>{t('买到的 → 回流库存', 'Bought → into pantry')}</button>
            {shopMsg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>{shopMsg}</span>}
          </div>
        </section>
      )}

      <p style={caption}>{t('库存只在你自己的图谱里,随你的云备份走,不共享给别人。', 'Your pantry lives in your own graph and syncs to your cloud only.')}</p>
    </>
  );
}

function PantryRow({ it, last, onConsume, onRemove, t }: { it: PantryItem; last: boolean; onConsume: (id: string) => void; onRemove: (id: string) => void; t: TT }) {
  const frozen = it.category === '冷冻';
  return (
    <div style={{ ...rowStyle, borderBottom: last ? 'none' : rowStyle.borderBottom }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{qtyName(it)}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {it.addedAt && <span>{buyLabel(it.addedAt, t)}</span>}
          {it.location && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconMapPin size={10} />{it.location}</span>}
        </div>
      </div>
      {it.daysLeft != null && it.daysLeft <= 4
        ? <span style={{ ...pill, background: 'transparent', color: 'var(--status-gentle)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>{daysPill(it.daysLeft, t)}</span>
        : frozen
          ? <span style={{ ...pill, background: 'var(--status-calm-soft)', color: 'var(--status-calm)', display: 'inline-flex', alignItems: 'center', gap: 2 }}><IconSnowflake size={11} />{t('冷冻', 'Frozen')}</span>
          : <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('充足', 'Stocked')}</span>}
      <button type="button" onClick={() => void onConsume(it.id)} style={ghostBtn}>{t('用掉', 'Use')}</button>
      <button type="button" onClick={() => void onRemove(it.id)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
    </div>
  );
}

// ── 屏4 想做清单 ──────────────────────────────────────────────────────────────
function WishlistView({ wishes, onCompute, onError, onChanged, onCamera, t }: {
  wishes: WishDish[]; onCompute: (name: string) => void; onError: (m: string) => void; onChanged: () => void; onCamera: () => void; t: TT;
}) {
  const [name, setName] = useState('');
  function add() {
    const nm = name.trim();
    if (!nm) return;
    try { addWish(nm); setName(''); onChanged(); }
    catch { onError(t('没加上,再试一次。', 'Could not add — try again.')); }
  }
  function drop(nm: string) {
    try { removeWish(nm); onChanged(); }
    catch { onError(t('没删成,再试一次。', 'Could not remove — try again.')); }
  }
  return (
    <>
      <div style={{ ...cardStyle, padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder={t('搜个菜名加进来(如「番茄炒蛋」)', 'Type a dish (e.g. tomato & egg)')} value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button type="button" onClick={add} style={primaryBtn}>{t('加进来', 'Add')}</button>
        <button type="button" onClick={onCamera} aria-label={t('拍一张加进来', 'Snap to add')} style={{ ...ghostBtn, padding: 'var(--space-2)' }}><IconCamera size={16} /></button>
      </div>

      {wishes.length === 0
        ? <p style={{ ...mutedLine, lineHeight: 1.6 }}>{t('想做的菜先攒着 —— 朋友推荐的、刷到的、想给家人做的。选一道就能算「还缺什么」。', 'Save dishes you want to make — then pick one to see what’s missing.')}</p>
        : (
          <div style={cardStyle}>
            {wishes.map((w, i) => (
              <div key={w.name} style={{ ...rowStyle, borderBottom: i === wishes.length - 1 ? 'none' : rowStyle.borderBottom }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{w.name}</div>
                  {w.note && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{w.note}</div>}
                </div>
                <button type="button" onClick={() => onCompute(w.name)} style={ghostBtn}>{t('算缺料', 'What’s missing')}</button>
                <button type="button" onClick={() => drop(w.name)} aria-label={t('删除', 'Remove')} style={xBtn}>✕</button>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

// ── 屏3 菜谱详情 ──────────────────────────────────────────────────────────────
function RecipeDetail({ match, onNeeds, t }: { match: RecipeMatch<Recipe>; onNeeds: () => void; t: TT }) {
  const r = match.recipe;
  const img = recipeImageUrl(r.image);
  const [per, setPer] = useState<PerServing | null>(null);
  const [main, setMain] = useState<FoodNutrition[] | null>(null);
  useEffect(() => {
    let live = true;
    recipeNutritionPerServing(r.quantities).then((p) => { if (live) setPer(p); }).catch(() => { if (live) setPer(null); });
    recipeMainNutrition(r.ingredients).then((m) => { if (live) setMain(m); }).catch(() => { if (live) setMain([]); });
    return () => { live = false; };
  }, [r.quantities, r.ingredients]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {img
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" style={{ width: '100%', maxHeight: '32vh', objectFit: 'cover', borderRadius: 'var(--radius-md)' }} draggable={false} />
        : <div style={{ width: '100%', height: 120, borderRadius: 'var(--radius-md)', background: 'var(--portal-accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--portal-accent)' }}><IconUtensils size={32} /></div>}

      {/* 材料齐 / 缺料 —— 绿色横幅 */}
      {match.canCook
        ? <div style={{ ...banner, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}><IconCheckSquare size={16} />{t('材料齐了 · 手上就能做', 'All set — cook it now')}</div>
        : <button type="button" onClick={onNeeds} style={{ ...banner, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)', border: 'none', cursor: 'pointer', width: '100%', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}><IconBox size={16} />{t(`还缺 ${match.missing.length} 样 · 看看要买什么`, `${match.missing.length} to buy · plan the shopping`)}</span>
            <IconChevronRight size={16} />
          </button>}

      <section>
        <p style={sectLabel}>{t('步骤', 'Steps')}</p>
        <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              <span style={stepNum}>{i + 1}</span><span>{s}</span>
            </div>
          ))}
        </div>
        <p style={caption}>{t('步骤里的克数是餐厅出餐量,自家做按人数缩着来。', 'Amounts are restaurant-batch sizes — scale down for home.')}</p>
      </section>

      {/* 每份营养 —— 四列,本地成分表估算 */}
      <section>
        <p style={sectLabel}>{t('营养 · 每份 · 估算', 'Nutrition · per serving · est.')}</p>
        {per
          ? <>
              <div style={{ ...cardStyle, display: 'flex', padding: 'var(--space-3) 0' }}>
                <NutriCol v={`${per.energyKCal}`} label={t('千卡', 'kcal')} />
                <NutriCol v={`${per.protein}g`} label={t('蛋白', 'Protein')} />
                <NutriCol v={`${per.cho}g`} label={t('碳水', 'Carbs')} />
                <NutriCol v={`${per.fat}g`} label={t('脂肪', 'Fat')} last />
              </div>
              <p style={caption}>{t(`按约 ${per.servings} 份估 · 基于《中国食物成分表》查表加总,可食部,仅供参考。`, `≈${per.servings} servings · from China Food Composition Table, edible portion, reference only.`)}</p>
            </>
          : main && main.length > 0
            ? <>
                <div style={cardStyle}>
                  {main.map((f, i) => (
                    <div key={f.foodName} style={{ ...rowStyle, borderBottom: i === main.length - 1 ? 'none' : rowStyle.borderBottom }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.foodName}</span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{Math.round(f.energyKCal)} kcal · {t('蛋白', 'P')} {f.protein}g</span>
                    </div>
                  ))}
                </div>
                <p style={caption}>{t('每100g 可食部 · 部分食材名对不齐时只显对上的,基于《中国食物成分表》,估算。', 'Per 100g edible · from China Food Composition Table, estimate.')}</p>
              </>
            : <p style={mutedLine}>{main === null ? t('查营养中…', 'Looking up nutrition…') : t('这道菜的食材名暂时对不齐成分表,先不显示假数。', 'Ingredient names don’t line up with the table yet — no fake numbers.')}</p>}
      </section>

      {/* 配饮(Pro 点缀) */}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'cooking_pairing_ai' } }))}
        style={{ ...cardStyle, padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'left', cursor: 'pointer', background: 'var(--portal-accent-soft)', borderColor: 'transparent' }}>
        <span style={{ color: 'var(--portal-accent)' }}><IconZap size={18} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{t('配个饮 · 搭配建议', 'Pair a drink · suggestions')}</span>
          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('云生成 · 按口味给搭配', 'Cloud · tailored to the dish')}</span>
        </span>
        <span style={{ ...pill, background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)' }}>Pro</span>
      </button>
    </div>
  );
}

// ── 屏5 缺料 ──────────────────────────────────────────────────────────────────
function NeedsView({ match, onError, onDone, t }: { match: RecipeMatch<Recipe>; onError: (m: string) => void; onDone: () => void; t: TT }) {
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);
  function save() {
    try { addToShopping(match.missing); setSaved(true); setMsg(t(`存了 ${match.missing.length} 样进「记忆」`, `${match.missing.length} saved to memory`)); setTimeout(onDone, 900); }
    catch { onError(t('没存上,再试一次。', 'Could not save — try again.')); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ ...banner, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>
        <IconUtensils size={16} />{t(`${match.recipe.name} · 按家庭份算的清单`, `${match.recipe.name} · scaled to a home serving`)}
      </div>

      <section>
        <p style={sectLabel}>{t('这道菜要用', 'For this dish')}</p>
        <div style={cardStyle}>
          {[...match.have.map((n) => ({ n, have: true })), ...match.missing.map((n) => ({ n, have: false }))].map((row, i, arr) => (
            <div key={row.n} style={{ ...rowStyle, borderBottom: i === arr.length - 1 ? 'none' : rowStyle.borderBottom }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-body)' }}>{row.n}</span>
              {row.have
                ? <span style={{ ...pill, background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{t('有', 'Have')}</span>
                : <span style={{ ...pill, background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>{t('缺 · 要买', 'Buy')}</span>}
            </div>
          ))}
          {match.staples.length > 0 && (
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{t('常备(盐/油等,默认你有)', 'Staples (salt/oil, assumed on hand)')}: {match.staples.join(' · ')}</span>
            </div>
          )}
        </div>
      </section>

      {match.missing.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <button type="button" onClick={save} disabled={saved} style={{ ...primaryBtn, width: '100%', padding: 'var(--space-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-body)', opacity: saved ? 0.6 : 1 }}>
            <IconCheckSquare size={16} />{t(`把缺的 ${match.missing.length} 样,存进「记忆」当购物清单`, `Save the ${match.missing.length} missing to your shopping list`)}
          </button>
          {msg && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)', textAlign: 'center' }}>{msg}</span>}
          <p style={caption}>{t('到超市按清单勾一勾;买回自动进库存 —— 闭环。', 'Check items off at the store; what you buy flows back into the pantry — full loop.')}</p>
        </div>
      ) : (
        <p style={{ ...mutedLine, color: 'var(--status-go)' }}>{t('都齐了 · 直接开做。', 'All set — cook it now.')}</p>
      )}
    </div>
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
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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

// ── 小工具 ────────────────────────────────────────────────────────────────────
type TT = (zh: string, en: string) => string;

function NavRow({ icon, label, sub, onClick, last }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; last: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ ...rowStyle, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: last ? 'none' : '1px solid var(--portal-line)', cursor: 'pointer' }}>
      <span style={{ color: 'var(--portal-accent)', display: 'inline-flex' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{sub}</div>
      </div>
      <IconChevronRight size={16} />
    </button>
  );
}
function NutriCol({ v, label, last }: { v: string; label: string; last?: boolean }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 var(--space-2)', borderRight: last ? 'none' : '1px solid var(--portal-line)' }}>
      <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
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
function freshLabel(daysLeft: number | null, t: TT): string {
  if (daysLeft == null) return '';
  if (daysLeft < 0) return t('过了保质期 · 看看还能不能用', 'Past date · check if still good');
  if (daysLeft === 0) return t('今天到期 · 今天用掉', 'Due today · use today');
  if (daysLeft === 1) return t('还有 1 天', '1 day left');
  return t(`还有 ${daysLeft} 天`, `${daysLeft} days left`);
}
function daysPill(daysLeft: number, t: TT): string {
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
    <div style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}>{msg}</span>
      <button type="button" onClick={onRetry} style={ghostBtn}>{t('重试', 'Retry')}</button>
    </div>
  );
}

const backBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-accent)', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-medium)' as unknown as number, cursor: 'pointer', minWidth: 44, padding: 'var(--space-1)' };
const cardStyle: React.CSSProperties = { background: 'var(--portal-bg)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderBottom: '1px solid var(--portal-line)' };
const mutedLine: React.CSSProperties = { color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', margin: 0 };
const caption: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6, margin: 'var(--space-2) 0 0' };
const sectLabel: React.CSSProperties = { fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--portal-muted)', fontWeight: 'var(--weight-semibold)' as unknown as number, margin: '0 0 var(--space-2)' };
const banner: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' as unknown as number };
const stepNum: React.CSSProperties = { flex: 'none', width: 20, height: 20, borderRadius: '50%', background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', display: 'grid', placeItems: 'center', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' as unknown as number };
const pill: React.CSSProperties = { flex: 'none', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' as unknown as number, padding: '2px var(--space-2)', whiteSpace: 'nowrap' };
const primaryBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent)', color: '#fff', fontWeight: 'var(--weight-semibold)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { border: 'none', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-accent)', fontWeight: 'var(--weight-medium)' as unknown as number, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: 'var(--space-1)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)' };
const chip: React.CSSProperties = { border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const chipOn: React.CSSProperties = { background: 'var(--portal-accent-soft-md)', color: 'var(--portal-accent)', borderColor: 'transparent', fontWeight: 'var(--weight-semibold)' as unknown as number };
