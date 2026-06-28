import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { apiFetch, imgUrl } from '../api';
import LazyImage from '../components/LazyImage';
import FilterDropdown from '../components/FilterDropdown';
import { cuisinePastel } from '../utils/cuisine';
import './css/ExplorePage.css';
import './css/FeedPage.css';

const cuisineBg = cuisinePastel;

const SORT_TABS = [
  { id: 'new',       label: '✨ New' },
  { id: 'trending',  label: '🔥 Trending' },
  { id: 'top_rated', label: '⭐ Top Rated' },
];

function totalMinutes(r) { return (r.prep_time || 0) + (r.cook_time || 0); }
function fmtTime(r) { const t = totalMinutes(r); return t > 0 ? `${t}m` : null; }

const AVATAR_PALETTE = [
  '#D4785A','#5B9BD5','#6BAF7A','#C4943A','#8A6FC4',
  '#C45B8F','#4AABB8','#B06040','#5A9E6F','#7B6DB2',
];
function avatarColor(name) {
  if (!name) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function peopleMeta(person) {
  const parts = [];
  if (person.recipe_count  > 0) parts.push(`${person.recipe_count} recipe${person.recipe_count !== 1 ? 's' : ''}`);
  if (person.follower_count > 0) parts.push(`${person.follower_count} follower${person.follower_count !== 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export default function DiscoverPage({ user }) {
  const [tab, setTab] = useState('all');

  const [savedIds, setSavedIds]   = useState(new Set());
  const [savingId, setSavingId]   = useState(null);

  const [exploreRecipes, setExploreRecipes] = useState([]);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [failedImages, setFailedImages]     = useState(new Set());
  const [search, setSearch]                 = useState('');
  const [discoverSort, setDiscoverSort]     = useState('new');
  const [activeCuisine, setActiveCuisine]   = useState(null);
  const [quickOnly, setQuickOnly]           = useState(false);
  const [cuisineOpen, setCuisineOpen]       = useState(false);
  const cuisineRef = useRef(null);

  const [feedRecipes, setFeedRecipes]   = useState([]);
  const [feedLoading, setFeedLoading]   = useState(false);
  const [feedLoaded, setFeedLoaded]     = useState(false);

  const [peopleSearch, setPeopleSearch]     = useState('');
  const [people, setPeople]                 = useState([]);
  const [peopleLoading, setPeopleLoading]   = useState(false);
  const [followedIds, setFollowedIds]       = useState(new Set());
  const [suggestedPeople, setSuggestedPeople]   = useState([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestedLoaded, setSuggestedLoaded]   = useState(false);
  const peopleTimer = useRef(null);

  const navigate  = useNavigate();
  const location  = useLocation();

  const goToRecipe = (id) => {
    sessionStorage.setItem('discover_scrollY', String(window.scrollY));
    navigate(`/recipes/${id}`, { state: { from: location.pathname } });
  };

  useEffect(() => {
    const saved = sessionStorage.getItem('discover_scrollY');
    if (saved) {
      sessionStorage.removeItem('discover_scrollY');
      requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
    }
  }, []);


  useEffect(() => {
    apiFetch('/recipes/explore')
      .then(r => r.ok ? r.json() : [])
      .then(data => { setExploreRecipes(data); setExploreLoading(false); })
      .catch(() => setExploreLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'people' || suggestedLoaded) return;
    setSuggestedLoading(true);
    const loads = [apiFetch('/users/browse').then(r => r.ok ? r.json() : [])];
    if (user) {
      const uid = user.id || user._id;
      loads.push(
        apiFetch(`/users/${uid}/following`)
          .then(r => r.ok ? r.json() : [])
          .then(following => { setFollowedIds(new Set(following.map(f => f.id))); })
      );
    }
    Promise.all(loads)
      .then(([suggested]) => { setSuggestedPeople(suggested || []); setSuggestedLoading(false); setSuggestedLoaded(true); })
      .catch(() => setSuggestedLoading(false));
  }, [tab, user, suggestedLoaded]);

  useEffect(() => {
    if (tab !== 'people') return;
    clearTimeout(peopleTimer.current);
    if (!peopleSearch.trim()) { setPeople([]); return; }
    setPeopleLoading(true);
    peopleTimer.current = setTimeout(() => {
      apiFetch(`/users/search?q=${encodeURIComponent(peopleSearch.trim())}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => { setPeople(data); setPeopleLoading(false); })
        .catch(() => setPeopleLoading(false));
    }, 300);
    return () => clearTimeout(peopleTimer.current);
  }, [peopleSearch, tab]);

  const handleFollow = async (e, targetId) => {
    e.stopPropagation();
    if (!user) { navigate('/login'); return; }
    const alreadyFollowing = followedIds.has(targetId);
    setFollowedIds(prev => { const n = new Set(prev); alreadyFollowing ? n.delete(targetId) : n.add(targetId); return n; });
    try {
      await apiFetch(`/follows/${targetId}`, { method: alreadyFollowing ? 'DELETE' : 'POST', body: '{}' });
    } catch {
      setFollowedIds(prev => { const n = new Set(prev); alreadyFollowing ? n.add(targetId) : n.delete(targetId); return n; });
    }
  };

  useEffect(() => {
    if (tab !== 'following' || !user || feedLoaded) return;
    setFeedLoading(true);
    apiFetch('/recipes/feed')
      .then(r => r.ok ? r.json() : [])
      .then(data => { setFeedRecipes(data); setFeedLoading(false); setFeedLoaded(true); })
      .catch(() => setFeedLoading(false));
  }, [tab, user, feedLoaded]);

  const handleSave = async (e, recipeId) => {
    e.stopPropagation();
    if (!user) { navigate('/login'); return; }
    if (savedIds.has(recipeId)) return;
    setSavingId(recipeId);
    try {
      const r = await apiFetch(`/recipes/${recipeId}/save`, { method: 'POST', body: '{}' });
      if (r.ok) setSavedIds(prev => new Set([...prev, recipeId]));
    } catch {}
    setSavingId(null);
  };

  // Build cuisine+category options for dropdown
  const cuisineOptions = Array.from(new Set([
    ...exploreRecipes.map(r => r.category).filter(Boolean),
    ...exploreRecipes.map(r => r.cuisine).filter(Boolean),
  ])).sort();

  let filtered = [...exploreRecipes];

  if (activeCuisine) {
    filtered = filtered.filter(r => r.cuisine === activeCuisine || r.category === activeCuisine);
  }
  if (quickOnly) {
    filtered = filtered.filter(r => { const t = totalMinutes(r); return t > 0 && t <= 30; });
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.recipe_name.toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      (r.cuisine  || '').toLowerCase().includes(q) ||
      (r.tags     || '').toLowerCase().includes(q)
    );
  }
  if (discoverSort === 'trending') {
    filtered = [...filtered].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  } else if (discoverSort === 'top_rated') {
    filtered = [...filtered].sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));
  }

  const hasFilters = activeCuisine || quickOnly || search.trim();

  // Spotlight: 3 newest recipes with images, only shown on default All view
  const spotlight = exploreRecipes
    .filter(r => r.image_url && !failedImages.has(r._id || r.id))
    .slice(0, 3);

  const showingFeed    = tab === 'following';
  const showingExplore = !showingFeed && tab !== 'people';
  const showSpotlight  = showingExplore && !activeCuisine && !quickOnly && !search.trim() && discoverSort === 'new' && spotlight.length >= 2;

  return (
    <div className="ex-page">

      {/* ── Sticky header ──────────────────────────────── */}
      <div className={`ex-header${tab === 'people' ? ' ex-header--people' : ''}`}>
        <div className="ex-header-top">
          <div className="discover-mode-toggle">
            {user && (
              <button className={`discover-mode-btn${showingFeed ? ' discover-mode-btn--active' : ''}`}
                onClick={() => setTab('following')}>Following</button>
            )}
            <button className={`discover-mode-btn${showingExplore ? ' discover-mode-btn--active' : ''}`}
              onClick={() => { setTab('all'); }}>Discover</button>
            <button className={`discover-mode-btn${tab === 'people' ? ' discover-mode-btn--active' : ''}`}
              onClick={() => setTab('people')}>People</button>
          </div>

          {showingExplore && (
            <div className="ex-search-wrap">
              <svg className="ex-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input className="ex-search" type="search" placeholder="Search recipes…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          )}
        </div>

        {showingExplore && (
          <div className="ex-filter-row">
            {/* Sort tabs */}
            <div className="ex-sort-tabs">
              {SORT_TABS.map(s => (
                <button key={s.id}
                  className={`ex-sort-tab${discoverSort === s.id ? ' ex-sort-tab--active' : ''}`}
                  onClick={() => setDiscoverSort(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="ex-filter-divider" />

            {/* Cuisine / Category dropdown */}
            <div className="ex-cuisine-wrap" ref={cuisineRef}>
              <button
                className={`ex-filter-pill${activeCuisine ? ' ex-filter-pill--active' : ''}`}
                onClick={() => setCuisineOpen(o => !o)}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}}>
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {activeCuisine || 'Cuisine'}
                <svg className={`ex-pill-chevron${cuisineOpen ? ' ex-pill-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <FilterDropdown open={cuisineOpen} anchorRef={cuisineRef} onClose={() => setCuisineOpen(false)} className="ex-cuisine-dropdown">
                {activeCuisine && (
                  <button className="ex-cuisine-item ex-cuisine-item--clear"
                    onClick={() => { setActiveCuisine(null); setCuisineOpen(false); }}>
                    ✕ Clear
                  </button>
                )}
                {cuisineOptions.map(c => (
                  <button key={c}
                    className={`ex-cuisine-item${activeCuisine === c ? ' ex-cuisine-item--active' : ''}`}
                    onClick={() => { setActiveCuisine(activeCuisine === c ? null : c); setCuisineOpen(false); }}>
                    {c}
                  </button>
                ))}
              </FilterDropdown>
            </div>

            {/* Quick toggle */}
            <button
              className={`ex-filter-pill${quickOnly ? ' ex-filter-pill--active' : ''}`}
              onClick={() => setQuickOnly(q => !q)}>
              ⚡ Under 30m
            </button>

            {/* Clear all */}
            {hasFilters && (
              <button className="ex-filter-clear"
                onClick={() => { setActiveCuisine(null); setQuickOnly(false); setSearch(''); }}>
                ✕ Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Following (Feed) ───────────────────────────── */}
      {showingFeed && (
        <div className="feed-inner">
          {feedLoading ? (
            <div className="feed-skeletons">{[0,1,2].map(i => <div key={i} className="feed-skeleton" />)}</div>
          ) : feedRecipes.length === 0 ? (
            <div className="feed-empty">
              <span className="feed-empty-icon">👨‍🍳</span>
              <h3>Nothing in your feed yet</h3>
              <p>Follow some cooks on Discover to see their recipes here.</p>
              <button className="btn-primary" onClick={() => setTab('all')}>Go to Discover</button>
            </div>
          ) : (
            <div className="feed-posts">
              {feedRecipes.map((recipe, idx) => {
                const id = recipe._id || recipe.id;
                const saved = savedIds.has(id);
                const authorInitial = recipe.author_name?.[0]?.toUpperCase() ?? '?';
                const totalTime = (recipe.prep_time || 0) + (recipe.cook_time || 0);
                return (
                  <article key={id} className="feed-post">
                    <div className="feed-post-author">
                      <Link to={`/users/${recipe.user_id}`} className="feed-author-link" onClick={e => e.stopPropagation()}>
                        <div className="feed-author-avatar">{authorInitial}</div>
                        <span className="feed-author-name">{recipe.author_name || 'Chef'}</span>
                      </Link>
                      {recipe.category && <span className="feed-post-category">{recipe.category}</span>}
                    </div>
                    <div className="feed-post-img" onClick={() => goToRecipe(id)}>
                      {recipe.image_url && !failedImages.has(id)
                        ? <LazyImage src={imgUrl(recipe.image_url)} alt={recipe.recipe_name} eager={idx < 3}
                            onError={() => setFailedImages(prev => new Set(prev).add(id))} />
                        : <div className="feed-post-placeholder" style={{background: cuisineBg(recipe.cuisine)}}>
                            {recipe.category && <span className="feed-placeholder-pill">{recipe.category}</span>}
                            <span className="feed-post-placeholder-name">{recipe.recipe_name}</span>
                            {totalTime > 0 && <span className="feed-placeholder-time">{totalTime} min</span>}
                          </div>
                      }
                    </div>
                    <div className="feed-post-actions">
                      {recipe.avg_rating > 0 && (
                        <div className="feed-action-btn feed-star-display">
                          <span className="ex-rating-badge">
                            <span className="ex-rating-star">★</span>
                            {recipe.avg_rating.toFixed(1)}
                          </span>
                        </div>
                      )}
                      <button className="feed-action-btn" onClick={() => goToRecipe(id)}>
                        <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
                          <path d="M14 10C14 10.5523 13.5523 11 13 11H4.5L2 13.5V3C2 2.44772 2.44772 2 3 2H13C13.5523 2 14 2.44772 14 3V10Z"
                            stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                        </svg>
                        {(recipe.comment_count || 0) > 0 && <span className="feed-action-count">{recipe.comment_count}</span>}
                      </button>
                      <button className={`feed-action-btn feed-save-btn${saved ? ' feed-save-btn--saved' : ''}`}
                        onClick={e => handleSave(e, id)} style={{marginLeft:'auto'}}>
                        <svg width="20" height="22" viewBox="0 0 14 18" fill={saved ? 'currentColor' : 'none'}>
                          <path d="M1 1H13V17L7 13L1 17V1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                    <div className="feed-post-meta">
                      <div className="feed-post-info" onClick={() => goToRecipe(id)}>
                        <span className="feed-post-title">{recipe.recipe_name}</span>
                        <span className="feed-post-details">
                          {recipe.cuisine && <>{recipe.cuisine}</>}
                          {recipe.cuisine && totalTime > 0 && <span className="feed-dot">·</span>}
                          {totalTime > 0 && <>{totalTime}m</>}
                        </span>
                      </div>
                      {recipe.tags && (
                        <p className="feed-post-tags">
                          {recipe.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                            <span key={t} className="feed-tag">#{t}</span>
                          ))}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── People ─────────────────────────────────────── */}
      {tab === 'people' && (
        <div className="people-section">
          <div className="people-search-wrap">
            <svg className="people-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input className="people-search-input" type="search" placeholder="Search by name…"
              value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)} autoFocus />
          </div>

          {!peopleSearch.trim() ? (
            suggestedLoading ? (
              <div className="people-list">{[0,1,2,3,4].map(i => <div key={i} className="people-skeleton" />)}</div>
            ) : suggestedPeople.length === 0 ? (
              <div className="ex-empty">
                <span className="ex-empty-icon">👤</span>
                <h3>No cooks yet</h3>
                <p>Be the first to share a public recipe.</p>
              </div>
            ) : (
              <>
                <p className="people-section-label">Popular cooks</p>
                <div className="people-list">
                  {suggestedPeople.map(person => {
                    const pid = person._id || person.id;
                    const isMe = user && (user.id === pid || user._id === pid);
                    const following = followedIds.has(pid);
                    const meta = peopleMeta(person);
                    return (
                      <div key={pid} className="people-card" onClick={() => navigate(`/users/${pid}`)}>
                        <div className="people-card-avatar" style={{background: avatarColor(person.name)}}>
                          {person.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="people-card-info">
                          <span className="people-card-name">{person.name}</span>
                          {meta && <span className="people-card-meta">{meta}</span>}
                        </div>
                        {person.sample_image && (
                          <LazyImage className="people-card-thumb" src={imgUrl(person.sample_image)} alt="" />
                        )}
                        {!isMe && user && (
                          <button className={`people-follow-btn${following ? ' people-follow-btn--following' : ''}`}
                            onClick={e => handleFollow(e, pid)}>
                            {following ? 'Following' : 'Follow'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )
          ) : peopleLoading ? (
            <div className="people-list">{[0,1,2].map(i => <div key={i} className="people-skeleton" />)}</div>
          ) : people.length === 0 ? (
            <div className="ex-empty">
              <span className="ex-empty-icon">🔍</span>
              <h3>No results</h3>
              <p>No one found for "{peopleSearch}".</p>
            </div>
          ) : (
            <>
              <p className="people-section-label">{people.length} cook{people.length !== 1 ? 's' : ''} found</p>
              <div className="people-list">
                {people.map(person => {
                  const pid = person._id || person.id;
                  const isMe = user && (user.id === pid || user._id === pid);
                  const following = followedIds.has(pid);
                  const meta = peopleMeta(person);
                  return (
                    <div key={pid} className="people-card" onClick={() => navigate(`/users/${pid}`)}>
                      <div className="people-card-avatar" style={{background: avatarColor(person.name)}}>
                        {person.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="people-card-info">
                        <span className="people-card-name">{person.name}</span>
                        {meta && <span className="people-card-meta">{meta}</span>}
                      </div>
                      {!isMe && user && (
                        <button className={`people-follow-btn${following ? ' people-follow-btn--following' : ''}`}
                          onClick={e => handleFollow(e, pid)}>
                          {following ? 'Following' : 'Follow'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Discover ───────────────────────────────────── */}
      {showingExplore && (
        exploreLoading ? (
          <div className="ex-grid">
            {Array.from({length: 8}).map((_, i) => <div key={i} className="ex-skeleton" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ex-empty">
            <span className="ex-empty-icon">🌍</span>
            <h3>{exploreRecipes.length === 0 ? 'Nothing shared yet' : 'No results'}</h3>
            <p>{exploreRecipes.length === 0
              ? 'Open a recipe you own, toggle "Share publicly", and it\'ll appear here.'
              : 'Try a different search or category.'
            }</p>
          </div>
        ) : (
          <>
            {/* Spotlight row */}
            {showSpotlight && (
              <div className="ex-spotlight">
                <div className="ex-spotlight-label">
                  <span>Recently added</span>
                  <button className="ex-spotlight-see-all" onClick={() => setDiscoverSort('new')}>See all →</button>
                </div>
                <div className="ex-spotlight-row">
                  {spotlight.map((recipe, idx) => {
                    const id = recipe._id || recipe.id;
                    const saved = savedIds.has(id);
                    return (
                      <div key={id} className="ex-spotlight-card" onClick={() => goToRecipe(id)}>
                        <div className="ex-spotlight-img">
                          <LazyImage src={imgUrl(recipe.image_url)} alt={recipe.recipe_name} eager={idx < 6}
                            onError={() => setFailedImages(prev => new Set(prev).add(id))} />
                          <button className={`ex-spotlight-save${saved ? ' ex-spotlight-save--saved' : ''}`}
                            onClick={e => handleSave(e, id)} disabled={savingId === id}>
                            <svg width="14" height="16" viewBox="0 0 14 18" fill={saved ? 'currentColor' : 'none'}>
                              <path d="M1 1H13V17L7 13L1 17V1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                        <div className="ex-spotlight-body">
                          {recipe.category && <span className="ex-spotlight-tag">{recipe.category}</span>}
                          <div className="ex-spotlight-title">{recipe.recipe_name}</div>
                          <div className="ex-spotlight-meta">
                            {recipe.author_name && (
                              <span className="ex-spotlight-author">
                                <span className="ex-spotlight-avatar" style={{background: avatarColor(recipe.author_name)}}>
                                  {recipe.author_name[0].toUpperCase()}
                                </span>
                                {recipe.author_name}
                              </span>
                            )}
                            {fmtTime(recipe) && <span className="ex-spotlight-time">{fmtTime(recipe)}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Main grid */}
            {showSpotlight && (
              <div className="ex-grid-label">
                <span>All recipes</span>
                <span className="ex-grid-count">{filtered.length}</span>
              </div>
            )}
            <div className="ex-grid">
              {filtered.map((recipe, idx) => {
                const id = recipe._id || recipe.id;
                const saved = savedIds.has(id);
                const time = fmtTime(recipe);
                const hasImage = !!recipe.image_url && !failedImages.has(id);
                return (
                  <article key={id}
                    className={`ex-card${hasImage ? '' : ' ex-card--no-image'}`}
                    style={hasImage ? {} : { background: cuisineBg(recipe.cuisine) }}
                    onClick={() => goToRecipe(id)}>
                    {hasImage && (
                      <div className="ex-card-img">
                        <LazyImage src={imgUrl(recipe.image_url)} alt={recipe.recipe_name} eager={idx < 8}
                          onError={() => setFailedImages(prev => new Set(prev).add(id))} />
                        {recipe.cuisine && <span className="ex-card-cuisine">{recipe.cuisine}</span>}
                      </div>
                    )}
                    <div className="ex-card-body">
                      <h3 className="ex-card-title">{recipe.recipe_name}</h3>
                      <div className="ex-card-meta">
                        {recipe.category && <span className="ex-card-tag ex-card-category">{recipe.category}</span>}
                        {time && <><span className="ex-card-dot">·</span><span>{time}</span></>}
                        {recipe.servings && <><span className="ex-card-dot">·</span><span>Serves {recipe.servings}</span></>}
                      </div>
                    </div>
                    <div className="ex-card-footer" onClick={e => e.stopPropagation()}>
                      {recipe.author_name && (
                        <a href={`/users/${recipe.user_id}`} className="ex-card-author"
                          onClick={e => { e.stopPropagation(); e.preventDefault(); navigate(`/users/${recipe.user_id}`); }}>
                          <span className="ex-card-author-avatar" style={{background: avatarColor(recipe.author_name)}}>
                            {recipe.author_name[0].toUpperCase()}
                          </span>
                          <span className="ex-card-author-name">{recipe.author_name}</span>
                        </a>
                      )}
                      {recipe.avg_rating > 0 && (
                        <span className="ex-rating-badge">
                          <span className="ex-rating-star">★</span>
                          {recipe.avg_rating.toFixed(1)}
                        </span>
                      )}
                      <button className={`ex-save-btn${saved ? ' ex-save-btn--saved' : ''}`}
                        onClick={e => handleSave(e, id)} disabled={savingId === id}>
                        {savingId === id ? '…' : saved ? '✓ Saved' : '+ Save'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}
