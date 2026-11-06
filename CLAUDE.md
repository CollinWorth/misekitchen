# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**mise** is a recipe + meal-planning app with three independent clients/services in one repo:

- **`src/`** — React 19 web frontend (Create React App / react-scripts)
- **`backend/`** — FastAPI + MongoDB (async via Motor) API server
- **`mobile/`** — Flutter (Dart) iOS app (The moble app has been abandond with replacment of using web apps)

The web frontend and Flutter app both talk to the same FastAPI backend over HTTP.

## Commands

### Frontend (run from repo root)
```bash
npm start            # dev server on :3000
npm run build        # production build → build/
npm test             # CRA/Jest watch mode (component tests live in src/**/__tests__)
```
The API base URL comes from `REACT_APP_API_URL` (defaults to `http://localhost:8000`); see [src/api.js](src/api.js).

### Backend (run from `backend/`)
```bash
cd backend
source venv/bin/activate          # or .venv — a venv is expected
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Requires env vars (`.env` in `backend/`): `MONGODB_URI`, `DATABASE_NAME` (defaults to `cookindb`), `SECRET_KEY` (JWT signing), and `ANTHROPIC_API_KEY` (for AI parsing). NLTK data `averaged_perceptron_tagger_eng` must be downloaded for ingredient parsing (the Dockerfiles do this). Backend tests need none of these: they use an in-memory fake MongoDB (see Testing below).

### Testing (one command for everything)

```
bash scripts/test.sh            # backend (pytest) + frontend (Jest)
bash scripts/test.sh backend    # or just one side
```

- Backend tests are in `backend/tests/`. `conftest.py` swaps MongoDB for `mongomock-motor`, so no database, network or secrets are needed. Fixtures: `client` (FastAPI TestClient) and `user` (a logged-in user: id plus auth headers). Dev dependencies: `backend/requirements-dev.txt`.
- Frontend tests sit next to the component in a `__tests__` folder and mock `apiFetch`. Use the real category keys from `src/utils/grocery.js` in test data.
- Every bug fix or feature gets a test. The issue worker runs the full suite before pushing and flags failures in the PR.

### Mobile (run from `mobile/`)
```bash
flutter pub get
flutter run
```
The backend URL is **hardcoded** as `kBaseUrl` in [mobile/lib/api.dart](mobile/lib/api.dart) — update it for your environment.

## Architecture

### Backend
- [backend/main.py](backend/main.py) wires CORS (currently `allow_origins=["*"]`) and mounts one router per domain under a prefix: `/recipes`, `/users`, `/mealPlans`, `/groceryList`, `/follows`, `/comments`, `/ratings`.
- [backend/database.py](backend/database.py) creates the single Motor client and exposes one module-level collection handle per domain (`recipes_collection`, `users_collection`, etc.). Routers import these directly — there is no repository/ORM layer.
- [backend/auth.py](backend/auth.py) — JWT (HS256, 30-day expiry) via `python-jose`. Use the `get_current_user_id` dependency for protected routes and `get_optional_user_id` for routes that behave differently when logged in (e.g. marking which recipes the viewer has liked).
- [backend/model.py](backend/model.py) — Pydantic request/response models (`Recipe`, `Ingredient`, `GroceryList`, etc.).
- **Images are stored in MongoDB** (the `images` collection), not on disk, and served by the `/images/{image_id}` endpoint in `main.py`. The older `uploads/` directory path is also still referenced. `imgUrl()` in the frontend rewrites both `/uploads/` and `/images/` paths and bare `localhost` URLs to the configured API host.

### Recipe ingestion (the core complexity — [backend/routers/recipes.py](backend/routers/recipes.py), ~1000 lines)
This router holds most of the app's logic. Recipes can be created three ways, with a layered parsing pipeline:
- **URL scraping** — `/recipes/scrape` and `/recipes/scrape-smart` use the `recipe-scrapers` library (`wild_mode=True`).
- **Photo** — `/recipes/parse-photo` sends the image to Anthropic (Claude vision) to extract structured recipe data.
- **Free text** — `/recipes/parse-text` and `parse_recipe_text()` use heuristics to split ingredients vs. instructions.
- **Ingredient parsing** is layered: `ingredient-parser-nlp` (CRF model, `_parse_with_crf`) with a regex fallback (`_parse_ingredient_regex`), plus normalization helpers (`_norm_fracs`, `_norm_unit_str`, `_strip_prep`). When touching ingredient parsing, trace through `parse_ingredient_string()` which orchestrates these.
- Recipes support forking: `original_recipe_id` / `is_modified` / `/{recipe_id}/versions` track derived copies.

### Frontend
- [src/App.js](src/App.js) holds all routing and the auth `user` state. `user` is loaded from `localStorage` (via `getStoredUser`) and passed as a prop down to pages — there is **no auth context**, only `ToastContext` ([src/contexts/ToastContext.js](src/contexts/ToastContext.js)).
- Session helpers (`getToken`, `setSession`, `clearSession`, `apiFetch`) all live in [src/api.js](src/api.js); the token is stored under `mise_token` and user under `mise_user`. Always use `apiFetch` so the bearer token is attached.
- Note `/discover`, `/explore`, and `/feed` all render the same `DiscoverPage`.
- **Theming** is via `document.documentElement.dataset.theme` (`light`/`dark`), persisted in `localStorage` under `mise_theme`. Global CSS variables live in `src/styles/global.css`; per-component CSS lives alongside components in `css/` folders.

### Mobile
- Flutter app mirroring web features. [mobile/lib/api.dart](mobile/lib/api.dart) is the HTTP layer; screens live in `mobile/lib/screens/`.
- Has a **pluggable storage abstraction** ([mobile/lib/storage/](mobile/lib/storage/)): `storage.dart` defines the interface, with `local_storage.dart` (Hive, offline) and `server_storage.dart` (backend) implementations — recipes can live offline-only or sync to the server.

## Deployment

- **Frontend → Vercel**: the React app's production host. Vercel builds preview deployments per-branch/PR automatically; merging/pushing to the production branch triggers an atomic deploy with no downtime for users already loaded (new requests get the new build; in-flight sessions aren't killed).
- **Backend → Railway**: root [Dockerfile](Dockerfile) (and identical [backend/Dockerfile](backend/Dockerfile)) build only the FastAPI service; [railway.toml](railway.toml) points at it. It downloads the NLTK tagger at build time and runs uvicorn on `$PORT`.
- **Self-hosted (legacy, being decommissioned)**: [deploy.sh](deploy.sh) pulls, installs deps, builds the frontend, and (re)starts `api` + `frontend` processes under **PM2** (frontend served from `build/` on port 3001). Still technically running but slated for removal soon — don't invest in it.
- **Frontend Docker (legacy)**: [Dockerfile.frontend](Dockerfile.frontend) + [docker-compose.yml](docker-compose.yml) build/serve the React app, baking in `REACT_APP_API_URL` at build time. Superseded by Vercel.

The committed `build/` directory is a checked-in production build of the frontend (used by the legacy PM2 path) — regenerate it with `npm run build` rather than editing by hand.

## Working as the issue bot

Rules from Collin for Claude when it runs from GitHub Actions (`.github/workflows/claude.yml`). Label an issue `claude` to build it (add `research` for a proposal only); comment `@claude ...` on a PR to ask for changes. Keep these short and follow them.

**Process**
- Keep changes small and on-topic. Don't refactor unrelated code or "improve" things not in the issue.
- Never commit `.env`, `build/`, `node_modules/` or `package-lock.json` changes.
- Check your work: `BUILD_PATH=.build-check CI=false DISABLE_ESLINT_PLUGIN=true npm run build` for frontend (BUILD_PATH stops it overwriting the tracked `build/` folder; never run a build without it), `python3 -m py_compile <file>` for backend files you touched. (Linting is off because the lock file is out of sync, see issue #6.)
- Work on the branch `claude/issue-N`, push it (never force-push) and open the PR with `gh pr create --reviewer CollinWorth`. Merge `origin/main` into the branch before pushing.
- Run `bash scripts/test.sh` before pushing and say whether it passed. Add a test for every fix.
- If the issue is unclear or risky, make no commits and say why.
- Never rewrite history. If asked to remove a commit, add a new commit that undoes it (`git revert --no-edit <sha>` works), with the message `Revert of <short sha>: <original subject>`.

**Writing**
- PR summary: at most 5 lines. What changed, one line on how to check it on the Vercel preview, any real doubt. No headings, no restating the issue, no file lists.
- Issues you file should be short: problem, fix, done-when.

**Testing and deploys**
- Merging to `main` deploys to production (Vercel frontend, Railway backend). Nothing should reach prod untested.
- The Vercel preview builds only the **frontend**, and it talks to the **production backend**. Backend changes can't be previewed before merge. For backend changes, say so plainly in the PR and keep them minimal. If a frontend change depends on a backend change, say that too.
- Only Collin approves. Never merge yourself; the `merge-on-approval` workflow squash-merges after his approval of the latest commit.

**Conventions**
- Backend returns **401 only for a bad or expired token** (the frontend `apiFetch` logs the user out on 401). Use 400/403 for wrong passwords and permission failures.
- Use `parse_object_id()` from `database.py` for ids coming from requests.
- Use `apiFetch` and `ToastContext` in the frontend, not raw `fetch` or `alert()`.
- Legacy, don't invest in: `deploy.sh`, PM2, `mobile/`, the committed `build/` folder.

**Public repo: security**
- This repo is public. Never put secrets, security vulnerabilities, or exploit details in issues, PRs, comments or commit messages. If you find a vulnerability, make no change for it and tell Collin privately via the summary only as "possible security problem, see Collin".

**Research issues** (label `research`): read only. Write a proposal of up to 15 lines with a suggested model (haiku for small mechanical fixes, sonnet for multi-file or judgment, opus for tricky design).

**Models**: haiku by default; the labels `model:sonnet` and `model:opus` override it per issue.
