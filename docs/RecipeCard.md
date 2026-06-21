# RecipeCard Component

A shared card used to render a single recipe in a grid (image + cuisine/time tags + title + rating), with click-through to the recipe detail page.

Source: [src/components/RecipeCard.js](../src/components/RecipeCard.js) · Styles: [src/pages/css/Recipes.css](../src/pages/css/Recipes.css)

## Overview

`RecipeCard` was extracted from three pages that had copy-pasted the same `.recipe-card` markup: [Recipes.js](../src/pages/Recipes.js), [ProfilePage.js](../src/pages/ProfilePage.js), and [UserProfilePage.js](../src/pages/UserProfilePage.js). Each page used the markup slightly differently (rating shown or not, public badge, text-only fallback when there's no image), so the component takes boolean props to toggle those sections rather than always rendering everything.

It manages its own "did the image fail to load" state internally (`onError` → fall back to a placeholder/text card), so callers don't need to track failed image IDs themselves the way `Recipes.js` used to.

## Props

| Prop              | Type       | Default | Description                                                                                   |
|-------------------|------------|---------|-------------------------------------------------------------------------------------------------|
| `recipe`          | `object`   | —       | Recipe document (`recipe_name`, `image_url`, `cuisine`, `prep_time`, `cook_time`, `servings`, `avg_rating`, `is_public`, `category`, `_id`/`id`). |
| `onClick`         | `function` | navigates to `/recipes/{id}` | Click handler for the card. Pages override this when they need extra behavior (e.g. `Recipes.js` saves scroll position before navigating). |
| `showRating`      | `boolean`  | `true`  | Show the `StarRating` row.                                                                      |
| `showServings`    | `boolean`  | `false` | Show a "Serves N" line under the title (image variant only — the text variant always includes servings in its joined subtitle). |
| `showPublicBadge` | `boolean`  | `false` | Show a "public" badge when `recipe.is_public` is true. Used on the owner's own profile.          |
| `textFallback`    | `boolean`  | `false` | When there's no image (or it fails to load), render a colored text-only card instead of a placeholder-colored image box. |

## Usage

```jsx
// Recipes.js — text fallback + servings line, custom click handler for scroll restore
<RecipeCard
  recipe={recipe}
  onClick={() => goToRecipe(recipe._id || recipe.id)}
  showServings
  textFallback
/>

// ProfilePage.js — owner's own recipes, shows the public/private badge
<RecipeCard recipe={recipe} showPublicBadge />

// UserProfilePage.js — viewing someone else's public recipes, no rating shown
<RecipeCard recipe={recipe} showRating={false} />
```

## Other recipe cards in the app (intentionally not using this component)

Not every "card with a recipe on it" in the app uses `RecipeCard` — a couple of pages have their own bespoke styling on purpose, and merging them would mean fighting deliberate visual differences:

- **`ExplorePage.js`** — uses its own `.ex-card` classes (see the `// Note: uses own card styles — intentionally different from Recipes page` comment in that file). Don't refactor this onto `RecipeCard` without checking with whoever owns that page's design.
- **`LandingPage.js`** — uses `.lp-recipe-card`, a simplified marketing-page variant (no rating, different layout) shown to logged-out visitors.
- **`DiscoverPage.js`** — its recipe-related cards are mixed in with `.people-card` (user search results); check current markup before assuming it maps onto `RecipeCard`.

## Future: a more modular card

Right now `RecipeCard` covers three pages' worth of variation with five boolean flags, which is fine for now but won't scale if more flags get added (e.g. supporting a comments-count badge, an edit/delete affordance, or a compact list-row layout for a future "search results" view). If/when that happens, it's worth revisiting this as a **composable** card — e.g. a `RecipeCard` shell that accepts child "slot" components (`<RecipeCard.Badge>`, `<RecipeCard.Rating>`, `<RecipeCard.Footer>`) or a single `fields`/`sections` config array — so each page opts into exactly the pieces it needs instead of the component growing more boolean props per consumer. Not worth doing preemptively; revisit once a fourth or fifth flag is needed.
