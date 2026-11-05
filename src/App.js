import React, { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import './styles/global.css';
import './App.css';
import './components/css/Toast.css';
import { getStoredUser, setSession, clearSession } from './api';
import { ToastProvider } from './contexts/ToastContext';
import NavBar from './components/NavBar';
import Calendar from './pages/CalendarPage';
import Recipes from './pages/Recipes';
import RecipeDetails from './pages/RecipeDetails';
import Login from './pages/Login';
import Register from './pages/Register';
import GroceryList from './pages/GroceryList';
import AddRecipe from './pages/AddRecipe';
import EditRecipe from './pages/EditRecipe';
import DiscoverPage from './pages/DiscoverPage';
import ProfilePage from './pages/ProfilePage';
import UserProfilePage from './pages/UserProfilePage';
import SettingsPage from './pages/SettingsPage';
import CookMode from './pages/CookMode';
import NotFoundPage from './pages/NotFoundPage';
import LandingPage from './pages/LandingPage';
import PreviewBadge from './components/PreviewBadge';

function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navType]);
  return null;
}

function App() {
  const [user, setUser] = useState(getStoredUser);

  useEffect(() => {
    const theme = localStorage.getItem('mise_theme') || 'light';
    document.documentElement.dataset.theme = theme;
  }, []);

  const handleLogin = (token, userData) => {
    setSession(token, userData);
    setUser(userData);
  };

  const handleLogout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <>
    <Router>
      <ScrollToTop />
      <ToastProvider>
      <div className="App">
        <NavBar user={user} onLogout={handleLogout} />
        <Routes>
          <Route path="/" element={user ? <Recipes user={user} /> : <LandingPage />} />
          <Route path="/calendar" element={<Calendar user={user} />} />
          <Route path="/recipes" element={user ? <Recipes user={user} /> : <Navigate to="/discover" replace />} />
          <Route path="/recipes/add" element={<AddRecipe user={user} />} />
          <Route path="/recipes/:id/edit" element={<EditRecipe user={user} />} />
          <Route path="/recipes/:id/cook" element={<CookMode />} />
          <Route path="/recipes/:id" element={<RecipeDetails user={user} />} />
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/register" element={<Register />} />
          <Route path="/grocery-list" element={user ? <GroceryList user={user} /> : <Navigate to="/login" replace />} />
          <Route path="/discover"   element={<DiscoverPage user={user} />} />
          <Route path="/explore"    element={<DiscoverPage user={user} />} />
          <Route path="/feed"       element={<DiscoverPage user={user} />} />
          <Route path="/profile"    element={<ProfilePage user={user} onLogout={handleLogout} />} />
          <Route path="/users/:id"  element={<UserProfilePage user={user} />} />
          <Route path="/settings"   element={<SettingsPage user={user} onLogout={handleLogout} />} />
          <Route path="*"           element={<NotFoundPage />} />
        </Routes>
      </div>
      </ToastProvider>
    </Router>
    <PreviewBadge />
    <Analytics />
    <SpeedInsights />
    </>
  );
}

export default App;
