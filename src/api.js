const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export function imgUrl(url) {
  if (!url) return url;
  const m = url.match(/\/images\/[0-9a-fA-F]{24}(?![0-9a-fA-F])/);
  if (m) return `${API}${m[0]}`;
  if (url.startsWith('/uploads/')) return `${API}${url}`;
  return url;
}

export function getToken() {
  return localStorage.getItem('mise_token');
}

export function getStoredUser() {
  const u = localStorage.getItem('mise_user');
  return u ? JSON.parse(u) : null;
}

export function setSession(token, user) {
  localStorage.setItem('mise_token', token);
  localStorage.setItem('mise_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('mise_token');
  localStorage.removeItem('mise_user');
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  // A 401 on an authenticated request means the token is expired/invalid — the
  // backend only returns 401 for a bad token (ownership failures use 403). Without
  // this, a stale session silently breaks every write forever. Drop the dead
  // session and send the user to log in again.
  if (res.status === 401 && token) {
    clearSession();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }
  return res;
}
