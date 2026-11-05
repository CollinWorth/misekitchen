import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { apiFetch, clearSession } from '../api';
import { useToast } from '../contexts/ToastContext';
import './css/SettingsPage.css';

const WEEK_START_KEY = 'mise_week_start';

export default function SettingsPage({ user, onLogout }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [theme, setTheme] = useState(() => localStorage.getItem('mise_theme') || 'light');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('mise_theme', next);
    document.documentElement.dataset.theme = next;
  };

  const [name, setName]   = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  const [weekStart, setWeekStart] = useState(() => {
    return parseInt(localStorage.getItem(WEEK_START_KEY) || '0', 10);
  });

  const toggleWeekStart = () => {
    const next = weekStart === 0 ? 1 : 0;
    setWeekStart(next);
    localStorage.setItem(WEEK_START_KEY, String(next));
    toast.success(`Week starts on ${next === 0 ? 'Sunday' : 'Monday'}`);
  };
  const [profileSaving, setProfileSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving]   = useState(false);

  const [deletePw, setDeletePw]     = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting]     = useState(false);

  if (!user) return <Navigate to="/login" replace />;

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setProfileSaving(true);
    try {
      const r = await apiFetch('/users/me', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (r.ok) {
        const updated = await r.json();
        // Update stored session with new name/email
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, name: updated.name, email: updated.email }));
        toast.success('Profile updated');
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || 'Failed to update profile');
      }
    } catch {
      toast.error('Network error');
    }
    setProfileSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6)    { toast.error('Password must be at least 6 characters'); return; }
    setPwSaving(true);
    try {
      const r = await apiFetch('/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      if (r.ok) {
        toast.success('Password changed');
        setCurrentPw(''); setNewPw(''); setConfirmPw('');
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || 'Failed to change password');
      }
    } catch {
      toast.error('Network error');
    }
    setPwSaving(false);
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (deleteConfirm !== 'delete my account') {
      toast.error('Type "delete my account" to confirm');
      return;
    }
    setDeleting(true);
    try {
      const r = await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePw }),
      });
      if (r.ok) {
        clearSession();
        onLogout();
        navigate('/');
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || 'Failed to delete account');
      }
    } catch {
      toast.error('Network error');
    }
    setDeleting(false);
  };

  return (
    <div className="settings-page page">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
      </div>

      {/* ── Appearance ───────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Appearance</h2>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Theme</span>
            <span className="settings-row-value">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </div>
          <button type="button" className="settings-toggle-btn" onClick={toggleTheme}>
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </section>

      {/* ── Planner ──────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Planner</h2>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Week starts on</span>
            <span className="settings-row-value">{weekStart === 0 ? 'Sunday' : 'Monday'}</span>
          </div>
          <button type="button" className="settings-toggle-btn" onClick={toggleWeekStart}>
            Switch to {weekStart === 0 ? 'Monday' : 'Sunday'}
          </button>
        </div>
      </section>

      {/* ── Edit profile ─────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Profile</h2>
        <form className="settings-form" onSubmit={saveProfile}>
          <div className="settings-field">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
          </div>
          <div className="settings-field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <button type="submit" className="btn-primary" disabled={profileSaving}>
            {profileSaving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </section>

      {/* ── Change password ───────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Change password</h2>
        <form className="settings-form" onSubmit={changePassword}>
          <div className="settings-field">
            <label>Current password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required />
          </div>
          <div className="settings-field">
            <label>New password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required />
          </div>
          <div className="settings-field">
            <label>Confirm new password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" disabled={pwSaving}>
            {pwSaving ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>

      {/* ── Danger zone ───────────────────────────────────── */}
      <section className="settings-section settings-section--danger">
        <h2 className="settings-section-title settings-section-title--danger">Danger zone</h2>
        <p className="settings-danger-desc">
          Permanently deletes your account and all your recipes. This cannot be undone.
        </p>
        <form className="settings-form" onSubmit={deleteAccount}>
          <div className="settings-field">
            <label>Password</label>
            <input type="password" value={deletePw} onChange={e => setDeletePw(e.target.value)} required />
          </div>
          <div className="settings-field">
            <label>Type <strong>delete my account</strong> to confirm</label>
            <input
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder="delete my account"
              required
            />
          </div>
          <button type="submit" className="btn-danger" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
        </form>
      </section>
    </div>
  );
}
