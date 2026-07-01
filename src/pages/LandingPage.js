import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { imgUrl } from '../api';
import { cuisinePastel } from '../utils/cuisine';
import './css/LandingPage.css';

const FEATURES = [
  {
    icon: '🔗',
    title: 'Import from anywhere',
    desc: 'Paste a URL from any recipe site, share a TikTok link, or paste raw text — mise parses it instantly.',
  },
  {
    icon: '📅',
    title: 'Plan your week',
    desc: 'Drag recipes onto your meal calendar. Never stare at the fridge wondering what to make again.',
  },
  {
    icon: '🛒',
    title: 'Smart grocery lists',
    desc: 'Your shopping list builds itself from the week\'s meals. Grouped by aisle, ready to go.',
  },
  {
    icon: '🍳',
    title: 'Cook Mode',
    desc: 'Hands-free, step-by-step cooking with your screen always on. Check off steps as you go.',
  },
];

const STEPS = [
  { n: '1', title: 'Save your recipes', desc: 'Import from any website, TikTok, or add your own. Everything in one place.' },
  { n: '2', title: 'Plan your meals', desc: 'Drop recipes onto your weekly calendar in seconds.' },
  { n: '3', title: 'Shop and cook', desc: 'Auto-generated grocery list. Cook Mode guides you through each step.' },
];

export default function LandingPage() {
  const [featured, setFeatured] = useState([]);
  const [failedImages, setFailedImages] = useState(new Set());

  useEffect(() => {
    const api = process.env.REACT_APP_API_URL || 'http://localhost:8000';
    fetch(`${api}/recipes/explore?limit=6`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setFeatured(Array.isArray(data) ? data.slice(0, 6) : []))
      .catch(() => {});
  }, []);

  return (
    <div className="lp">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge">Recipe management, reinvented</div>
          <h1 className="lp-headline">
            Cook smarter.<br />
            <span className="lp-headline-accent">Eat better.</span>
          </h1>
          <p className="lp-sub">
            mise brings your recipes, meal plans, and grocery lists together in one beautiful place. Import from anywhere, plan your week, and cook with confidence.
          </p>
          <div className="lp-hero-ctas">
            <Link to="/register" className="lp-btn-primary">Get started free</Link>
            <Link to="/discover" className="lp-btn-ghost">Browse recipes →</Link>
          </div>
        </div>
        <div className="lp-hero-visual">
          <div className="lp-hero-card lp-hero-card--1">
            <div className="lp-hero-card-img" style={{background:'linear-gradient(135deg,#e8622a22,#e8622a44)'}} />
            <div className="lp-hero-card-body">
              <div className="lp-hero-card-tag">Pasta</div>
              <div className="lp-hero-card-name">Spaghetti Carbonara</div>
              <div className="lp-hero-card-meta">25 min · 4 servings</div>
            </div>
          </div>
          <div className="lp-hero-card lp-hero-card--2">
            <div className="lp-hero-card-img" style={{background:'linear-gradient(135deg,#2d9d5c22,#2d9d5c44)'}} />
            <div className="lp-hero-card-body">
              <div className="lp-hero-card-tag">Salad</div>
              <div className="lp-hero-card-name">Grilled Caesar Salad</div>
              <div className="lp-hero-card-meta">15 min · 2 servings</div>
            </div>
          </div>
          <div className="lp-hero-card lp-hero-card--3">
            <div className="lp-hero-card-img" style={{background:'linear-gradient(135deg,#7c3aed22,#7c3aed44)'}} />
            <div className="lp-hero-card-body">
              <div className="lp-hero-card-tag">Dessert</div>
              <div className="lp-hero-card-name">Chocolate Lava Cake</div>
              <div className="lp-hero-card-meta">30 min · 6 servings</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ───────────────────────────────────────── */}
      <section className="lp-stats">
        <div className="lp-stats-inner">
          <div className="lp-stat">
            <span className="lp-stat-num">Any site</span>
            <span className="lp-stat-label">Import in seconds</span>
          </div>
          <div className="lp-stat-divider" />
          <div className="lp-stat">
            <span className="lp-stat-num">7 days</span>
            <span className="lp-stat-label">Meal planning built-in</span>
          </div>
          <div className="lp-stat-divider" />
          <div className="lp-stat">
            <span className="lp-stat-num">0 tabs</span>
            <span className="lp-stat-label">Everything in one place</span>
          </div>
          <div className="lp-stat-divider" />
          <div className="lp-stat">
            <span className="lp-stat-num">Free</span>
            <span className="lp-stat-label">No credit card needed</span>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="lp-section lp-features-section">
        <div className="lp-section-inner">
          <div className="lp-section-label">Features</div>
          <h2 className="lp-section-title">Everything your kitchen needs</h2>
          <p className="lp-section-sub">One app that handles the whole process — from finding a recipe to sitting down to eat.</p>
          <div className="lp-features">
            {FEATURES.map(f => (
              <div key={f.title} className="lp-feature">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="lp-section lp-how-section">
        <div className="lp-section-inner">
          <div className="lp-section-label">How it works</div>
          <h2 className="lp-section-title">From recipe to table in three steps</h2>
          <div className="lp-steps">
            {STEPS.map(s => (
              <div key={s.n} className="lp-step">
                <div className="lp-step-num">{s.n}</div>
                <h3 className="lp-step-title">{s.title}</h3>
                <p className="lp-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Recipe showcase ───────────────────────────────────── */}
      {featured.length > 0 && (
        <section className="lp-section lp-showcase-section">
          <div className="lp-section-inner">
            <div className="lp-section-label">Community</div>
            <h2 className="lp-section-title">See what people are cooking</h2>
            <p className="lp-section-sub">Real recipes from real home cooks.</p>
            <div className="lp-showcase-grid">
              {featured.map(recipe => {
                const id = recipe._id || recipe.id;
                const hasImage = !!recipe.image_url && !failedImages.has(id);
                const mins = (recipe.prep_time || 0) + (recipe.cook_time || 0);
                return (
                  <Link key={id} to={`/recipes/${id}`} className="lp-recipe-card">
                    {/* Image — always rendered; pastel fills it when there is no photo */}
                    <div className="lp-recipe-card-img"
                      style={hasImage ? undefined : { background: cuisinePastel(recipe.cuisine) }}>
                      {hasImage && (
                        <img src={imgUrl(recipe.image_url)} alt={recipe.recipe_name} loading="lazy"
                          onError={() => setFailedImages(prev => new Set(prev).add(id))} />
                      )}
                    </div>
                    <div className="lp-recipe-card-body">
                      {recipe.category && <span className="lp-recipe-card-tag">{recipe.category}</span>}
                      <div className="lp-recipe-card-name">{recipe.recipe_name}</div>
                      <div className="lp-recipe-card-meta">
                        {[recipe.cuisine, mins > 0 && `${mins} min`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="lp-showcase-more">
              <Link to="/discover" className="lp-btn-ghost">Explore all recipes →</Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Coming soon ───────────────────────────────────────── */}
      <section className="lp-section lp-coming-section">
        <div className="lp-section-inner">
          <div className="lp-section-label">Coming soon</div>
          <h2 className="lp-section-title">There's more on the way</h2>
          <div className="lp-coming-grid">
            <div className="lp-coming-card">
              <div className="lp-coming-icon">📱</div>
              <div className="lp-coming-title">Mobile app</div>
              <div className="lp-coming-desc">Native iOS and Android apps with offline support.</div>
              <div className="lp-coming-badge">To be made</div>
            </div>
            <div className="lp-coming-card">
              <div className="lp-coming-icon">🤝</div>
              <div className="lp-coming-title">Shared cookbooks</div>
              <div className="lp-coming-desc">Collaborate on recipe collections with family and friends.</div>
              <div className="lp-coming-badge">To be made</div>
            </div>
            <div className="lp-coming-card">
              <div className="lp-coming-icon">🥗</div>
              <div className="lp-coming-title">Nutrition tracking</div>
              <div className="lp-coming-desc">Auto-calculate macros and nutrition info for every recipe.</div>
              <div className="lp-coming-badge">To be made</div>
            </div>
            <div className="lp-coming-card">
              <div className="lp-coming-icon">✨</div>
              <div className="lp-coming-title">AI meal planning</div>
              <div className="lp-coming-desc">Tell mise your goals and it plans your whole week for you.</div>
              <div className="lp-coming-badge">To be made</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="lp-cta-banner">
        <div className="lp-cta-inner">
          <h2 className="lp-cta-title">Ready to get cooking?</h2>
          <p className="lp-cta-sub">Join mise and bring your kitchen into focus. Free, forever.</p>
          <div className="lp-cta-actions">
            <Link to="/register" className="lp-btn-primary lp-btn-primary--large">Create free account</Link>
            <Link to="/login" className="lp-cta-login">Already have an account? Sign in →</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-footer-logo">mise</span>
            <span className="lp-footer-tagline">Your kitchen, perfectly organized.</span>
          </div>
          <nav className="lp-footer-nav">
            <Link to="/discover">Explore</Link>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Sign up</Link>
          </nav>
        </div>
        <div className="lp-footer-copy">© {new Date().getFullYear()} mise. Made with love for home cooks.</div>
      </footer>

    </div>
  );
}
