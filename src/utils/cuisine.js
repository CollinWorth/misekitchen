// Shared cuisine → pastel background palette.
//
// Used for the standardized "info fallback" rendered whenever a recipe has no
// usable image (no image_url, or the image failed to load). See
// docs/RecipeCard.md for the standard. Keep this as the SINGLE source of these
// colors — do not re-declare a local CUISINE_BG / CUISINE_PASTELS map in a page.
export const CUISINE_PASTELS = {
  italian: '#F5EDE8', mexican: '#E9F2E9', japanese: '#F2EDF4', chinese: '#F5EDEC',
  indian: '#F5F0E8', american: '#EBF0F5', french: '#EEF0F8', thai: '#F3F2E7',
  mediterranean: '#E8F2EF', greek: '#EDF0F8', korean: '#F4EDF2',
};

export const CUISINE_PASTEL_DEFAULT = '#F2F0EB';

export const cuisinePastel = c =>
  CUISINE_PASTELS[(c || '').toLowerCase()] || CUISINE_PASTEL_DEFAULT;
