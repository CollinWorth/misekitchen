# Adding ingredients to the grocery list

Two entry points feed the same grocery list, and both now share the same selection + pantry logic via [src/utils/grocery.js](../src/utils/grocery.js):

- **From the meal plan** — [GroceryList.js](../src/pages/GroceryList.js)'s "📅 Import from meal plan" panel. Bulk: pick several planned meals, review the merged ingredient list, add what's missing.
- **From a single recipe** — [RecipeCard.js](../src/components/RecipeCard.js)'s kebab (⋮) menu → "🛒 Add to grocery list". Same review-and-select step, scoped to one recipe's `ingredients` array (no merge needed).

## The meal-plan flow (two steps)

**Step 0 — pick meals.** `GroceryList.js` fetches the current week's planned meals (`GET /groceryList/week-meals`), shows a checkbox per meal plus a ×1–×8 serving multiplier (`mpMultipliers`), and lets you select which planned meals to pull ingredients from.

**Step 1 — review ingredients** (`reviewIngredients()`). For the selected meals:
1. Counts how many times each `recipe_id` appears (accounting for the multiplier — same recipe twice a week, or scaled servings, multiplies its ingredient quantities).
2. Fetches each unique recipe in full (`GET /recipes/{id}`) and merges their ingredients (`mergeIngredients()`): names are normalized (singular/plural, prep adjectives like "fresh"/"chopped" stripped) and quantities with matching units are summed.
3. Cross-references the merged list against the pantry (see below) and **pre-deselects anything already in your pantry** — it still shows in the list, just unchecked, so you can override.
4. You check/uncheck items, optionally adding any to the pantry inline, then "Add N ingredients to list" PUTs each selected item to the grocery list one at a time (`generateFromMealPlan()`).

## Pantry — the "don't add things I already have" feature

This is the part worth understanding before changing anything:

- **Storage**: a flat array of lowercased strings in `localStorage['mise_pantry']` (`pantryGet`/`pantrySave` in `utils/grocery.js`). Seeded with ~19 common staples (salt, pepper, oils, flour, baking soda/powder, butter, water, garlic, onion, vanilla, cooking spray) the first time it's read.
- **Per-browser, not per-account.** It's keyed only by `mise_pantry` — not scoped to the user ID like the category-override store (`mise_cat_${uid}`) is. Switch browsers or clear site data and the pantry resets to defaults. This is the main thing to fix if pantry becomes a heavier-used feature (see below).
- **Matching** (`pantryMatches`): lowercases the ingredient name, strips a leading prep adjective (`fresh`, `dried`, `minced`, `chopped`, `unsalted`, …, via `PREP_PREFIX_RE`), then checks the result against the pantry list allowing a trailing `s` either direction. So "fresh garlic", "garlic", and "garlics" all match a pantry entry of `garlic`.
- **Adding to pantry**: each ingredient row that *isn't* already matched shows a small "+ pantry" button; clicking it lowercases and saves the name, then immediately re-runs the match over the current ingredient list so that row (and any sibling row with the same name) flips to unchecked + "in pantry".
- The full pantry — all saved items as removable chips, plus a manual add field — is browsable in a collapsible "🏠 My Pantry" drawer at the bottom of the meal-plan review step. The single-recipe popover (being a small floating menu, not a full page) only exposes the per-row "+ pantry" button, not the full chip-browser; both read/write the same `localStorage` key, so pantry state stays in sync between the two no matter which one you used to add an item.

## Aisle categorization

Every item gets a `category` (produce, meat, dairy, …) so the main grocery list groups by aisle. `categorize(name)` does keyword matching against the `SECTIONS` table (longest keyword match wins, word-boundary aware so "oil" doesn't match "foil"). Per-user overrides (dragging an item to a different aisle on the grocery list page) are stored in `localStorage['mise_cat_${uid}']` and checked first via `effectiveCategory()`.

## What changed when this was extracted (2026-06)

- `pantryGet`/`pantrySave`/`pantryMatches`, the `SECTIONS` categorization table, `categorize`/`effectiveCategory`/`getCatOverrides`, and a new `ensureGroceryList(uid)` helper (find-or-create the user's list) moved out of `GroceryList.js` into `src/utils/grocery.js` so `RecipeCard.js` could reuse them without duplicating the matching logic.
- **Bug fix**: the per-ingredient review rows are `<label>` elements (so clicking the row toggles the checkbox). Global form styling (`label { text-transform: uppercase; ... }` in `global.css`) was bleeding through and rendering every ingredient name in caps with form-label spacing — e.g. "GARLIC" instead of "garlic". Fixed in both `.mp-ing-row` (meal-plan flow) and the new `.recipe-card-grocery-row` (single-recipe flow) by resetting `text-transform`/`letter-spacing`/`font-weight`/`margin-bottom` at the row level.
- Single-recipe parity: `RecipeCard`'s "🛒 Add to grocery list" used to blindly POST every ingredient via `/groceryList/from-meal-plan`. It now opens the same kind of review step inline in its dropdown — checkbox per ingredient, pantry-aware pre-selection, inline "+ pantry" — then adds only the selected items via the same `PUT /groceryList/{id}` calls the meal-plan flow uses (via `ensureGroceryList` + `effectiveCategory`).

## Possible next improvements

- **Sync pantry to the backend per-user** instead of `localStorage`, so it follows you across devices/browsers. Would need a small new collection/endpoint (e.g. `pantry_collection` keyed by `user_id`) — the matching logic (`pantryMatches`) doesn't change, only where the list is read/written.
- The single-recipe popover could grow a "🏠 My Pantry" management drawer too if people start using "+ pantry" enough to want to review/remove entries without going to the full grocery list page.
