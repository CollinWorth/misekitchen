import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { apiFetch } from '../api';
import RecipeCard from '../components/RecipeCard';
import './css/Recipes.css';
import './css/ProfilePage.css';

export default function ProfilePage({ user, onLogout }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followerCount, setFollowerCount]   = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followModal, setFollowModal]         = useState(null);
  const [followModalUsers, setFollowModalUsers] = useState([]);
  const [followModalLoading, setFollowModalLoading] = useState(false);
  const navigate = useNavigate();

  const openFollowModal = async (type) => {
    const uid = user.id || user._id;
    setFollowModal(type);
    setFollowModalUsers([]);
    setFollowModalLoading(true);
    try {
      const r = await apiFetch(`/users/${uid}/${type}`);
      if (r.ok) setFollowModalUsers(await r.json());
    } catch {}
    setFollowModalLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    const uid = user.id || user._id;
    Promise.all([
      apiFetch(`/recipes/user/${uid}`).then(r => r.ok ? r.json() : []),
      apiFetch(`/users/${uid}`).then(r => r.ok ? r.json() : {}),
    ]).then(([data, profile]) => {
      setRecipes(data);
      setFollowerCount(profile.follower_count ?? 0);
      setFollowingCount(profile.following_count ?? 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const initial = user.name?.[0]?.toUpperCase() ?? '?';
  const publicCount = recipes.filter(r => r.is_public).length;

  return (
    <div className="pf-page page">

      {/* ── Profile header ── */}
      <div className="pf-header">
        <div className="pf-avatar">{initial}</div>
        <div className="pf-info">
          <h1 className="pf-name">{user.name}</h1>
          <p className="pf-email">{user.email}</p>
          <div className="pf-stats">
            <div className="pf-stat">
              <span className="pf-stat-num">{recipes.length}</span>
              <span className="pf-stat-label">recipes</span>
            </div>
            <div className="pf-stat">
              <span className="pf-stat-num">{publicCount}</span>
              <span className="pf-stat-label">public</span>
            </div>
            <button className="pf-stat pf-stat--btn" onClick={() => openFollowModal('followers')}>
              <span className="pf-stat-num">{followerCount}</span>
              <span className="pf-stat-label">followers</span>
            </button>
            <button className="pf-stat pf-stat--btn" onClick={() => openFollowModal('following')}>
              <span className="pf-stat-num">{followingCount}</span>
              <span className="pf-stat-label">following</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Recipe grid ── */}
      <div className="pf-section-title">Your Recipes</div>

      {loading ? (
        <div className="recipes-loading">
          {Array.from({length:4}).map((_,i) => <div key={i} className="skeleton-card" />)}
        </div>
      ) : recipes.length === 0 ? (
        <div className="recipes-empty">
          <p className="recipes-empty-icon">🍽</p>
          <h3>No recipes yet</h3>
          <p>Add your first recipe to get started.</p>
          <button className="btn-primary" onClick={() => navigate('/recipes/add')}>+ Add Recipe</button>
        </div>
      ) : (
        <div className="recipe-grid">
          {recipes.map((recipe, idx) => (
            <RecipeCard
              key={recipe._id || recipe.id || idx}
              recipe={recipe}
              showPublicBadge
            />
          ))}
        </div>
      )}

      {/* ── Followers / Following modal ── */}
      {followModal && (
        <div className="follow-modal-overlay" onClick={() => setFollowModal(null)}>
          <div className="follow-modal" onClick={e => e.stopPropagation()}>
            <div className="follow-modal-header">
              <h3 className="follow-modal-title">{followModal === 'followers' ? 'Followers' : 'Following'}</h3>
              <button className="follow-modal-close" onClick={() => setFollowModal(null)}>✕</button>
            </div>
            <div className="follow-modal-list">
              {followModalLoading ? (
                [0,1,2].map(i => <div key={i} className="follow-modal-skeleton" />)
              ) : followModalUsers.length === 0 ? (
                <p className="follow-modal-empty">Nobody here yet.</p>
              ) : followModalUsers.map(u => (
                <div key={u.id} className="follow-modal-user" onClick={() => { setFollowModal(null); navigate(`/users/${u.id}`); }}>
                  <div className="follow-modal-avatar">{u.name?.[0]?.toUpperCase() ?? '?'}</div>
                  <span className="follow-modal-name">{u.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
