import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import './css/Login_Register.css';

function Register({ onRegister }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const response = await apiFetch('/users/', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (response.ok) {
        setSuccess('Account created! Signing you in…');
        if (onRegister) onRegister();
        setTimeout(() => navigate('/login'), 1200);
      } else {
        const data = await response.json();
        if (Array.isArray(data.detail)) {
          setError(data.detail.map((e) => e.msg).join(', '));
        } else {
          setError(data.detail || 'Registration failed. Email may already be in use.');
        }
      }
    } catch (err) {
      setError('Registration failed. Please try again.');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel-left">
        <div className="auth-brand">
          <span className="auth-logo">mise</span>
          <p className="auth-tagline">Every great meal starts with a plan.</p>
        </div>
        <ul className="auth-features">
          <li><span className="auth-feature-dot" />Save and organize your recipes</li>
          <li><span className="auth-feature-dot" />Plan your week at a glance</li>
          <li><span className="auth-feature-dot" />Auto-generate grocery lists</li>
          <li><span className="auth-feature-dot" />Share recipes with friends</li>
        </ul>
      </div>

      <div className="auth-panel-right">
        <div className="auth-form-wrap">
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-subtitle">Start building your recipe collection</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Your name" required autoFocus />
            </label>
            <label>
              Email
              <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="you@example.com" required />
            </label>
            <label>
              Password
              <input type="password" name="password" value={form.password} onChange={handleChange} placeholder="••••••••" required minLength={8} />
              <span className="auth-hint">At least 8 characters</span>
            </label>
            {error && <p className="auth-error">{error}</p>}
            {success && <p className="auth-success">{success}</p>}
            <button type="submit" className="auth-submit">Create account</button>
          </form>
          <p className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
