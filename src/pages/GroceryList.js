import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  pantryGet, pantrySave, pantryMatches, PREP_PREFIX_RE,
  SECTIONS, SECTION_MAP, getCatOverrides, saveCatOverride, effectiveCategory,
  ensureGroceryList,
} from '../utils/grocery';
import './css/GroceryList.css';

// ── Fraction-aware quantity parser ────────────────────────────────────────────
function parseFraction(s) {
  if (!s) return 0;
  const str = String(s).trim()
    .replace(/½/g,'1/2').replace(/⅓/g,'1/3').replace(/¼/g,'1/4')
    .replace(/¾/g,'3/4').replace(/⅔/g,'2/3').replace(/⅛/g,'1/8')
    .replace(/⅜/g,'3/8').replace(/⅝/g,'5/8').replace(/⅞/g,'7/8');
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  return parseFloat(str) || 0;
}

// ── Ingredient name normalizer (key for dedup, not display) ──────────────────
// Handles: "garlic, minced" → "garlic", "fresh garlic" → "garlic",
//          "onions" → "onion", "tomatoes" → "tomato", "eggs" → "egg"
function normalizeIngKey(name) {
  let s = (name || '').toLowerCase().trim();
  // Strip everything after a comma: "butter, softened" → "butter"
  s = s.replace(/\s*,.*$/, '').trim();
  // Strip leading prep adjectives: "fresh garlic" → "garlic"
  s = s.replace(PREP_PREFIX_RE, '').trim();
  // Plural normalization (most specific first)
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y'; // berries→berry
  if (s.endsWith('oes') && s.length > 4) return s.slice(0, -2);       // tomatoes→tomato (remove 'es')
  if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && s.length > 3) return s.slice(0, -1); // onions→onion
  return s;
}

// ── Unit normalizer (so "tbsp" and "tablespoon" are treated the same) ─────────
const UNIT_ALIASES = {
  tablespoon:'tbsp', tablespoons:'tbsp', tbs:'tbsp',
  teaspoon:'tsp', teaspoons:'tsp',
  ounce:'oz', ounces:'oz',
  pound:'lb', pounds:'lb', lbs:'lb',
  gram:'g', grams:'g',
  kilogram:'kg', kilograms:'kg',
  milliliter:'ml', milliliters:'ml',
  liter:'l', liters:'l',
  cup:'cup', cups:'cup',
  clove:'clove', cloves:'clove',
  can:'can', cans:'can',
  piece:'piece', pieces:'piece',
  slice:'slice', slices:'slice',
};
function normalizeUnit(u) {
  const lower = (u || '').toLowerCase().trim();
  return UNIT_ALIASES[lower] || lower;
}

// Suggested units for the edit field's datalist (free text is still allowed)
const UNIT_OPTIONS = ['cup', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'clove', 'can', 'bunch', 'pinch', 'dash', 'slice', 'piece', 'pkg', 'sprig', 'stalk'];

// ── Ingredient merging ────────────────────────────────────────────────────────
function mergeIngredients(recipes) {
  // One line per name + unit, so different units never overwrite each other.
  // Every ingredient is kept as a source with its original quantity and unit.
  const result = {};
  for (const recipe of recipes) {
    const mult = recipe._count || 1;
    for (const ing of (recipe.ingredients || [])) {
      if (!(ing.name || '').trim()) continue;
      const { qty: rawQty, unit: rawUnit } = parseQtyUnit(ing.quantity, ing.unit);
      const qty  = rawQty * mult;
      const unit = normalizeUnit(rawUnit);
      const key  = `${normalizeIngKey(ing.name)}|${unit}`;
      const source = {
        recipe_id: recipe._id || null,
        recipe_title: recipe.recipe_name || '',
        quantity: String(ing.quantity || ''),
        unit: ing.unit || '',
        raw_line: [ing.quantity, ing.unit, ing.name].filter(Boolean).join(' '),
      };
      if (result[key]) {
        const ex = result[key];
        if (qty > 0) ex.quantity = fmtQty(parseFraction(ex.quantity) + qty);
        if (ing.name.length > ex.name.length) ex.name = ing.name;
        ex.sources.push(source);
      } else {
        result[key] = {
          name: ing.name,
          quantity: qty > 0 ? fmtQty(qty) : (ing.quantity || ''),
          unit,
          sources: [source],
        };
      }
    }
  }
  return Object.values(result);
}
function fmtQty(n) {
  if (n === Math.trunc(n)) return String(Math.trunc(n));
  // Convert to common fractions for readability
  const fracs = [[1,4],[1,3],[1,2],[2,3],[3,4]];
  for (const [num, den] of fracs) {
    const whole = Math.trunc(n);
    const rem = n - whole;
    if (Math.abs(rem - num/den) < 0.05) return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
  }
  return String(Math.round(n * 100) / 100);
}

const UNITS_RE = /^(cup|cups|tbsp|tbs|tablespoon|tablespoons|tsp|teaspoon|teaspoons|oz|ounce|ounces|fl\s?oz|lb|lbs|pound|pounds|g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|liter|liters|l|quart|quarts|qt|pint|pints|gallon|gallons|clove|cloves|can|cans|bunch|pinch|dash|slice|slices|piece|pieces|sprig|sprigs|stalk|stalks|stick|sticks|head|heads|bulb|bulbs|bag|bags|jar|jars|bottle|bottles|box|boxes|pkg|package|packages)\b/i;

function parseInput(raw) {
  const s = raw.trim();
  const m = s.match(/^([\d\s/½⅓¼¾⅔⅛⅜⅝⅞]+(?:\.\d+)?)\s*/);
  if (!m) return { name: s, quantity: '', unit: '' };
  const quantity = m[1].trim();
  const rest = s.slice(m[0].length);
  const unitMatch = rest.match(UNITS_RE);
  if (unitMatch) {
    const unit = unitMatch[0];
    const name = rest.slice(unit.length).trim();
    return { name: name || rest, quantity, unit };
  }
  return { name: rest, quantity, unit: '' };
}

function parseQtyUnit(qtyStr, unitStr) {
  if (unitStr && unitStr.trim()) return { qty: parseFraction(qtyStr) || 0, unit: unitStr.trim() };
  const s = String(qtyStr || '').trim();
  const numMatch = s.match(/^([\d\s/½⅓¼¾⅔⅛⅜⅝⅞]+(?:\.\d+)?)\s*/);
  if (!numMatch) return { qty: 0, unit: '' };
  const rest = s.slice(numMatch[0].length).trim();
  const unitMatch = rest.match(UNITS_RE);
  if (unitMatch) return { qty: parseFraction(numMatch[1].trim()) || 0, unit: unitMatch[0] };
  return { qty: parseFraction(s) || 0, unit: '' };
}

const QUICK_ITEMS = [
  'Milk', 'Eggs', 'Butter', 'Bread', 'Cheese', 'Yogurt',
  'Onion', 'Garlic', 'Tomatoes', 'Lemons', 'Avocados',
  'Chicken', 'Olive oil', 'Salt', 'Pasta', 'Rice',
];

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function startOfWeek(date) {
  const d = new Date(date); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d;
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function formatDate(date) { return new Date(date).toISOString().split('T')[0]; }

export default function GroceryList({ user }) {
  const toast = useToast();
  const [list, setList]               = useState(null);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [adding, setAdding]           = useState(false);
  const [showMealPlan, setShowMealPlan] = useState(false);
  const [mpWeekStart, setMpWeekStart] = useState(() => startOfWeek(new Date()));
  const [mpLoading, setMpLoading]     = useState(false);
  const [mpMeals, setMpMeals]         = useState([]);
  const [mpSelected, setMpSelected]   = useState(new Set());
  const [mpStep, setMpStep]           = useState(0); // 0=recipes, 1=ingredients
  const [mpIngredients, setMpIngredients] = useState([]); // merged ingredient list
  const [mpIngSelected, setMpIngSelected] = useState({}); // idx → bool
  const [mpMultipliers, setMpMultipliers] = useState({}); // meal_plan_id → multiplier
  const [pantry, setPantry]           = useState(() => pantryGet());
  const [pantryOpen, setPantryOpen]   = useState(false);
  const [newPantryItem, setNewPantryItem] = useState('');
  const [cartOpen, setCartOpen]       = useState(false);
  const [editingItem, setEditingItem] = useState(null); // { itemId, name, quantity, unit }
  const [catOverrides, setCatOverrides] = useState({});
  const inputRef = useRef(null);

  useEffect(() => { if (user) { init(); setCatOverrides(getCatOverrides(user.id || user._id)); } }, [user]); // eslint-disable-line

  const changeCategoryOverride = (itemName, newCat) => {
    const uid = user.id || user._id;
    const updated = saveCatOverride(uid, itemName, newCat);
    setCatOverrides({ ...updated });
    toast.success(`Moved to ${SECTION_MAP[newCat].label}`);
  };

  const loadMpMeals = useCallback(async () => {
    if (!user) return;
    setMpLoading(true);
    const start = formatDate(mpWeekStart);
    const end   = formatDate(addDays(mpWeekStart, 6));
    const uid   = user.id || user._id;
    try {
      const r = await apiFetch(`/groceryList/week-meals?user_id=${uid}&start_date=${start}&end_date=${end}`);
      if (r.ok) {
        const meals = await r.json();
        setMpMeals(meals);
        setMpSelected(new Set(meals.map(m => m.meal_plan_id)));
        setMpMultipliers({});
      }
    } catch {}
    setMpLoading(false);
  }, [mpWeekStart, user]); // eslint-disable-line

  useEffect(() => {
    if (showMealPlan) loadMpMeals();
  }, [showMealPlan, loadMpMeals]);

  const init = async () => {
    setLoading(true);
    try {
      setList(await ensureGroceryList(user.id || user._id));
    } catch {}
    setLoading(false);
  };

  const reloadList = async () => {
    const r = await apiFetch(`/groceryList/listID/${list._id}`);
    if (r.ok) setList(await r.json());
  };

  const addItem = async (itemName, itemQty = '', itemUnit = '') => {
    const parsed = itemName ? { name: itemName, quantity: '', unit: '' } : parseInput(input);
    const name     = itemName  || parsed.name;
    const quantity = itemQty   || parsed.quantity;
    const unit     = itemUnit  || parsed.unit;
    if (!name || !list || adding) return;
    setAdding(true);
    try {
      const cat = effectiveCategory(name, null, catOverrides);
      const res = await apiFetch(`/groceryList/${list._id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, quantity, unit, category: cat, checked: false }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.item) {
          setList(l => ({ ...l, items: [...(l.items || []), data.item] }));
        } else {
          // Merged into an existing row on the server, so show what it stored
          await reloadList();
        }
        if (!itemName) { setInput(''); inputRef.current?.focus(); }
      } else {
        toast.error('Could not add item.');
      }
    } catch {
      toast.error('Could not add item.');
    }
    setAdding(false);
  };

  const quickAdd = (name) => {
    if (!list) return;
    if ((list.items || []).some(i => normalizeIngKey(i.name) === normalizeIngKey(name))) return;
    addItem(name);
  };

  const toggleItem = async (itemId, currentChecked) => {
    setList(l => ({ ...l, items: l.items.map(i => i.id === itemId ? { ...i, checked: !currentChecked } : i) }));
    if (!currentChecked) setCartOpen(true);
    try {
      const res = await apiFetch(`/groceryList/${list._id}/items/${itemId}/check`, { method: 'PATCH' });
      if (!res.ok) throw new Error('failed');
    } catch {
      // Roll back on any failure
      setList(l => ({ ...l, items: l.items.map(i => i.id === itemId ? { ...i, checked: currentChecked } : i) }));
      toast.error('Could not update item.');
    }
  };

  const removeItem = async (itemId) => {
    setList(l => ({ ...l, items: l.items.filter(i => i.id !== itemId) }));
    try {
      const res = await apiFetch(`/groceryList/${list._id}/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
    } catch {
      toast.error('Could not remove item.');
      const r = await apiFetch(`/groceryList/userID/${user.id || user._id}`);
      if (r.ok) { const d = await r.json(); if (d.length) setList(d[0]); }
    }
  };

  const saveEdit = async () => {
    if (!editingItem) return;
    const { itemId, name, quantity, unit } = editingItem;
    const patch = { name: name.trim(), quantity: quantity.trim(), unit: unit.trim() };
    if (!patch.name) { toast.error('Name cannot be empty.'); return; }
    const current = (list.items || []).find(i => i.id === itemId);
    setEditingItem(null);
    if (!current || (current.name === patch.name && (current.quantity || '') === patch.quantity && (current.unit || '') === patch.unit)) return;
    setList(l => ({ ...l, items: l.items.map(i => i.id === itemId ? { ...i, ...patch } : i) }));
    try {
      const res = await apiFetch(`/groceryList/${list._id}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      toast.error('Could not save changes.');
      await reloadList();
    }
  };

  const clearChecked = async () => {
    if (!list) return;
    setList(l => ({ ...l, items: l.items.filter(i => !i.checked) }));
    setCartOpen(false);
    try {
      await apiFetch(`/groceryList/${list._id}?checked_only=true`, { method: 'DELETE' });
    } catch {
      toast.error('Could not clear checked items.');
      const r = await apiFetch(`/groceryList/userID/${user.id || user._id}`);
      if (r.ok) { const d = await r.json(); if (d.length) setList(d[0]); }
    }
  };

  const clearAll = async () => {
    if (!list || !(list.items || []).length) return;
    setList(l => ({ ...l, items: [] }));
    try {
      await apiFetch(`/groceryList/${list._id}`, { method: 'DELETE' });
    } catch {
      toast.error('Could not clear list.');
      const r = await apiFetch(`/groceryList/userID/${user.id || user._id}`);
      if (r.ok) { const d = await r.json(); if (d.length) setList(d[0]); }
    }
  };

  const reviewIngredients = async () => {
    if (mpSelected.size === 0) return;
    setMpLoading(true);
    const selectedMeals = mpMeals.filter(m => mpSelected.has(m.meal_plan_id));
    // Count how many times each recipe_id appears (same recipe on multiple days)
    const countMap = {};
    for (const m of selectedMeals) countMap[m.recipe_id] = (countMap[m.recipe_id] || 0) + (mpMultipliers[m.meal_plan_id] || 1);
    try {
      const uniqueIds = Object.keys(countMap);
      const fetched = await Promise.all(uniqueIds.map(async id => {
        const r = await apiFetch(`/recipes/${id}`);
        if (!r.ok) return null;
        const d = await r.json();
        return { ...d, _count: countMap[id] };
      }));
      const recipes = fetched.filter(Boolean);
      const merged = mergeIngredients(recipes);
      const p = pantryGet();
      setPantry(p);
      const sel = {};
      merged.forEach((ing, i) => { sel[i] = !pantryMatches(ing.name, p); });
      setMpIngredients(merged);
      setMpIngSelected(sel);
      setMpStep(1);
    } catch { toast.error('Could not load ingredients.'); }
    setMpLoading(false);
  };

  const generateFromMealPlan = async () => {
    const toAdd = mpIngredients.filter((_, i) => mpIngSelected[i]);
    if (toAdd.length === 0) return;
    setMpLoading(true);
    try {
      for (const ing of toAdd) {
        await apiFetch(`/groceryList/${list._id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: ing.name, quantity: ing.quantity, unit: ing.unit, category: effectiveCategory(ing.name, null, catOverrides), checked: false, sources: ing.sources }),
        });
      }
      toast.success(`Added ${toAdd.length} ingredient${toAdd.length !== 1 ? 's' : ''}`);
      const r2 = await apiFetch(`/groceryList/userID/${user.id || user._id}`);
      if (r2.ok) { const d2 = await r2.json(); if (d2.length) setList(d2[0]); }
      setShowMealPlan(false);
      setMpStep(0);
    } catch { toast.error('Something went wrong.'); }
    setMpLoading(false);
  };

  const addToPantry = (item) => {
    const val = item.trim().toLowerCase();
    if (!val || pantry.includes(val)) return;
    const next = [...pantry, val];
    setPantry(next);
    pantrySave(next);
    // re-deselect any ingredient matching the new pantry item
    setMpIngSelected(sel => {
      const updated = { ...sel };
      mpIngredients.forEach((ing, i) => {
        if (pantryMatches(ing.name, next)) updated[i] = false;
      });
      return updated;
    });
  };

  const removeFromPantry = (item) => {
    const next = pantry.filter(p => p !== item);
    setPantry(next);
    pantrySave(next);
  };

  const items        = list?.items || [];
  const checkedCount = items.filter(i => i.checked).length;
  const totalCount   = items.length;
  const pct          = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  const grouped = {};
  for (const item of items.filter(i => !i.checked)) {
    const key = effectiveCategory(item.name, item.category, catOverrides);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...item, _effectiveCat: key });
  }
  const sortedGroups = SECTIONS.map(s => s.key).filter(k => grouped[k]?.length > 0);
  const addedNames   = new Set(items.map(i => (i.name || '').toLowerCase()));

  if (!user) return (
    <div className="grocery-splash">
      <div className="grocery-splash-inner">
        <h1>Your grocery list,<br />always with you.</h1>
        <p>Sign in to start building your list.</p>
      </div>
    </div>
  );

  return (
    <div className="grocery-page">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="grocery-header">
        <div className="grocery-header-left">
          <h1>Grocery List</h1>
          {!loading && totalCount > 0 && (
            <span className="grocery-progress">{checkedCount}/{totalCount}</span>
          )}
        </div>
        <div className="grocery-header-actions">
          {checkedCount > 0 && (
            <button className="btn-ghost grocery-action-btn" onClick={clearChecked}>
              Clear {checkedCount} checked
            </button>
          )}
          {totalCount > 0 && (
            <button className="btn-ghost grocery-action-btn grocery-action-btn--danger" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────── */}
      {totalCount > 0 && (
        <div className="grocery-progress-bar-wrap">
          <div className="grocery-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* ── Add bar ─────────────────────────────────────── */}
      <div className="grocery-add-bar">
        <input
          ref={inputRef}
          type="text"
          className="grocery-add-input"
          placeholder='"2 cups flour", "350g chicken", or just "milk"'
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          disabled={loading}
        />
        <button className="btn-primary" onClick={() => addItem()} disabled={adding || !input.trim() || loading}>
          Add
        </button>
      </div>

      {/* ── Quick-add chips ──────────────────────────────── */}
      <div className="quick-add-row">
        {QUICK_ITEMS.filter(n => !addedNames.has(n.toLowerCase())).map(name => (
          <button key={name} className="quick-add-chip" onClick={() => quickAdd(name)}>
            + {name}
          </button>
        ))}
      </div>

      {/* ── Meal plan generator ──────────────────────────── */}
      <div className="mp-bar">
        <button className={`mp-toggle${showMealPlan ? ' mp-toggle--open' : ''}`} onClick={() => { setShowMealPlan(v => !v); setMpStep(0); }}>
          <span>📅</span> Import from meal plan <span className="mp-toggle-arrow">{showMealPlan ? '▲' : '▼'}</span>
        </button>
      </div>
      {showMealPlan && (() => {
        const end = addDays(mpWeekStart, 6);
        const sm  = MONTH_NAMES[mpWeekStart.getMonth()];
        const em  = MONTH_NAMES[end.getMonth()];
        const allSelected = mpMeals.length > 0 && mpMeals.every(m => mpSelected.has(m.meal_plan_id));
        const selectedIngCount = Object.values(mpIngSelected).filter(Boolean).length;
        return (
          <div className="mp-panel">
            {/* ── Step header ─────────────────────────── */}
            {mpStep === 1 ? (
              <div className="mp-step-header">
                <button className="mp-back-btn" onClick={() => setMpStep(0)}>← Back</button>
                <span className="mp-step-title">Review ingredients</span>
              </div>
            ) : (
              <div className="mp-week-nav">
                <button className="mp-nav-btn" onClick={() => setMpWeekStart(d => addDays(d, -7))}>←</button>
                <span className="mp-week-label">{sm} {mpWeekStart.getDate()} – {sm !== em ? em + ' ' : ''}{end.getDate()}</span>
                <button className="mp-nav-btn" onClick={() => setMpWeekStart(d => addDays(d, 7))}>→</button>
              </div>
            )}

            {mpLoading ? (
              <p className="mp-hint">Loading…</p>
            ) : mpStep === 0 ? (
              /* ── Step 0: recipe selection ───────────── */
              mpMeals.length === 0 ? (
                <p className="mp-hint">No meals planned this week.</p>
              ) : (
                <>
                  <div className="mp-meal-header">
                    <span className="mp-meal-count">{mpSelected.size} of {mpMeals.length} selected</span>
                    <button className="mp-sel-btn" onClick={() =>
                      setMpSelected(allSelected ? new Set() : new Set(mpMeals.map(m => m.meal_plan_id)))
                    }>
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="mp-meal-list">
                    {mpMeals.map(meal => (
                      <div key={meal.meal_plan_id} className={`mp-meal-row${mpSelected.has(meal.meal_plan_id) ? ' mp-meal-row--selected' : ''}`}>
                        <input
                          type="checkbox"
                          className="mp-meal-check"
                          checked={mpSelected.has(meal.meal_plan_id)}
                          onChange={() => {
                            const next = new Set(mpSelected);
                            if (next.has(meal.meal_plan_id)) next.delete(meal.meal_plan_id);
                            else next.add(meal.meal_plan_id);
                            setMpSelected(next);
                          }}
                        />
                        <div className="mp-meal-info">
                          <span className="mp-meal-name">{meal.recipe_name}</span>
                          <span className="mp-meal-meta">
                            {meal.date}
                            {meal.servings > 0 && <> · {meal.servings} serving{meal.servings !== 1 ? 's' : ''}</>}
                          </span>
                        </div>
                        <div className="mp-meal-stepper">
                          <button className="mp-stepper-btn" onClick={() => setMpMultipliers(m => ({...m, [meal.meal_plan_id]: Math.max(1, (m[meal.meal_plan_id]||1) - 1)}))}>−</button>
                          <span className={`mp-stepper-val${(mpMultipliers[meal.meal_plan_id]||1) > 1 ? ' mp-stepper-val--active' : ''}`}>×{mpMultipliers[meal.meal_plan_id] || 1}</span>
                          <button className="mp-stepper-btn" onClick={() => setMpMultipliers(m => ({...m, [meal.meal_plan_id]: Math.min(8, (m[meal.meal_plan_id]||1) + 1)}))}>+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn-primary mp-generate-btn"
                    onClick={reviewIngredients}
                    disabled={mpSelected.size === 0}
                  >
                    Review ingredients →
                  </button>
                </>
              )
            ) : (
              /* ── Step 1: ingredient review ──────────── */
              <>
                <div className="mp-meal-header">
                  <span className="mp-meal-count">{selectedIngCount} of {mpIngredients.length} ingredients selected</span>
                  <button className="mp-sel-btn" onClick={() => {
                    const allIng = mpIngredients.every((_, i) => mpIngSelected[i]);
                    const next = {};
                    mpIngredients.forEach((_, i) => { next[i] = !allIng; });
                    setMpIngSelected(next);
                  }}>
                    {mpIngredients.every((_, i) => mpIngSelected[i]) ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="mp-ing-list">
                  {mpIngredients.map((ing, i) => {
                    const checked = mpIngSelected[i] ?? true;
                    const inPantry = pantryMatches(ing.name, pantry);
                    return (
                      <label key={i} className={`mp-ing-row${checked ? ' mp-ing-row--selected' : ''}`}>
                        <input
                          type="checkbox"
                          className="mp-meal-check"
                          checked={checked}
                          onChange={() => setMpIngSelected(s => ({ ...s, [i]: !checked }))}
                        />
                        <span className="mp-ing-name">{ing.name}</span>
                        {inPantry ? (
                          <span className="mp-pantry-badge">in pantry</span>
                        ) : (
                          <button
                            type="button"
                            className="mp-add-pantry-btn"
                            onClick={e => { e.preventDefault(); e.stopPropagation(); addToPantry(ing.name); }}
                            title="Add to pantry"
                          >
                            + pantry
                          </button>
                        )}
                        {(ing.quantity || ing.unit) && (
                          <span className="mp-ing-qty">{[ing.quantity, ing.unit].filter(Boolean).join(' ')}</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* ── Pantry section ───────────────────── */}
                <div className="mp-pantry-section">
                  <button className="mp-pantry-toggle" onClick={() => setPantryOpen(o => !o)}>
                    <span>🏠 My Pantry</span>
                    <span className="mp-toggle-arrow">{pantryOpen ? '▲' : '▼'}</span>
                  </button>
                  {pantryOpen && (
                    <div className="mp-pantry-body">
                      <div className="mp-pantry-chips">
                        {pantry.map(item => (
                          <span key={item} className="mp-pantry-chip">
                            {item}
                            <button className="mp-pantry-remove" onClick={() => removeFromPantry(item)}>×</button>
                          </span>
                        ))}
                      </div>
                      <form className="mp-pantry-add-row" onSubmit={e => { e.preventDefault(); addToPantry(newPantryItem); setNewPantryItem(''); }}>
                        <input
                          className="mp-pantry-input"
                          value={newPantryItem}
                          onChange={e => setNewPantryItem(e.target.value)}
                          placeholder="Add item…"
                        />
                        <button type="submit" className="mp-pantry-add-btn" disabled={!newPantryItem.trim()}>Add</button>
                      </form>
                    </div>
                  )}
                </div>

                <button
                  className="btn-primary mp-generate-btn"
                  onClick={generateFromMealPlan}
                  disabled={selectedIngCount === 0}
                >
                  Add {selectedIngCount} ingredient{selectedIngCount !== 1 ? 's' : ''} to list
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Content ─────────────────────────────────────── */}
      {loading ? (
        <div className="grocery-loading">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="grocery-skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="grocery-empty">
          <p className="grocery-empty-icon">🛒</p>
          <h3>Your list is empty</h3>
          <p>Add items above or tap a quick-add chip to get started.</p>
        </div>
      ) : (
        <div className="grocery-content">
          {sortedGroups.map(key => {
            const section = SECTION_MAP[key];
            return (
              <div key={key} className="grocery-category">
                <div className="grocery-category-header">
                  <span className="grocery-category-icon">{section.icon}</span>
                  <span className="grocery-category-label">{section.label}</span>
                  <span className="grocery-category-count">{grouped[key].length}</span>
                </div>
                <div className="grocery-category-items">
                  {grouped[key].map((item, idx) => (
                    <GroceryItemRow
                      key={item.id || idx}
                      item={{ ...item, category: item._effectiveCat }}
                      editing={editingItem?.itemId === item.id}
                      editItem={editingItem?.itemId === item.id ? editingItem : null}
                      onEditStart={() => setEditingItem({ itemId: item.id, name: item.name, quantity: item.quantity || '', unit: item.unit || '' })}
                      onEditChange={(field, val) => setEditingItem(e => ({ ...e, [field]: val }))}
                      onEditSave={saveEdit}
                      onEditCancel={() => setEditingItem(null)}
                      onToggle={() => toggleItem(item.id, item.checked)}
                      onRemove={() => removeItem(item.id)}
                      onCategoryChange={newCat => changeCategoryOverride(item.name, newCat)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── In cart (collapsible) ───────────────────── */}
          {checkedCount > 0 && (
            <div className="grocery-category grocery-category--checked">
              <button className="grocery-category-header grocery-category-header--btn" onClick={() => setCartOpen(o => !o)}>
                <span className="grocery-category-icon">✓</span>
                <span className="grocery-category-label">In cart</span>
                <span className="grocery-category-count">{checkedCount}</span>
                <span className="grocery-cart-arrow">{cartOpen ? '▲' : '▼'}</span>
              </button>
              {cartOpen && (
                <div className="grocery-category-items">
                  {items.filter(i => i.checked).map((item, idx) => (
                    <GroceryItemRow
                      key={item.id || idx}
                      item={item}
                      editing={false}
                      onToggle={() => toggleItem(item.id, item.checked)}
                      onRemove={() => removeItem(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroceryItemRow({ item, editing, editItem, onEditStart, onEditChange, onEditSave, onEditCancel, onToggle, onRemove, onCategoryChange }) {
  const qtyLabel    = [item.quantity, item.unit].filter(Boolean).join(' ');
  const editRef     = useRef(null);
  const catRef      = useRef(null);
  const [showCatMenu, setShowCatMenu] = useState(false);

  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing]);

  const handleEditKey = (e) => {
    if (e.key === 'Enter') onEditSave();
    if (e.key === 'Escape') onEditCancel();
  };

  useEffect(() => {
    if (!showCatMenu) return;
    const handler = e => { if (catRef.current && !catRef.current.contains(e.target)) setShowCatMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCatMenu]);

  const section = SECTION_MAP[item.category] || SECTION_MAP.other;

  return (
    <div className={`grocery-item${item.checked ? ' grocery-item--checked' : ''}`}>
      <button className="grocery-checkbox" onClick={onToggle} aria-label="Toggle">
        <span className="grocery-checkbox-inner">{item.checked ? '✓' : ''}</span>
      </button>

      {editing ? (
        <div className="grocery-edit-group">
          <input
            ref={editRef}
            className="grocery-edit-qty"
            value={editItem?.quantity || ''}
            onChange={e => onEditChange('quantity', e.target.value)}
            placeholder="Qty"
            onKeyDown={handleEditKey}
          />
          <input
            className="grocery-edit-unit"
            list="grocery-unit-options"
            value={editItem?.unit || ''}
            onChange={e => onEditChange('unit', e.target.value)}
            placeholder="Unit"
            onKeyDown={handleEditKey}
          />
          <datalist id="grocery-unit-options">
            {UNIT_OPTIONS.map(u => <option key={u} value={u} />)}
          </datalist>
          <input
            className="grocery-edit-name"
            value={editItem?.name || ''}
            onChange={e => onEditChange('name', e.target.value)}
            placeholder="Name"
            onKeyDown={handleEditKey}
          />
          <button className="grocery-edit-save" onClick={onEditSave} aria-label="Save item" title="Save">Save</button>
          <button className="grocery-edit-cancel" onClick={onEditCancel} aria-label="Cancel edit" title="Cancel">✕</button>
        </div>
      ) : (
        <span className="grocery-item-name" onClick={onEditStart}>{item.name || '(no name)'}</span>
      )}

      {!editing && qtyLabel && (
        <span className="grocery-item-qty" onClick={onEditStart}>{qtyLabel}</span>
      )}

      {!editing && onCategoryChange && (
        <div className="grocery-cat-wrap" ref={catRef}>
          <button
            className="grocery-cat-btn"
            onClick={() => setShowCatMenu(v => !v)}
            title={`Move from ${section.label}`}
          >
            {section.icon}
          </button>
          {showCatMenu && (
            <div className="grocery-cat-menu">
              <div className="grocery-cat-menu-label">Move to…</div>
              {SECTIONS.filter(s => s.key !== 'other' && s.key !== item.category).map(s => (
                <button
                  key={s.key}
                  className="grocery-cat-option"
                  onClick={() => { onCategoryChange(s.key); setShowCatMenu(false); }}
                >
                  <span>{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <button className="grocery-remove" onClick={onRemove} aria-label="Remove">✕</button>
      )}
    </div>
  );
}
