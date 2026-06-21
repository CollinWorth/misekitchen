import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../api';
import RecipeCard from '../components/RecipeCard';
import FilterDropdown from '../components/FilterDropdown';
import './css/Recipes.css';

const SORT_OPTIONS = [
  { value: 'default',   label: 'Newest first' },
  { value: 'top-rated', label: '★ Top rated' },
  { value: 'az',        label: 'A → Z' },
  { value: 'za',        label: 'Z → A' },
  { value: 'quickest',  label: 'Quickest' },
  { value: 'fewest',    label: 'Fewest ingredients' },
];

const IMPORT_METHODS = [
  { icon: '🔗', label: 'From URL',    desc: 'Any recipe website',   path: '/recipes/add' },
  { icon: '🎵', label: 'From TikTok', desc: 'Paste a TikTok link',  path: '/recipes/add' },
  { icon: '📋', label: 'Paste text',  desc: 'Copy from anywhere',   path: '/recipes/add' },
  { icon: '✍️', label: 'Manually',    desc: 'Type it yourself',     path: '/recipes/add' },
];

export default function Recipes({ user }) {
  const [recipes, setRecipes]           = useState([]);
  const [search, setSearch]             = useState('');
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [activeTags, setActiveTags]     = useState(new Set());
  const [timeFilter, setTimeFilter]     = useState('any');
  const [loading, setLoading]           = useState(true);
  const [sort, setSort]                 = useState('default');
  const [sortOpen, setSortOpen]         = useState(false);
  const [cuisineOpen, setCuisineOpen]   = useState(false);
  const [tagsOpen, setTagsOpen]         = useState(false);
  const [timeOpen, setTimeOpen]         = useState(false);
  const navigate  = useNavigate();
  const sortRef    = useRef(null);
  const cuisineRef = useRef(null);
  const tagsRef    = useRef(null);
  const timeRef    = useRef(null);

  const saveScrollPosition = () => {
    sessionStorage.setItem('recipes_scrollY', String(window.scrollY));
  };

  useEffect(() => {
    const saved = sessionStorage.getItem('recipes_scrollY');
    if (saved) {
      sessionStorage.removeItem('recipes_scrollY');
      requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
    }
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    apiFetch(`/recipes/user/${user.id || user._id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setRecipes(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="recipes-splash">
        <div className="recipes-splash-inner">
          <h1>Your recipes,<br />all in one place.</h1>
          <p>Save, organize, and plan your meals with mise.</p>
          <div className="recipes-splash-actions">
            <Link to="/login" className="btn-primary">Sign in</Link>
            <Link to="/register" className="btn-ghost">Create account</Link>
          </div>
        </div>
      </div>
    );
  }

  const cuisineOptions = Array.from(new Set(recipes.map(r => r.cuisine).filter(Boolean))).sort();

  const allTags = (() => {
    const freq = {};
    recipes.forEach(r => {
      (r.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => {
        freq[t] = (freq[t] || 0) + 1;
      });
    });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  })();

  const toggleTag = tag => setActiveTags(prev => {
    const next = new Set(prev);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    return next;
  });

  const clearFilters = () => {
    setActiveCuisine(null); setActiveTags(new Set());
    setTimeFilter('any'); setSearch(''); setSort('default');
  };
  const hasFilters = activeCuisine || activeTags.size > 0 || timeFilter !== 'any' || search || sort !== 'default';

  const filtered = (() => {
    const q = search.toLowerCase();
    let list = recipes.filter(r => {
      const matchSearch = !q
        || r.recipe_name.toLowerCase().includes(q)
        || (r.category || '').toLowerCase().includes(q)
        || (r.cuisine  || '').toLowerCase().includes(q)
        || (r.tags     || '').toLowerCase().includes(q);
      const matchCuisine = !activeCuisine || r.cuisine === activeCuisine;
      const recipeTags = new Set((r.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
      const matchTags = activeTags.size === 0 || [...activeTags].every(t => recipeTags.has(t));
      const t = (r.prep_time || 0) + (r.cook_time || 0);
      const matchTime = timeFilter === 'any' || (timeFilter === '30' && t > 0 && t <= 30) || (timeFilter === '60' && t > 0 && t <= 60);
      return matchSearch && matchCuisine && matchTags && matchTime;
    });
    if (sort === 'top-rated') list = [...list].sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));
    else if (sort === 'az')   list = [...list].sort((a, b) => a.recipe_name.localeCompare(b.recipe_name));
    else if (sort === 'za')   list = [...list].sort((a, b) => b.recipe_name.localeCompare(a.recipe_name));
    else if (sort === 'quickest') list = [...list].sort((a, b) => {
      const ta = (a.prep_time||0)+(a.cook_time||0), tb = (b.prep_time||0)+(b.cook_time||0);
      if (!ta && !tb) return 0; if (!ta) return 1; if (!tb) return -1; return ta - tb;
    });
    else if (sort === 'fewest') list = [...list].sort((a, b) => (a.ingredients?.length||0)-(b.ingredients?.length||0));
    return list;
  })();

  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="recipes-page">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="recipes-header">
        <div className="recipes-header-top">
          <div>
            <p className="recipes-greeting">{greeting}, {firstName}</p>
            <h1 className="recipes-title">My Recipes</h1>
          </div>
          <button className="btn-primary recipes-add-btn" onClick={() => navigate('/recipes/add')}>
            + Add Recipe
          </button>
        </div>

        {!loading && recipes.length > 0 && (
          <div className="recipes-stats">
            <span className="recipes-stat">{recipes.length} recipe{recipes.length !== 1 ? 's' : ''}</span>
            {cuisineOptions.length > 0 && <><span className="recipes-stat-dot">·</span><span className="recipes-stat">{cuisineOptions.length} cuisine{cuisineOptions.length !== 1 ? 's' : ''}</span></>}
            {hasFilters && <><span className="recipes-stat-dot">·</span><span className="recipes-stat recipes-stat--filtered">{filtered.length} showing</span></>}
          </div>
        )}
      </div>

      {/* ── Controls ────────────────────────────────────── */}
      <div className="recipes-controls">
        <div className="recipes-search-wrap">
          <svg className="recipes-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="search"
            className="recipes-search-input"
            placeholder="Search your recipes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="recipes-search-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
          )}
        </div>

        <div className="recipes-pills-row">

          {/* Sort */}
          <div className="recipes-pill-wrap" ref={sortRef}>
            <button className={`recipes-pill${sort !== 'default' ? ' recipes-pill--active' : ''}`}
              onClick={() => setSortOpen(o => !o)}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}}>
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {SORT_OPTIONS.find(o => o.value === sort)?.label}
              <svg className={`recipes-pill-chevron${sortOpen ? ' recipes-pill-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <FilterDropdown open={sortOpen} anchorRef={sortRef} onClose={() => setSortOpen(false)} className="recipes-dropdown">
              {SORT_OPTIONS.map(o => (
                <button key={o.value}
                  className={`recipes-dropdown-item${sort === o.value ? ' recipes-dropdown-item--active' : ''}`}
                  onClick={() => { setSort(o.value); setSortOpen(false); }}>
                  {o.label}
                </button>
              ))}
            </FilterDropdown>
          </div>

          {/* Cuisine */}
          {cuisineOptions.length > 0 && (
            <div className="recipes-pill-wrap" ref={cuisineRef}>
              <button className={`recipes-pill${activeCuisine ? ' recipes-pill--active' : ''}`}
                onClick={() => setCuisineOpen(o => !o)}>
                {activeCuisine || 'Cuisine'}
                <svg className={`recipes-pill-chevron${cuisineOpen ? ' recipes-pill-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <FilterDropdown open={cuisineOpen} anchorRef={cuisineRef} onClose={() => setCuisineOpen(false)} className="recipes-dropdown">
                {activeCuisine && (
                  <button className="recipes-dropdown-item recipes-dropdown-item--clear"
                    onClick={() => { setActiveCuisine(null); setCuisineOpen(false); }}>
                    ✕ Clear
                  </button>
                )}
                {cuisineOptions.map(c => (
                  <button key={c}
                    className={`recipes-dropdown-item${activeCuisine === c ? ' recipes-dropdown-item--active' : ''}`}
                    onClick={() => { setActiveCuisine(activeCuisine === c ? null : c); setCuisineOpen(false); }}>
                    {c}
                  </button>
                ))}
              </FilterDropdown>
            </div>
          )}

          {/* Time */}
          <div className="recipes-pill-wrap" ref={timeRef}>
            <button className={`recipes-pill${timeFilter !== 'any' ? ' recipes-pill--active' : ''}`}
              onClick={() => setTimeOpen(o => !o)}>
              ⏱ {timeFilter === '30' ? '≤ 30 min' : timeFilter === '60' ? '≤ 1 hr' : 'Time'}
              <svg className={`recipes-pill-chevron${timeOpen ? ' recipes-pill-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <FilterDropdown open={timeOpen} anchorRef={timeRef} onClose={() => setTimeOpen(false)} className="recipes-dropdown">
              {[['any','Any time'],['30','≤ 30 min'],['60','≤ 1 hour']].map(([val, label]) => (
                <button key={val}
                  className={`recipes-dropdown-item${timeFilter === val ? ' recipes-dropdown-item--active' : ''}`}
                  onClick={() => { setTimeFilter(val); setTimeOpen(false); }}>
                  {label}
                </button>
              ))}
            </FilterDropdown>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="recipes-pill-wrap" ref={tagsRef}>
              <button className={`recipes-pill${activeTags.size > 0 ? ' recipes-pill--active' : ''}`}
                onClick={() => setTagsOpen(o => !o)}>
                Tags{activeTags.size > 0 ? ` · ${activeTags.size}` : ''}
                <svg className={`recipes-pill-chevron${tagsOpen ? ' recipes-pill-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <FilterDropdown open={tagsOpen} anchorRef={tagsRef} onClose={() => setTagsOpen(false)} className="recipes-dropdown recipes-dropdown--tags">
                {activeTags.size > 0 && (
                  <button className="recipes-dropdown-item recipes-dropdown-item--clear"
                    onClick={() => setActiveTags(new Set())}>
                    ✕ Clear tags
                  </button>
                )}
                {allTags.slice(0, 20).map(t => (
                  <button key={t}
                    className={`recipes-dropdown-item${activeTags.has(t) ? ' recipes-dropdown-item--active' : ''}`}
                    onClick={() => toggleTag(t)}>
                    #{t}
                  </button>
                ))}
              </FilterDropdown>
            </div>
          )}

          {/* Clear all */}
          {hasFilters && (
            <button className="recipes-clear-btn" onClick={clearFilters}>✕ Clear all</button>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      {loading ? (
        <div className="recipes-loading">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton-card" />)}
        </div>

      ) : recipes.length === 0 ? (
        <div className="recipes-empty-start">
          <div className="recipes-empty-heading">
            <span className="recipes-empty-emoji">🍽</span>
            <h2>Your cookbook is empty</h2>
            <p>Add your first recipe to get started. Import from a website, TikTok, paste text, or type it yourself.</p>
          </div>
          <div className="recipes-import-cards">
            {IMPORT_METHODS.map(m => (
              <button key={m.label} className="recipes-import-card" onClick={() => navigate(m.path)}>
                <span className="recipes-import-icon">{m.icon}</span>
                <span className="recipes-import-label">{m.label}</span>
                <span className="recipes-import-desc">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

      ) : filtered.length === 0 ? (
        <div className="recipes-empty">
          <p className="recipes-empty-icon">🔍</p>
          <h3>No results</h3>
          <p>Try a different search or filter.</p>
          <button className="btn-ghost" onClick={clearFilters}>Clear filters</button>
        </div>

      ) : (
        <>
          <div className="recipe-grid">
            {filtered.map((recipe, idx) => (
              <RecipeCard
                key={recipe._id || recipe.id || idx}
                recipe={recipe}
                onClick={saveScrollPosition}
                showServings
                textFallback
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
