import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import RecipeCard from '../components/RecipeCard';
import './css/UserProfilePage.css';
import './css/Recipes.css';

export default function UserProfilePage({ user: currentUser }) {
  const { id }        = useParams();
  const navigate      = useNavigate();
  const [profile, setProfile]         = useState(null);
  const [recipes, setRecipes]         = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [followModal, setFollowModal]         = useState(null);
  const [followModalUsers, setFollowModalUsers] = useState([]);
  const [followModalLoading, setFollowModalLoading] = useState(false);

  const isOwnProfile = currentUser && (currentUser.id === id || currentUser._id === id);

  useEffect(() => {
    if (isOwnProfile) { navigate('/profile', { replace: true }); return; }

    Promise.all([
      apiFetch(`/users/${id}`).then(r => r.ok ? r.json() : null),
      apiFetch(`/users/${id}/recipes`).then(r => r.ok ? r.json() : []),
      currentUser ? apiFetch(`/follows/${id}/status`).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
    ]).then(([prof, recs, followStatus]) => {
      setProfile(prof);
      setRecipes(recs || []);
      if (followStatus) setIsFollowing(followStatus.is_following);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, currentUser, isOwnProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFollowModal = async (type) => {
    setFollowModal(type);
    setFollowModalUsers([]);
    setFollowModalLoading(true);
    try {
      const r = await apiFetch(`/users/${id}/${type}`);
      if (r.ok) setFollowModalUsers(await r.json());
    } catch {}
    setFollowModalLoading(false);
  };

  const handleFollow = async () => {
    if (!currentUser) { navigate('/login'); return; }
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await apiFetch(`/follows/${id}`, { method: 'DELETE' });
        setIsFollowing(false);
        setProfile(p => ({ ...p, follower_count: (p.follower_count || 1) - 1 }));
      } else {
        await apiFetch(`/follows/${id}`, { method: 'POST', body: '{}' });
        setIsFollowing(true);
        setProfile(p => ({ ...p, follower_count: (p.follower_count || 0) + 1 }));
      }
    } catch {}
    setFollowLoading(false);
  };

  if (loading) return (
    <div className="up-page page">
      <div className="up-skeleton-header" />
    </div>
  );

  if (!profile) return (
    <div className="up-page page"><p>User not found.</p></div>
  );

  const initial = profile.name?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="up-page page">

      <button className="up-back-btn" onClick={() => navigate(-1)}>← Back</button>

      {/* ── Profile header ── */}
      <div className="up-header">
        <div className="up-avatar">{initial}</div>
        <div className="up-info">
          <div className="up-name-row">
            <h1 className="up-name">{profile.name}</h1>
            <button
              className={`up-follow-btn${isFollowing ? ' up-follow-btn--following' : ''}`}
              onClick={handleFollow}
              disabled={followLoading}
            >
              {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
            </button>
          </div>
          <div className="up-stats">
            <div className="up-stat">
              <span className="up-stat-num">{profile.public_recipe_count ?? recipes.length}</span>
              <span className="up-stat-label">recipes</span>
            </div>
            <button className="up-stat up-stat--btn" onClick={() => openFollowModal('followers')}>
              <span className="up-stat-num">{profile.follower_count ?? 0}</span>
              <span className="up-stat-label">followers</span>
            </button>
            <button className="up-stat up-stat--btn" onClick={() => openFollowModal('following')}>
              <span className="up-stat-num">{profile.following_count ?? 0}</span>
              <span className="up-stat-label">following</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Recipe grid ── */}
      {recipes.length === 0 ? (
        <div className="up-empty">
          <p>No public recipes yet.</p>
        </div>
      ) : (
        <div className="recipe-grid">
          {recipes.map((recipe, idx) => (
            <RecipeCard
              key={recipe._id || recipe.id || idx}
              recipe={recipe}
              showRating={false}
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
