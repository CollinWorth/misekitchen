import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch, getStoredUser, imgUrl } from '../api';
import { useToast } from '../contexts/ToastContext';
import StarRating from './StarRating';
import FilterDropdown from './FilterDropdown';

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
  const [busy, setBusy] = useState(false);
  const menuBtnRef = useRef(null);
  const hasImage = !!recipe.image_url && !imgFailed;
  const recipeId = recipe._id || recipe.id;
  const user = getStoredUser();

  const addToPlanner = async e => {
    e.preventDefault(); e.stopPropagation();
    const uid = user.id || user._id;
    const today = new Date().toISOString().split('T')[0];
    setBusy(true);
    try {
      const r = await apiFetch(`/mealPlans/Create/${today}/${uid}/${recipeId}`, { method: 'POST', body: JSON.stringify({}) });
      if (!r.ok) throw new Error();
      toast.success('Added to today’s plan');
    } catch {
      toast.error('Could not add to planner.');
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const addToGroceryList = async e => {
    e.preventDefault(); e.stopPropagation();
    const uid = user.id || user._id;
    setBusy(true);
    try {
      const r = await apiFetch('/groceryList/from-meal-plan', {
        method: 'POST',
        body: JSON.stringify({ user_id: uid, recipe_ids: [recipeId] }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      toast.success(`Added ${data.added ?? 0} item${data.added === 1 ? '' : 's'} to your grocery list`);
    } catch {
      toast.error('Could not add to grocery list.');
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const menu = user && (
    <>
      <button
        ref={menuBtnRef}
        type="button"
        className="recipe-card-menu-btn"
        aria-label="Recipe actions"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(o => !o); }}
      >
        ⋮
      </button>
      <FilterDropdown open={menuOpen} anchorRef={menuBtnRef} onClose={() => setMenuOpen(false)} className="recipes-dropdown">
        <button className="recipes-dropdown-item" disabled={busy} onClick={addToPlanner}>📅 Add to planner</button>
        <button className="recipes-dropdown-item" disabled={busy} onClick={addToGroceryList}>🛒 Add to grocery list</button>
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
