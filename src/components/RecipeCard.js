import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch, getStoredUser, imgUrl } from '../api';
import { useToast } from '../contexts/ToastContext';
import { pantryGet, pantrySave, pantryMatches, getCatOverrides, effectiveCategory, ensureGroceryList } from '../utils/grocery';
import StarRating from './StarRating';
import FilterDropdown from './FilterDropdown';
import MiniCalendar from './MiniCalendar';

const CUISINE_PASTELS = {
  italian: '#F5EDE8', mexican: '#E9F2E9', japanese: '#F2EDF4',
  chinese: '#F5EDEC', indian: '#F5F0E8', american: '#EBF0F5',
  french: '#EEF0F8', thai: '#F3F2E7', mediterranean: '#E8F2EF',
  greek: '#EDF0F8', korean: '#F4EDF2',
};
const cuisinePastel = c => CUISINE_PASTELS[(c || '').toLowerCase()] || '#F2F0EB';
const totalTime = r => {
  const t = (r.prep_time || 0) + (r.cook_time || 0);
  return t > 0 ? `${t}m` : null;
};
const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayLabel(date) {
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) return DAY_FULL[date.getDay()];
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RecipeCard({
  recipe,
  onClick,
  showRating = true,
  showServings = false,
  showPublicBadge = false,
  textFallback = false,
}) {
  const location = useLocation();
  const toast = useToast();
  const [imgFailed, setImgFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStep, setMenuStep] = useState('menu'); // 'menu' | 'planner' | 'grocery'
  const [busy, setBusy] = useState(false);
  const [pantry, setPantry] = useState(() => pantryGet());
  const [groceryChecked, setGroceryChecked] = useState({});
  const menuBtnRef = useRef(null);
  const hasImage = !!recipe.image_url && !imgFailed;
  const recipeId = recipe._id || recipe.id;
  const user = getStoredUser();

  const groceryIngredients = (recipe.ingredients || []).filter(ing => !ing.is_section && (ing.name || '').trim());

  const closeMenu = () => { setMenuOpen(false); setMenuStep('menu'); };

  const addToPlannerForDate = async date => {
    const uid = user.id || user._id;
    const dateStr = date.toISOString().split('T')[0];
    setBusy(true);
    try {
      const r = await apiFetch(`/mealPlans/Create/${dateStr}/${uid}/${recipeId}`, { method: 'POST', body: JSON.stringify({}) });
      if (!r.ok) throw new Error();
      toast.success(`Added to ${dayLabel(date)}’s plan`);
    } catch {
      toast.error('Could not add to planner.');
    } finally {
      setBusy(false);
      closeMenu();
    }
  };

  const openGroceryStep = e => {
    e.preventDefault(); e.stopPropagation();
    const p = pantryGet();
    setPantry(p);
    const sel = {};
    groceryIngredients.forEach((ing, i) => { sel[i] = !pantryMatches(ing.name, p); });
    setGroceryChecked(sel);
    setMenuStep('grocery');
  };

  const addIngredientToPantry = name => {
    const val = name.trim().toLowerCase();
    if (!val || pantry.includes(val)) return;
    const next = [...pantry, val];
    setPantry(next);
    pantrySave(next);
    setGroceryChecked(sel => {
      const updated = { ...sel };
      groceryIngredients.forEach((ing, i) => { if (pantryMatches(ing.name, next)) updated[i] = false; });
      return updated;
    });
  };

  const addSelectedToGroceryList = async () => {
    const toAdd = groceryIngredients.filter((_, i) => groceryChecked[i]);
    if (!toAdd.length) return;
    const uid = user.id || user._id;
    setBusy(true);
    try {
      const list = await ensureGroceryList(uid);
      const overrides = getCatOverrides(uid);
      for (const ing of toAdd) {
        await apiFetch(`/groceryList/${list._id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: ing.name,
            quantity: ing.quantity || '',
            unit: ing.unit || '',
            category: effectiveCategory(ing.name, null, overrides),
            checked: false,
          }),
        });
      }
      toast.success(`Added ${toAdd.length} ingredient${toAdd.length === 1 ? '' : 's'} to your grocery list`);
    } catch {
      toast.error('Could not add to grocery list.');
    } finally {
      setBusy(false);
      closeMenu();
    }
  };

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const groceryAllSelected = groceryIngredients.length > 0 && groceryIngredients.every((_, i) => groceryChecked[i]);
  const groceryCheckedCount = groceryIngredients.filter((_, i) => groceryChecked[i]).length;

  const menu = user && (
    <>
      <button
        ref={menuBtnRef}
        type="button"
        className="recipe-card-menu-btn"
        aria-label="Recipe actions"
        onClick={e => {
          e.preventDefault(); e.stopPropagation();
          setMenuStep('menu');
          setMenuOpen(o => !o);
        }}
      >
        ⋮
      </button>
      <FilterDropdown
        open={menuOpen}
        anchorRef={menuBtnRef}
        onClose={closeMenu}
        className={`recipes-dropdown${menuStep === 'grocery' ? ' recipes-dropdown--tags' : ''}`}
      >
        {menuStep === 'menu' ? (
          <>
            <button
              className="recipes-dropdown-item"
              disabled={busy}
              onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuStep('planner'); }}
            >
              📅 Add to planner
            </button>
            <button
              className="recipes-dropdown-item"
              disabled={busy || groceryIngredients.length === 0}
              onClick={openGroceryStep}
            >
              🛒 Add to grocery list
            </button>
          </>
        ) : menuStep === 'planner' ? (
          <div className="recipe-card-planner-pick" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
            <button type="button" className="recipe-card-pick-back" disabled={busy} onClick={() => setMenuStep('menu')}>‹ Back</button>
            <div className="recipe-card-quick-days">
              <button type="button" className="recipe-card-quick-day" disabled={busy} onClick={() => addToPlannerForDate(today)}>Today</button>
              <button type="button" className="recipe-card-quick-day" disabled={busy} onClick={() => addToPlannerForDate(tomorrow)}>Tomorrow</button>
            </div>
            <MiniCalendar selected={today} onSelect={addToPlannerForDate} />
          </div>
        ) : (
          <div className="recipe-card-grocery-pick" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
            <button type="button" className="recipe-card-pick-back" disabled={busy} onClick={() => setMenuStep('menu')}>‹ Back</button>
            {groceryIngredients.length === 0 ? (
              <p className="recipe-card-grocery-empty">No ingredients to add.</p>
            ) : (
              <>
                <div className="recipe-card-grocery-header">
                  <span>{groceryCheckedCount} of {groceryIngredients.length} selected</span>
                  <button
                    type="button"
                    className="recipe-card-grocery-selall"
                    onClick={() => {
                      const next = {};
                      groceryIngredients.forEach((_, i) => { next[i] = !groceryAllSelected; });
                      setGroceryChecked(next);
                    }}
                  >
                    {groceryAllSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="recipe-card-grocery-list">
                  {groceryIngredients.map((ing, i) => {
                    const checked = !!groceryChecked[i];
                    const inPantry = pantryMatches(ing.name, pantry);
                    return (
                      <label key={i} className={`recipe-card-grocery-row${checked ? ' recipe-card-grocery-row--selected' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => setGroceryChecked(s => ({ ...s, [i]: !checked }))} />
                        <span className="recipe-card-grocery-name">{ing.name}</span>
                        {inPantry ? (
                          <span className="recipe-card-grocery-pantry-badge">in pantry</span>
                        ) : (
                          <button
                            type="button"
                            className="recipe-card-grocery-pantry-btn"
                            onClick={e => { e.preventDefault(); e.stopPropagation(); addIngredientToPantry(ing.name); }}
                          >
                            + pantry
                          </button>
                        )}
                        {(ing.quantity || ing.unit) && (
                          <span className="recipe-card-grocery-qty">{[ing.quantity, ing.unit].filter(Boolean).join(' ')}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="recipe-card-grocery-add-btn"
                  disabled={busy || groceryCheckedCount === 0}
                  onClick={addSelectedToGroceryList}
                >
                  Add {groceryCheckedCount} ingredient{groceryCheckedCount === 1 ? '' : 's'}
                </button>
              </>
            )}
          </div>
        )}
      </FilterDropdown>
    </>
  );

  if (!hasImage && textFallback) {
    return (
      <div className="recipe-card recipe-card--text">
        <Link to={`/recipes/${recipeId}`} state={{ from: location.pathname }} className="recipe-card-link" onClick={onClick}>
          <div className="recipe-card-text" style={{ background: cuisinePastel(recipe.cuisine) }}>
            {recipe.category && <span className="recipe-card-text-category">{recipe.category}</span>}
            <div className="recipe-card-title">{recipe.recipe_name}</div>
            <div className="recipe-card-sub">
              {[recipe.cuisine, totalTime(recipe), recipe.servings && `Serves ${recipe.servings}`]
                .filter(Boolean).join(' · ')}
            </div>
            {showRating && (
              <div className="recipe-card-rating">
                <StarRating rating={recipe.avg_rating || 0} showScore={recipe.avg_rating > 0} size="sm" />
              </div>
            )}
          </div>
        </Link>
        {menu}
      </div>
    );
  }

  return (
    <div className="recipe-card">
      <Link to={`/recipes/${recipeId}`} state={{ from: location.pathname }} className="recipe-card-link" onClick={onClick}>
        <div className="recipe-card-img">
          {hasImage
            ? <img src={imgUrl(recipe.image_url)} alt={recipe.recipe_name} onError={() => setImgFailed(true)} />
            : <div className="recipe-placeholder" style={{ background: cuisinePastel(recipe.cuisine) }} />
          }
          <div className="recipe-card-overlay">
            <div className="recipe-card-tags">
              {recipe.cuisine && <span className="recipe-overlay-badge">{recipe.cuisine}</span>}
              {showPublicBadge && recipe.is_public && <span className="recipe-overlay-badge pf-public-badge">public</span>}
              {totalTime(recipe) && <span className="recipe-overlay-time">{totalTime(recipe)}</span>}
            </div>
            <div className="recipe-card-title">{recipe.recipe_name}</div>
            {showServings && recipe.servings && <div className="recipe-card-sub">Serves {recipe.servings}</div>}
            {showRating && (
              <div className="recipe-card-rating">
                <StarRating rating={recipe.avg_rating || 0} showScore={recipe.avg_rating > 0} size="sm" />
              </div>
            )}
          </div>
        </div>
      </Link>
      {menu}
    </div>
  );
}
