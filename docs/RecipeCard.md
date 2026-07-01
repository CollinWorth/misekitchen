# RecipeCard Component

A shared card used to render a single recipe in a grid (image + cuisine/time tags + title + rating), with click-through to the recipe detail page.

Source: [src/components/RecipeCard.js](../src/components/RecipeCard.js) · Styles: [src/pages/css/Recipes.css](../src/pages/css/Recipes.css)

## Overview

`RecipeCard` was extracted from three pages that had copy-pasted the same `.recipe-card` markup: [Recipes.js](../src/pages/Recipes.js), [ProfilePage.js](../src/pages/ProfilePage.js), and [UserProfilePage.js](../src/pages/UserProfilePage.js). Each page used the markup slightly differently (rating shown or not, public badge), so the component takes boolean props to toggle those sections rather than always rendering everything.

It manages its own "did the image fail to load" state internally (`onError` → treat as no image), so callers don't need to track failed image IDs themselves.

## The no-image standard

> **There is exactly one recipe card. A recipe with no usable image renders the *same* card as a recipe with an image — the only difference is that the cuisine pastel fills the image area instead of a photo.** "No usable image" means `image_url` is missing **or** the image failed to load (`onError`) — both are treated identically.

This replaces the old "info fallback" / separate pastel *text card* that used to render a different layout (category + title + subtitle on a flat pastel panel). That is gone. **Do not** reintroduce a distinct no-image card layout, an empty colored box, a single letter, or an emoji placeholder — every one of those has been removed. If you find one, it's a regression.

Concretely, in `RecipeCard`:

- The card always renders `.recipe-card-img` (the image frame) with `.recipe-card-overlay` on top (cuisine badge, time, title, servings, rating).
- The `<img>` is rendered **only** when there is a usable image. Otherwise the frame's inline `background: cuisinePastel(recipe.cuisine)` shows through.
- When there's no image, the frame also gets the `.recipe-card-img--no-image` class, which **only** strengthens the overlay's dark gradient so the white overlay text stays legible over the light pastel (a photo is dark enough on its own; a light pastel is not). It does **not** change the layout.
- Pastel colors come from the single shared palette in [src/utils/cuisine.js](../src/utils/cuisine.js) (`cuisinePastel(recipe.cuisine)`). Do **not** re-declare a local `CUISINE_BG` / `CUISINE_PASTELS` map in a page — import from there.
- **No black loading boxes.** Because the frame background is the pastel (not the old dark `#1A1918`), a slow or hanging image shows a pastel backdrop while it loads, never a solid black card.

### Hover on cards in the masonry grid

The Recipes grid is CSS multi-column (`.recipe-grid { columns: N }`). **Do not put a `transform` on the hover state of a direct column child** (e.g. `.recipe-card:hover { transform: translateY(...) }`). Transforming a direct child of a multicol container promotes it to a GPU layer and hits a Chromium compositing bug that makes the card flicker/disappear at the peak of the animation. Use `box-shadow` (and other non-compositing properties) for card hover feedback. The image zoom (`transform: scale()`) is fine because it's on the inner `<img>` inside an `overflow:hidden` frame, not on the column child itself.

## Props

| Prop              | Type       | Default | Description                                                                                   |
|-------------------|------------|---------|-------------------------------------------------------------------------------------------------|
| `recipe`          | `object`   | —       | Recipe document (`recipe_name`, `image_url`, `cuisine`, `prep_time`, `cook_time`, `servings`, `avg_rating`, `is_public`, `category`, `_id`/`id`). |
| `onClick`         | `function` | navigates to `/recipes/{id}` | Click handler for the card. Pages override this when they need extra behavior (e.g. `Recipes.js` saves scroll position before navigating). |
| `showRating`      | `boolean`  | `true`  | Show the `StarRating` row.                                                                      |
| `showServings`    | `boolean`  | `false` | Show a "Serves N" line under the title.                                                          |
| `showPublicBadge` | `boolean`  | `false` | Show a "public" badge when `recipe.is_public` is true. Used on the owner's own profile.          |

> There is no `textFallback` prop (there used to be — it gated the old text card and has been removed). The no-image case is handled automatically and always looks like the image card.

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

Not every "card with a recipe on it" uses `RecipeCard` — a few pages have their own bespoke layout on purpose (different footers, author rows, grid sizes), and merging them would mean fighting deliberate visual differences.

**They all follow the same no-image rule as `RecipeCard`: the image area is always rendered and the cuisine pastel (`cuisinePastel(...)`) fills it when there is no usable image (missing *or* `onError`). None of them render a separate text/placeholder layout anymore.** Only the surrounding layout differs.

- **`ExplorePage.js`** and **`DiscoverPage.js` grid** — `.ex-card` (image → body → footer). `.ex-card-img` is always rendered; when there's no photo it's pastel-filled and still shows the `.ex-card-cuisine` badge. The title/meta/author/rating live in the body and footer below, unchanged. (`.ex-card--no-image` was removed.)
- **`DiscoverPage.js` feed** and **`FeedPage.js`** — the feed post's `.feed-post-img` is always rendered; with no photo it gets `.feed-post-img--no-image` (a pastel-filled block at the same `4/3` aspect ratio a photo would use). The recipe title/cuisine/time already show below in `.feed-post-meta`, so the image area stays clean — no text inside it. (The old `.feed-post-placeholder` that duplicated the name/category/time inside the image was removed.) `FeedPage.js` also tracks `failedImages` so broken photos fall back to the pastel block like everywhere else.
- **`LandingPage.js`** — `.lp-recipe-card`, a simplified marketing-page variant (no rating) shown to logged-out visitors. `.lp-recipe-card-img` (fixed 180px) is always rendered and pastel-filled when there's no photo; the category/name/meta body sits below. (`.lp-recipe-card--no-image` was removed.)

> Note: `/discover`, `/explore`, and `/feed` all render `DiscoverPage`. Its default tab shows the `.ex-card` grid; the "Following" tab shows the feed.

## Future: a more modular card

Right now `RecipeCard` covers three pages' worth of variation with boolean flags, which is fine for now but won't scale if more flags get added (e.g. a comments-count badge, an edit/delete affordance, or a compact list-row layout). If/when that happens, it's worth revisiting this as a **composable** card — e.g. a `RecipeCard` shell that accepts child "slot" components (`<RecipeCard.Badge>`, `<RecipeCard.Rating>`, `<RecipeCard.Footer>`) or a single `fields`/`sections` config array — so each page opts into exactly the pieces it needs instead of the component growing more boolean props per consumer. Not worth doing preemptively; revisit once a fourth or fifth flag is needed.
