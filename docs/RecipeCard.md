# RecipeCard Component

A shared card used to render a single recipe in a grid (image + cuisine/time tags + title + rating), with click-through to the recipe detail page.

Source: [src/components/RecipeCard.js](../src/components/RecipeCard.js) · Styles: [src/pages/css/Recipes.css](../src/pages/css/Recipes.css)

## Overview

`RecipeCard` was extracted from three pages that had copy-pasted the same `.recipe-card` markup: [Recipes.js](../src/pages/Recipes.js), [ProfilePage.js](../src/pages/ProfilePage.js), and [UserProfilePage.js](../src/pages/UserProfilePage.js). Each page used the markup slightly differently (rating shown or not, public badge), so the component takes boolean props to toggle those sections rather than always rendering everything.

It manages its own "did the image fail to load" state internally (`onError` → fall back to the standard info card), so callers don't need to track failed image IDs themselves the way `Recipes.js` used to.

## The no-image standard ("info fallback")

> **There is exactly one way to render a recipe that has no usable image, and it is used everywhere.** "No usable image" means `image_url` is missing **or** the image failed to load (`onError`) — both cases are treated identically.

The fallback renders the recipe **info as text on a cuisine-pastel surface**: category (uppercase), title, a `cuisine · time · serves` subtitle, and the rating. **Never** an empty colored box, a single letter, or an emoji — those were the old inconsistent treatments and have all been removed.

- Pastel colors come from the single shared palette in [src/utils/cuisine.js](../src/utils/cuisine.js) (`cuisinePastel(recipe.cuisine)`). Do **not** re-declare a local `CUISINE_BG` / `CUISINE_PASTELS` map in a page — import from there.
- In `RecipeCard`, this is the `.recipe-card--text` branch and it is now the **default** for any image-less card (it is no longer gated behind a prop).
- The pastel is always a light color. On a dark theme, surfaces that keep the pastel (e.g. LandingPage) pin the text dark for legibility; `.recipe-card--text` and `.ex-card--no-image` instead swap to `var(--surface-raised)` via existing `[data-theme="dark"]` overrides.

This standard also applies to the bespoke cards below — they each render their own markup, but the **no-image treatment** (drop the image area, show info on `cuisinePastel(...)`) is the same across all of them:

- **`ExplorePage.js`** / **`DiscoverPage.js`** — `.ex-card--no-image` (image area omitted, body shows title + meta on the pastel card).
- **`LandingPage.js`** — `.lp-recipe-card--no-image` (image area omitted, body shows category + name + `cuisine · time` on the pastel card).
- **`DiscoverPage.js` feed list** — `.feed-post-placeholder` (pastel + category pill + name + time).

## Props

| Prop              | Type       | Default | Description                                                                                   |
|-------------------|------------|---------|-------------------------------------------------------------------------------------------------|
| `recipe`          | `object`   | —       | Recipe document (`recipe_name`, `image_url`, `cuisine`, `prep_time`, `cook_time`, `servings`, `avg_rating`, `is_public`, `category`, `_id`/`id`). |
| `onClick`         | `function` | navigates to `/recipes/{id}` | Click handler for the card. Pages override this when they need extra behavior (e.g. `Recipes.js` saves scroll position before navigating). |
| `showRating`      | `boolean`  | `true`  | Show the `StarRating` row.                                                                      |
| `showServings`    | `boolean`  | `false` | Show a "Serves N" line under the title (image variant only — the info fallback always includes servings in its joined subtitle). |
| `showPublicBadge` | `boolean`  | `false` | Show a "public" badge when `recipe.is_public` is true. Used on the owner's own profile. Rendered on both the image overlay and the info fallback. |

> There is no `textFallback` prop. The info fallback is always used when there is no usable image — see [The no-image standard](#the-no-image-standard-info-fallback) above.

## Usage

```jsx
// Recipes.js — servings line, custom click handler for scroll restore
<RecipeCard
  recipe={recipe}
  onClick={saveScrollPosition}
  showServings
/>

// ProfilePage.js — owner's own recipes, shows the public/private badge
<RecipeCard recipe={recipe} showPublicBadge />

// UserProfilePage.js — viewing someone else's public recipes, no rating shown
<RecipeCard recipe={recipe} showRating={false} />
```

## Other recipe cards in the app (intentionally not using this component)

Not every "card with a recipe on it" in the app uses `RecipeCard` — a few pages have their own bespoke layout on purpose (different footers, author rows, grid sizes), and merging them would mean fighting deliberate visual differences. **However, they all share the same [no-image standard](#the-no-image-standard-info-fallback)** — same shared `cuisinePastel(...)` palette, same "drop the image, show the info" fallback. Only the surrounding layout differs.

- **`ExplorePage.js`** — uses its own `.ex-card` classes with an author/likes footer. Don't refactor onto `RecipeCard`, but keep its no-image path on `.ex-card--no-image` + `cuisinePastel`.
- **`LandingPage.js`** — uses `.lp-recipe-card`, a simplified marketing-page variant (no rating) shown to logged-out visitors. No-image path is `.lp-recipe-card--no-image` + `cuisinePastel`.
- **`DiscoverPage.js`** — both the `.ex-card` grid and the `.feed-post-placeholder` feed list; recipe cards are mixed in with `.people-card` (user search results). Check current markup before assuming it maps onto `RecipeCard`.

## Future: a more modular card

Right now `RecipeCard` covers three pages' worth of variation with five boolean flags, which is fine for now but won't scale if more flags get added (e.g. supporting a comments-count badge, an edit/delete affordance, or a compact list-row layout for a future "search results" view). If/when that happens, it's worth revisiting this as a **composable** card — e.g. a `RecipeCard` shell that accepts child "slot" components (`<RecipeCard.Badge>`, `<RecipeCard.Rating>`, `<RecipeCard.Footer>`) or a single `fields`/`sections` config array — so each page opts into exactly the pieces it needs instead of the component growing more boolean props per consumer. Not worth doing preemptively; revisit once a fourth or fifth flag is needed.
