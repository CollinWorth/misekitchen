from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request, BackgroundTasks
from bson import ObjectId
from database import mealPlans_collection, recipes_collection, users_collection, follows_collection, comments_collection, ratings_collection, images_collection, parse_object_id
from model import Recipe
from auth import get_current_user_id, get_optional_user_id
from pydantic import BaseModel
import httpx
import re
import os
import uuid
import base64
import json
import anthropic
from fractions import Fraction
from urllib.parse import urlparse
from datetime import datetime, timezone
from recipe_scrapers import scrape_html

# Cap stored image size to stay well under MongoDB's 16 MB BSON document limit.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

# ── Optional CRF ingredient parser (ingredient-parser-nlp) ───────────────────
try:
    from ingredient_parser import parse_ingredient as _crf_parse
    _HAS_CRF = True
except ImportError:
    _HAS_CRF = False

# ── NLTK (sentence tokenizer for instruction segmentation) ───────────────────
try:
    import nltk
    for _pkg in ('punkt', 'punkt_tab', 'averaged_perceptron_tagger',
                 'averaged_perceptron_tagger_eng'):
        nltk.download(_pkg, quiet=True)
    from nltk.tokenize import sent_tokenize as _sent_tokenize
    _HAS_NLTK = True
except Exception:
    _HAS_NLTK = False

UNITS = {
    'cup','cups','tbsp','tablespoon','tablespoons','tsp','teaspoon','teaspoons',
    't','T','tbs',
    'oz','ounce','ounces','fl oz','fluid ounce','lb','lbs','pound','pounds',
    'g','gram','grams','kg','kilogram','kilograms',
    'ml','milliliter','milliliters','millilitre','l','liter','liters','litre',
    'clove','cloves','can','cans','bunch','bunches','pinch','pinches','dash','dashes',
    'handful','handfuls','slice','slices','piece','pieces','inch','inches',
    'package','packages','pkg','sprig','sprigs','stalk','stalks',
    'sheet','sheets','strip','strips','head','heads','stick','sticks',
    'fillet','fillets','ear','ears','bottle','bottles','bag','bags',
    'large','medium','small',
}

# ── Unicode fraction normalisation ───────────────────────────────────────────
_UNICODE_FRACS = {
    '½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3',
    '⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8','⅙':'1/6','⅚':'5/6',
}

def _norm_fracs(s: str) -> str:
    # Fix common OCR misreads of fraction characters before unicode substitution
    s = re.sub(r'(\d)\s*V2\b', r'\1½', s)   # "3V2" → "3½"  (½ misread as V2)
    s = re.sub(r'\bAa\b', '¼', s)            # "Aa"  → "¼"   (¼ misread as Aa)
    for ch, rep in _UNICODE_FRACS.items():
        # "3½" → "3 1/2" (add space between whole digit and fraction)
        s = re.sub(rf'(\d){re.escape(ch)}', rf'\1 {rep}', s)
        s = s.replace(ch, rep)
    return s

# ── String-number → digit substitution ───────────────────────────────────────
_STRING_NUMBERS = {
    'one-quarter': '1/4', 'one-half': '1/2', 'one-third': '1/3',
    'three-quarters': '3/4', 'three-quarter': '3/4', 'two-thirds': '2/3',
    'twelve': '12', 'eleven': '11', 'ten': '10', 'nine': '9', 'eight': '8',
    'seven': '7', 'six': '6', 'five': '5', 'four': '4', 'three': '3',
    'two': '2', 'one': '1', 'zero': '0',
    'half': '1/2', 'quarter': '1/4',
    r'\ba\b': '1', r'\ban\b': '1',   # "a pinch", "an ounce"
}
# Units pattern for "2cups" → "2 cups" fixing
_UNITS_JOINED = '|'.join(sorted(
    (u for u in UNITS if not u[0].isupper()),  # skip size words like Large
    key=len, reverse=True,
))

def _preprocess_ingredient(s: str) -> str:
    """Normalisation pipeline run before the CRF parser and the regex fallback."""
    s = _norm_fracs(s.strip())
    # Strip dual-measurement: "1 cup / 80g walnut pieces" → "1 cup walnut pieces"
    # Require whitespace before '/' to avoid matching fractions like "1/2".
    # Only strip the metric+unit token, not everything after it.
    s = re.sub(r'\s+/\s*\d+(?:\.\d+)?\s*(?:g|ml|kg|l|oz|lb)\b', '', s, flags=re.I)
    # Also strip a bare second metric amount after a unit (no slash):
    # "3 1/2 oz 100g orecchiette" → "3 1/2 oz orecchiette"
    s = re.sub(rf'(\b(?:{_UNITS_JOINED})\b)\s+\d+(?:\.\d+)?\s*(?:g|ml|kg|oz|lb|l)\b\s*',
               r'\1 ', s, flags=re.I)
    # String numbers → digits (longest match first via dict ordering)
    for word, num in _STRING_NUMBERS.items():
        s = re.sub(rf'\b{word}\b', num, s, flags=re.I)
    # "1 to 2 cups" / "1 or 2 cups" → "1-2 cups"
    s = re.sub(r'(\d+(?:\.\d+)?)\s+(?:to|or)\s+(\d+(?:\.\d+)?)', r'\1-\2', s, flags=re.I)
    # Expand single-letter shorthands before unit spacing fix
    s = re.sub(r'\bT\b', 'tbsp', s)   # capital T = tablespoon
    s = re.sub(r'\bt\b', 'tsp', s)    # lowercase t = teaspoon
    s = re.sub(r'\btbs\b', 'tbsp', s, flags=re.I)
    # "2cups" → "2 cups" (no space between number and unit)
    s = re.sub(rf'(\d)({_UNITS_JOINED})\b', r'\1 \2', s, flags=re.I)
    # Normalise whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s

# ── Fraction → nice string ────────────────────────────────────────────────────
def _frac_to_str(val) -> str:
    """Convert a Fraction / float / int to a cooking-friendly string like '2 1/2'."""
    try:
        f = Fraction(val).limit_denominator(16)
    except Exception:
        return str(val)
    if f == 0:
        return '0'
    if f.denominator == 1:
        return str(f.numerator)
    whole = int(f)
    rem = f - whole
    if whole > 0 and rem > 0:
        return f"{whole} {rem.numerator}/{rem.denominator}"
    return f"{f.numerator}/{f.denominator}"

# ── pint unit → plain string ──────────────────────────────────────────────────
_PINT_UNIT_MAP = {
    'fluid_ounce': 'fl oz', 'fluid_ounces': 'fl oz',
    'milliliter': 'ml', 'millilitre': 'ml',
    'liter': 'l', 'litre': 'l',
    'kilogram': 'kg', 'gram': 'g',
    'tablespoon': 'tbsp', 'teaspoon': 'tsp',
    'T': 'tbsp', 'tbs': 'tbsp', 't': 'tsp',
    'pound': 'lb', 'ounce': 'oz',
}

def _norm_unit_str(s: str) -> str:
    return _PINT_UNIT_MAP.get(s.lower(), s)

# ── Prep-note stripping ───────────────────────────────────────────────────────
_PREP_NOTE_RE = re.compile(
    r'[,;]\s*(?:(?:very |extra |finely |coarsely |roughly |thinly |freshly |'
    r'lightly |well |gently )?\s*'
    r'(?:chopped|diced|minced|sliced|grated|shredded|peeled|deveined|crushed|'
    r'julienned|cubed|halved|quartered|torn|crumbled|cooked|beaten|whisked|'
    r'sifted|melted|softened|divided|optional|trimmed|pitted|seeded|cored|'
    r'washed|dried|drained|rinsed|pressed|roasted|toasted|blanched|'
    r'at room temperature|room temperature|to taste|plus more|plus extra|'
    r'or more|if needed|as needed)).*$',
    re.I,
)

def _strip_prep(name: str) -> str:
    name = re.sub(r'\s*\([^)]*\)', '', name)
    name = _PREP_NOTE_RE.sub('', name)
    return name.strip().rstrip(',;').strip()

# ── Cuisine inference ─────────────────────────────────────────────────────────
_CUISINE_HINTS: dict[str, list[str]] = {
    'Italian':  ['pasta','parmesan','parmigiano','mozzarella','prosciutto','pancetta',
                 'pecorino','arborio','risotto','polenta','ciabatta','focaccia',
                 'balsamic','ricotta','gnocchi','lasagna','spaghetti','cannellini'],
    'Mexican':  ['tortilla','jalapeño','jalapeno','cilantro','chili powder','queso',
                 'cotija','tomatillo','chipotle','ancho','poblano','masa','tamale','enchilada'],
    'Japanese': ['mirin','sake','dashi','miso','nori','wasabi','panko','rice vinegar',
                 'edamame','togarashi','bonito','kombu','ponzu','udon','soba'],
    'Indian':   ['garam masala','turmeric','cardamom','fenugreek','ghee','paneer',
                 'naan','basmati','masala','chana','dal','chapati','tikka','tandoori'],
    'Thai':     ['fish sauce','lemongrass','galangal','kaffir lime','thai basil',
                 'nam pla','sambal','coconut milk'],
    'Chinese':  ['hoisin','oyster sauce','five spice','bok choy','wonton','szechuan',
                 'sichuan','star anise','shaoxing','doubanjiang'],
    'French':   ['dijon','herbes de provence','tarragon','crème fraîche','gruyère',
                 'cognac','beurre','roux','bouquet garni','brioche'],
    'Greek':    ['feta','kalamata','tzatziki','phyllo','halloumi','spanakopita','dolma'],
    'Spanish':  ['saffron','chorizo','manchego','sherry','pimentón','serrano','paella'],
}

def _infer_cuisine(recipe_name: str, ingredients: list[dict]) -> str:
    haystack = recipe_name.lower() + ' ' + ' '.join(i['name'].lower() for i in ingredients)
    best, best_score = '', 0
    for cuisine, keywords in _CUISINE_HINTS.items():
        score = sum(1 for kw in keywords if kw in haystack)
        if score > best_score:
            best, best_score = cuisine, score
    return best if best_score >= 2 else ''

# ── CRF ingredient parser (ingredient-parser-nlp) ────────────────────────────
def _parse_with_crf(raw: str) -> dict | None:
    """Parse one ingredient line using the CRF model. Returns None on any failure."""
    if not _HAS_CRF:
        return None
    try:
        r = _crf_parse(raw)
        name = ' '.join(n.text for n in (r.name or []))
        if not name:
            return None
        qty_str, unit_str = '', ''
        if r.amount:
            a = r.amount[0]
            qty   = getattr(a, 'quantity', None)
            q_max = getattr(a, 'quantity_max', None)
            is_rng = getattr(a, 'RANGE', False)
            unit  = getattr(a, 'unit', None)
            if qty is not None:
                if is_rng and q_max is not None:
                    qty_str = f"{_frac_to_str(qty)}-{_frac_to_str(q_max)}"
                else:
                    qty_str = _frac_to_str(qty)
            if unit is not None:
                unit_str = _norm_unit_str(str(unit))
        return {'name': name, 'quantity': qty_str, 'unit': unit_str}
    except Exception:
        return None

# ── Regex fallback (used when CRF not installed) ──────────────────────────────
def _parse_ingredient_regex(s: str) -> dict:
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    qty_re = r'^([\d]+(?:[\/\-\s][\d]+(?:\/[\d]+)?)?(?:\.\d+)?)\s*'
    m = re.match(qty_re, s)
    quantity, unit, name = '', '', s
    if m:
        quantity = m.group(1).strip()
        rest = s[m.end():].strip()
        words = rest.split()
        if words and words[0].lower().rstrip('.') in UNITS:
            unit = words[0]
            name = ' '.join(words[1:])
        else:
            name = rest
    return {'name': _strip_prep(name).strip(), 'quantity': quantity, 'unit': unit}

# ── Public entry point ────────────────────────────────────────────────────────
def parse_ingredient_string(raw: str) -> dict:
    s = _preprocess_ingredient(raw)
    result = _parse_with_crf(s) or _parse_ingredient_regex(s)
    return result

router = APIRouter()


def recipe_to_json(recipe):
    recipe = dict(recipe)
    recipe["_id"] = str(recipe["_id"])
    if isinstance(recipe.get("user_id"), ObjectId):
        recipe["user_id"] = str(recipe["user_id"])
    return recipe


async def _attach_author_names(results: list) -> list:
    uid_set = list({r["user_id"] for r in results if r.get("user_id")})
    if not uid_set:
        return results
    try:
        authors = await users_collection.find(
            {"_id": {"$in": [ObjectId(u) for u in uid_set]}}
        ).to_list(len(uid_set))
        author_map = {str(u["_id"]): u.get("name", "Chef") for u in authors}
        for r in results:
            r["author_name"] = author_map.get(r.get("user_id", ""), "Chef")
    except Exception:
        pass
    return results


async def _attach_comment_counts(results: list) -> list:
    ids = [r["_id"] for r in results if r.get("_id")]
    if not ids:
        return results
    counts_map = {}
    async for doc in comments_collection.aggregate([
        {"$match": {"recipe_id": {"$in": ids}}},
        {"$group": {"_id": "$recipe_id", "count": {"$sum": 1}}},
    ]):
        counts_map[doc["_id"]] = doc["count"]
    for r in results:
        r["comment_count"] = counts_map.get(r.get("_id", ""), 0)
    return results


@router.get("/feed")
async def get_feed(current_user_id: str = Depends(get_current_user_id), skip: int = 0, limit: int = 20):
    following = await follows_collection.find({"follower_id": current_user_id}).to_list(1000)
    if not following:
        return []
    following_ids = [ObjectId(f["following_id"]) for f in following]
    cursor = recipes_collection.find(
        {"user_id": {"$in": following_ids}, "is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None}
    ).sort("_id", -1).skip(skip).limit(limit)
    results = []
    async for r in cursor:
        results.append(recipe_to_json(r))
    results = await _attach_author_names(results)
    return await _attach_comment_counts(results)


@router.get("/explore")
async def explore_recipes(skip: int = 0, limit: int = 100, user_id: str | None = Depends(get_optional_user_id)):
    query: dict = {"is_public": True, "is_modified": {"$ne": True}, "original_recipe_id": None}
    if user_id:
        query["user_id"] = {"$ne": ObjectId(user_id)}
    cursor = recipes_collection.find(query).sort("_id", -1).skip(skip).limit(limit)
    results = []
    async for r in cursor:
        results.append(recipe_to_json(r))
    results = await _attach_author_names(results)
    return await _attach_comment_counts(results)


@router.get("/user/{user_id}")
async def get_recipes_by_user(user_id: str):
    try:
        user_obj_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    recipes = await recipes_collection.find({"user_id": user_obj_id}).sort("_id", -1).to_list(1000)
    return [recipe_to_json(r) for r in recipes]


@router.get("/{recipe_id}")
async def get_recipe(recipe_id: str, background_tasks: BackgroundTasks):
    oid = parse_object_id(recipe_id, "recipe_id")
    recipe = await recipes_collection.find_one({"_id": oid})
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.get("is_public"):
        background_tasks.add_task(
            recipes_collection.update_one,
            {"_id": oid},
            {"$inc": {"view_count": 1}}
        )
    return recipe_to_json(recipe)


class ScrapeRequest(BaseModel):
    url: str

@router.post("/scrape")
async def scrape_recipe(payload: ScrapeRequest):
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=headers)
            print(f"Scrape fetch: {resp.status_code} {url}")
            resp.raise_for_status()
        scraper = scrape_html(resp.text, org_url=url, wild_mode=True)
        def safe(fn):
            try: return fn()
            except Exception: return None

        ingredients_raw = safe(scraper.ingredients) or []
        ingredients = [parse_ingredient_string(line) for line in ingredients_raw]

        instructions_raw = safe(scraper.instructions) or ""

        return {
            "recipe_name": safe(scraper.title) or "",
            "cuisine": safe(scraper.cuisine) or "",
            "image_url": safe(scraper.image) or "",
            "prep_time": safe(scraper.prep_time) or 0,
            "cook_time": safe(scraper.cook_time) or 0,
            "servings": safe(scraper.yields) or "",
            "ingredients": ingredients,
            "instructions": instructions_raw,
            "tags": "",
        }
    except httpx.HTTPStatusError as e:
        print(f"Scrape HTTP error: {e.response.status_code} {url}")
        if e.response.status_code == 403:
            raise HTTPException(status_code=422, detail="This site blocks importing. Try a different recipe site.")
        raise HTTPException(status_code=422, detail=f"Could not fetch page ({e.response.status_code})")
    except Exception as e:
        print(f"Scrape error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"Could not parse recipe: {str(e)}")


@router.post("/scrape-smart")
async def scrape_smart(payload: ScrapeRequest):
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    fetch_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    # ── TikTok ────────────────────────────────────────────────────────
    if "tiktok.com" in url:
        thumbnail = ""
        description = ""

        # Step 1: oEmbed for thumbnail + short title
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
                oembed = await client.get(
                    f"https://www.tiktok.com/oembed?url={url}",
                    headers=fetch_headers,
                )
            if oembed.status_code == 200:
                data = oembed.json()
                thumbnail = data.get("thumbnail_url", "")
                description = data.get("title", "")  # might be truncated
                print(f"TikTok oEmbed title: {description[:120]!r}")
        except Exception as e:
            print(f"TikTok oEmbed error: {e}")

        # Step 2: fetch actual page to get full caption from og:description
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
                page = await client.get(url, headers=fetch_headers)
            if page.status_code == 200:
                full_desc = _extract_meta(page.text, ["og:description", "description"])
                if full_desc and len(full_desc) > len(description):
                    description = full_desc
                    print(f"TikTok page description: {description[:120]!r}")
        except Exception as e:
            print(f"TikTok page fetch error: {e}")

        if not description:
            raise HTTPException(status_code=422, detail="Could not read this TikTok video. Try copying the description and using 'Paste text' instead.")

        print(f"TikTok parsing text ({len(description)} chars): {description[:200]!r}")
        parsed = parse_recipe_text(description)
        parsed["image_url"] = thumbnail
        parsed["raw_text"] = description
        print(f"TikTok parsed: name={parsed['recipe_name']!r}, ingredients={len(parsed['ingredients'])}")
        return parsed

    # ── Regular recipe site: recipe-scrapers ────────────────────────
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=fetch_headers)
            resp.raise_for_status()
        scraper = scrape_html(resp.text, org_url=url, wild_mode=True)
        def safe(fn):
            try: return fn()
            except Exception: return None
        ingredients_raw = safe(scraper.ingredients) or []
        ingredients = [parse_ingredient_string(line) for line in ingredients_raw]
        return {
            "recipe_name": safe(scraper.title) or "",
            "cuisine": safe(scraper.cuisine) or "",
            "image_url": safe(scraper.image) or "",
            "prep_time": safe(scraper.prep_time) or 0,
            "cook_time": safe(scraper.cook_time) or 0,
            "servings": safe(scraper.yields) or "",
            "ingredients": ingredients,
            "instructions": safe(scraper.instructions) or "",
            "tags": "",
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 403:
            raise HTTPException(status_code=422, detail="This site blocks importing. Try a different recipe site.")
        raise HTTPException(status_code=422, detail=f"Could not fetch page ({e.response.status_code})")
    except Exception as e:
        print(f"Scrape error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"Could not parse recipe: {str(e)}")


# ── Also expose a plain-text parse endpoint ─────────────────────────
class ParseTextRequest(BaseModel):
    text: str

@router.post("/parse-text")
async def parse_text(payload: ParseTextRequest):
    """Parse raw recipe text (e.g. pasted from TikTok description or anywhere)."""
    result = parse_recipe_text(payload.text)
    result["raw_text"] = payload.text
    return result


@router.post("/parse-photo")
async def parse_photo(file: UploadFile = File(...)):
    """Parse a recipe from a photo using Claude vision."""
    image_data = await file.read()
    image_b64 = base64.standard_b64encode(image_data).decode("utf-8")
    media_type = file.content_type or "image/jpeg"
    if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        media_type = "image/jpeg"

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from environment

    prompt = (
        "Extract the recipe from this image and return ONLY a JSON object with these exact fields:\n"
        '{\n'
        '  "recipe_name": "string",\n'
        '  "cuisine": "string (e.g. Italian, Mexican — empty string if unclear)",\n'
        '  "prep_time": number (minutes, 0 if unknown),\n'
        '  "cook_time": number (minutes, 0 if unknown),\n'
        '  "servings": "string (e.g. \'4\' or \'4-6\', empty if unknown)",\n'
        '  "ingredients": [{"name": "string", "quantity": "string", "unit": "string"}],\n'
        '  "instructions": "string (each step on its own line)",\n'
        '  "tags": ""\n'
        '}\n\n'
        "Rules:\n"
        "- Split ingredients into name/quantity/unit (e.g. name=flour, quantity=2, unit=cups)\n"
        "- quantity and unit should be strings; quantity is just the number/fraction (e.g. '1/2')\n"
        "- If the image is not a recipe, return empty strings and empty arrays\n"
        "- Return ONLY the JSON object, no markdown fences, no explanation"
    )

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_b64},
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
    except Exception as e:
        print(f"Claude parse-photo error: {e}")
        raise HTTPException(status_code=502, detail="AI service unavailable")

    text = message.content[0].text.strip()
    # Strip markdown code fences if Claude adds them anyway
    text = re.sub(r'^```(?:json)?\s*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)

    try:
        result = json.loads(text)
    except Exception:
        print(f"Claude returned non-JSON: {text[:300]}")
        raise HTTPException(status_code=422, detail="Could not parse AI response")

    # Normalise types
    result.setdefault("recipe_name", "")
    result.setdefault("cuisine", "")
    result.setdefault("image_url", "")
    result.setdefault("prep_time", 0)
    result.setdefault("cook_time", 0)
    result.setdefault("servings", "")
    result.setdefault("ingredients", [])
    result.setdefault("instructions", "")
    result.setdefault("tags", "")
    return result


def _extract_meta(html: str, names: list[str]) -> str:
    """Extract content from <meta name="..."> or <meta property="..."> tags."""
    for name in names:
        m = re.search(
            rf'<meta[^>]+(?:name|property)=["\'](?:og:)?{re.escape(name.replace("og:",""))}["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.I
        ) or re.search(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\'](?:og:)?{re.escape(name.replace("og:",""))}["\']',
            html, re.I
        )
        if m:
            return m.group(1).strip()
    return ""


def parse_recipe_text(text: str) -> dict:
    """
    Parse unstructured recipe text into structured data.
    Improvements over v1:
      - Unicode fraction normalisation (½ ¼ ¾ etc.)
      - Prep-note stripping from ingredient names
      - ALL-CAPS line detection for recipe title
      - Time-range support ("45–60 min" → 45)
      - Headerless heuristic: detects ingredients & numbered steps
        even when no section labels are present
      - Cuisine inference from ingredient keywords
    """
    text = _norm_fracs(text)

    # Inject newlines before run-together section keywords (TikTok / single-line OCR)
    text = re.sub(
        r'(?<!\n)\s*(Ingredients?|Instructions?|Directions?|Method|Steps?|Preparation|For the \w+)\s*:',
        r'\n\1:',
        text, flags=re.I,
    )
    text = re.sub(r'\s{2,}([•·\-–—])\s*', r'\n\1 ', text)

    # Filter out lone page numbers and nutritional noise lines before sectioning
    _PAGE_NUM_RE = re.compile(r'^\d{1,4}$')
    _NUTRITION_RE = re.compile(
        r'^\d+[-–]\d+\s*(?:g|mg|kcal|cal|kj)\b'   # "10-15g", "200kcal"
        r'|^\d+\s*(?:g|mg|kcal|cal|kj)\s*\d*$',    # "15g 4"
        re.I,
    )
    lines = [
        l.strip() for l in text.splitlines()
        if l.strip()
        and not _PAGE_NUM_RE.match(l.strip())
        and not _NUTRITION_RE.match(l.strip())
    ]

    SECTION_RE = re.compile(
        # Allow optional parenthetical after keyword: "Ingredients (Serves 2)"
        r'^(ingredients?|instructions?|directions?|method|steps?|preparation|for the .+)'
        r'(?:\s*\([^)]*\))?'   # optional "(Serves 2)" etc.
        r':?\s*$',
        re.I,
    )
    # ── Section split ─────────────────────────────────────────────────────────
    sections: dict[str, list[str]] = {}
    current = 'header'
    for line in lines:
        if SECTION_RE.match(line):
            key = SECTION_RE.match(line).group(1).lower().strip()
            current = key
            sections[current] = []
        else:
            sections.setdefault(current, []).append(line)

    # ── Recipe name ───────────────────────────────────────────────────────────
    # Pass 1: scan header for a Title Case or multi-word ALL-CAPS line
    header_lines = sections.get('header', [])
    recipe_name = ''
    _TITLE_CASE_RE = re.compile(r'^(?:[A-Z][a-z]+(?:\s+(?:and|the|of|with|for|in|a|an|or)\b|\s+[A-Z][a-z]+))+$')
    for line in header_lines:
        clean = re.sub(r'#\S+', '', line).strip()
        clean = re.sub(r'[\U00010000-\U0010ffff]', '', clean).strip()
        if not clean or clean.startswith('http'):
            continue
        letters = re.sub(r'[^a-zA-Z]', '', clean)
        is_caps = letters and letters == letters.upper() and len(letters) >= 4
        word_count = len(clean.split())
        # Require ≥2 words for ALL-CAPS to avoid book section labels ("PLANTS", "FIBER")
        if is_caps and 2 <= word_count <= 8:
            recipe_name = clean.title()
            break
        if not recipe_name and len(clean) < 80:
            recipe_name = clean  # fallback, keep scanning

    # Pass 2: if no good name yet, look for the cookbook "title → description" pattern.
    # Strategy: find the first long prose paragraph (> 80 chars), then look at the lines
    # immediately before it for short Title Case lines that form the recipe title.
    if not recipe_name or len(recipe_name.split()) == 1:
        all_lines_flat = [l for k, v in sections.items() for l in v]
        desc_idx = None
        for i, line in enumerate(all_lines_flat):
            if (len(line) > 80 and line[0].isupper()
                    and not re.match(r'^\d+[\.\)]', line)):
                desc_idx = i
                break
        if desc_idx is not None and desc_idx > 0:
            # Walk backwards from desc_idx collecting consecutive short Title Case lines.
            # Stop if we hit a short single-word label (e.g. "Swap", "Top-up") — these
            # are cookbook section markers, not part of the recipe title. We detect them
            # by requiring that every collected line has at least one word with > 4 chars
            # (real food words like "Broccoli", "Walnut", "Orecchiette").
            title_parts = []
            for j in range(desc_idx - 1, max(desc_idx - 4, -1), -1):
                ln = re.sub(r'[\U00010000-\U0010ffff]', '', all_lines_flat[j]).strip()
                if not ln or re.match(r'^\d', ln) or re.match(r'^[•·\-*]', ln) or len(ln) > 60:
                    break
                words = ln.split()
                letters = re.sub(r'[^a-zA-Z\-]', '', ln)
                if not letters:
                    break
                has_substance = any(len(re.sub(r'[^a-zA-Z]', '', w)) > 4 for w in words)
                is_title = (ln[0].isupper()
                            and sum(1 for w in words if w[0].isupper()) >= len(words) * 0.6
                            and 1 <= len(words) <= 6
                            and has_substance)
                if is_title:
                    title_parts.insert(0, ln)
                else:
                    break
            candidate = ' '.join(title_parts).strip()
            if len(candidate.split()) >= 2:
                recipe_name = candidate

    # ── Ingredients ───────────────────────────────────────────────────────────
    ing_lines: list[str] = []
    for k, v in sections.items():
        if 'ingredient' in k:
            ing_lines = v
            break

    # ── Instructions ──────────────────────────────────────────────────────────
    inst_lines: list[str] = []
    for k, v in sections.items():
        if any(w in k for w in ('instruction', 'direction', 'method', 'step', 'preparation')):
            inst_lines = v
            break

    # ── Heuristic fallback when no section headers found ─────────────────────
    if not ing_lines and not inst_lines:
        all_body = [l for k, v in sections.items() for l in v]
        ing_lines, inst_lines = _classify_lines_heuristic(all_body)

    # Numbered-step fallback: if instructions empty but body has "1. … 2. …" lines
    if not inst_lines:
        all_body = [l for k, v in sections.items() if k != 'header' for l in v]
        numbered = [l for l in all_body if re.match(r'^\d+[\.\)]\s+[A-Za-z]', l)]
        if len(numbered) >= 2:
            inst_lines = numbered

    # ── Parse ingredients ─────────────────────────────────────────────────────
    # Pre-join continuation lines: a line starting with "(" that follows an ingredient
    # is usually a parenthetical continuation (e.g. OCR split "broccoli\n(12 oz/350g)")
    joined_ing_lines: list[str] = []
    for line in ing_lines:
        line = line.lstrip('•·-*–—').strip()
        if not line:
            continue
        # Strip cookbook cross-references like "(page 264)"
        line = re.sub(r'\(page\s+\d+\)', '', line, flags=re.I).strip()
        # Continuation: line starts with "(" and previous line doesn't end complete
        if joined_ing_lines and line.startswith('('):
            joined_ing_lines[-1] = joined_ing_lines[-1] + ' ' + line
        elif joined_ing_lines and not re.match(r'^[\d¼½¾⅓⅔]', line) and not _parse_colon_ingredient(line):
            # Short non-quantity line following an ingredient may be a continuation
            # (e.g. "small florets" after "broccoli, cut into")
            prev = joined_ing_lines[-1]
            if prev.endswith(',') or (len(line.split()) <= 3 and not line[0].isupper()):
                joined_ing_lines[-1] = prev + ' ' + line
                continue
            joined_ing_lines.append(line)
        else:
            joined_ing_lines.append(line)

    ingredients = []
    for line in joined_ing_lines:
        if not line:
            continue
        ing = _parse_colon_ingredient(line) or parse_ingredient_string(line)
        if ing and ing['name']:
            ingredients.append(ing)

    # ── Times ─────────────────────────────────────────────────────────────────
    prep_time, cook_time, total_time = 0, 0, 0
    full_text_lower = text.lower()
    # Split around context labels and parse each segment
    _CTX_RE = re.compile(
        r'(?P<ctx>prep(?:aration)?|cook(?:ing)?|bak(?:e|ing)|roast(?:ing)?|fry(?:ing)?|total)\s*(?:time)?\s*:?\s*'
        r'(?P<span>(?:\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:hour|hr|h|min|minute|m)\b\s*)+)',
        re.I,
    )
    for cm in _CTX_RE.finditer(full_text_lower):
        mins = _parse_time_str(cm.group('span'))
        ctx  = cm.group('ctx').lower()
        if 'prep' in ctx:
            prep_time = mins
        elif any(w in ctx for w in ('cook', 'bak', 'roast', 'fry')):
            cook_time = mins
        elif 'total' in ctx:
            total_time = mins
    # Fallback: scan whole text for any time mention if nothing found yet
    if not prep_time and not cook_time and not total_time:
        for cm in _TIME_UNIT_RE.finditer(full_text_lower):
            mins = _parse_time_str(cm.group(0))
            ctx  = full_text_lower[max(0, cm.start() - 30):cm.start()]
            if 'prep' in ctx:
                prep_time = mins
            elif any(w in ctx for w in ('cook', 'bak', 'roast', 'fry')):
                cook_time = mins
            elif 'total' in ctx:
                total_time = mins
    # If only total time found, assign to cook_time
    if total_time and not prep_time and not cook_time:
        cook_time = total_time

    # ── Servings ──────────────────────────────────────────────────────────────
    servings = ''
    srv_m = re.search(
        r'(?:serves?|yield|makes?)\s*:?\s*(\d+(?:\s*[-–]\s*\d+)?)'
        r'|(\d+(?:\s*[-–]\s*\d+)?)\s*(?:servings?|portions?|people)',
        full_text_lower,
    )
    if srv_m:
        servings = (srv_m.group(1) or srv_m.group(2) or '').strip()

    # ── Cuisine inference ──────────────────────────────────────────────────────
    cuisine = _infer_cuisine(recipe_name, ingredients)

    # ── Instruction segmentation: split prose blobs into individual steps ────────
    expanded: list[str] = []
    for line in inst_lines:
        if len(line) > 60 and not re.match(r'^\d+[\.\)]\s', line):
            if _HAS_NLTK:
                sentences = _sent_tokenize(line)
            else:
                # Regex fallback: split on sentence-ending punctuation before a capital letter
                sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', line)
            parts = [s.strip() for s in sentences if s.strip()]
            expanded.extend(parts if len(parts) > 1 else [line])
        else:
            expanded.append(line)
    inst_lines = expanded

    instructions = '\n'.join(inst_lines) if inst_lines else ''

    return {
        "recipe_name": recipe_name,
        "cuisine": cuisine,
        "image_url": "",
        "prep_time": prep_time,
        "cook_time": cook_time,
        "servings": servings,
        "ingredients": ingredients,
        "instructions": instructions,
        "tags": "",
    }


def _classify_lines_heuristic(lines: list[str]) -> tuple[list[str], list[str]]:
    """
    When no Ingredients/Instructions headers exist, classify lines by pattern.
    Ingredient: short line starting with a number (or colon-format "Name: qty").
    Instruction: longer prose line, or starts with a numbered step ("1. Preheat").
    """
    _ING_NUM_RE = re.compile(
        r'^[\d]+(?:[\/\s]\d+)?\s*'
        r'(?:' + '|'.join(re.escape(u) for u in UNITS) + r')?\s+\S',
        re.I,
    )
    _STEP_RE = re.compile(r'^\d+[\.\)]\s+[A-Z]')

    ing_lines, inst_lines = [], []
    for line in lines:
        clean = line.lstrip('•·-*–—').strip()
        if not clean:
            continue
        if _STEP_RE.match(clean):
            inst_lines.append(clean)
        elif _ING_NUM_RE.match(clean) or _parse_colon_ingredient(clean):
            ing_lines.append(clean)
        elif len(clean) > 60:
            inst_lines.append(clean)
    return ing_lines, inst_lines


# ── Time string → minutes ─────────────────────────────────────────────────────
_TIME_UNIT_RE = re.compile(
    r'(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(hour|hr|h|min|minute|m)\b',
    re.I,
)

def _parse_time_str(text: str) -> int:
    """
    Parse a time string (with optional range and compound units) to minutes.
    Examples:
      "30 min"            → 30
      "1 hour"            → 60
      "1 hour 30 minutes" → 90
      "45-60 minutes"     → 45   (lower bound)
      "1.5 hours"         → 90
    """
    total = 0
    for m in _TIME_UNIT_RE.finditer(text):
        val = float(m.group(1))
        unit = m.group(2).lower()
        if unit in ('hour', 'hr', 'h'):
            total += int(val * 60)
        else:
            total += int(val)
    return total


def _parse_colon_ingredient(line: str) -> dict | None:
    """
    Handles: "Bread Flour: 350g"  →  name=Bread Flour, qty=350, unit=g
    Also handles unicode fractions in the quantity portion.
    """
    line = _norm_fracs(line)
    m = re.match(
        r'^(.+?):\s*'
        r'([\d\s\/]+)'
        r'\s*([a-zA-Z]{1,8})?'
        r'\s*(?:\([^)]*\))?'
        r'\s*(?:[,;].*)?$',
        line,
    )
    if not m:
        return None
    name = _strip_prep(m.group(1).strip())
    qty  = m.group(2).strip()
    unit = m.group(3) or ''
    if unit.lower() not in UNITS:
        unit = ''
    return {'name': name, 'quantity': qty, 'unit': unit} if name else None


@router.post("/{recipe_id}/save")
async def save_recipe_to_collection(recipe_id: str, user_id: str = Depends(get_current_user_id)):
    source = await recipes_collection.find_one({"_id": parse_object_id(recipe_id, "recipe_id")})
    if not source:
        raise HTTPException(status_code=404, detail="Recipe not found")
    author_doc = await users_collection.find_one({"_id": source["user_id"]})
    author_name = author_doc.get("name", "Chef") if author_doc else "Chef"
    copy = {k: v for k, v in source.items()
            if k not in ("_id", "user_id", "like_count", "avg_rating", "rating_count",
                         "is_public", "original_recipe_id", "original_author_name", "is_modified")}
    copy["user_id"] = ObjectId(user_id)
    copy["is_public"] = False
    copy["avg_rating"] = 0.0
    copy["rating_count"] = 0
    copy["original_recipe_id"] = recipe_id
    copy["original_recipe_name"] = source.get("recipe_name", "")
    copy["original_author_name"] = author_name
    copy["is_modified"] = False
    copy["created_at"] = datetime.now(timezone.utc)
    # Normalize the image to a relative served path (no-op if already one)
    copy["image_url"] = await _maybe_archive_image(copy.get("image_url"))
    result = await recipes_collection.insert_one(copy)
    return {"id": str(result.inserted_id), "message": "Saved to your recipes"}


@router.get("/{recipe_id}/versions")
async def get_recipe_versions(recipe_id: str):
    cursor = recipes_collection.find({
        "original_recipe_id": recipe_id,
        "is_public": True,
        "is_modified": True,
    })
    results = []
    async for r in cursor:
        results.append(recipe_to_json(r))
    return await _attach_author_names(results)


async def _maybe_archive_image(url: str | None) -> str | None:
    """Normalize a recipe image to a RELATIVE served path, copying external images in.

    All stored image URLs are relative (e.g. "/images/{id}" or "/uploads/x.jpg") so
    they're independent of host and reverse-proxy prefix; the frontend's imgUrl()
    prepends the configured API base at render time. External images are downloaded
    into the `images` collection (the local filesystem is ephemeral on Railway).
    """
    if not url:
        return url
    # If the URL contains an /images/{ObjectId} segment anywhere, treat as ours
    # and normalize to the relative path — handles scheme-less, wrong-host,
    # and legacy absolute URLs uniformly (e.g. "mise-production-…/images/<id>").
    # Trailing-boundary check avoids matching the 24-char prefix of a longer hex
    # string (e.g. a hash in a CDN URL) and accidentally claiming an external image.
    m = re.search(r"/images/[0-9a-fA-F]{24}(?![0-9a-fA-F])", url)
    if m:
        return m.group(0)
    parsed = urlparse(url)
    # Already a relative path (our own served image) — keep as-is
    if not parsed.scheme:
        return url
    # Absolute URL pointing at our own server — reduce to its relative path
    own_host = urlparse(os.getenv("BASE_URL", "")).netloc
    if parsed.hostname in ("localhost", "127.0.0.1") or (own_host and parsed.netloc == own_host):
        return parsed.path
    if not url.startswith("http"):
        return url
    # Genuine external image — download and persist, return a relative path
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return url
        ct = r.headers.get('content-type', '').split(';')[0].strip().lower()
        if not ct.startswith('image/'):
            return url
        result = await images_collection.insert_one({"data": r.content, "content_type": ct})
        return f"/images/{result.inserted_id}"
    except Exception:
        return url


@router.post("/")
async def create_recipe(recipe: Recipe, user_id: str = Depends(get_current_user_id)):
    recipe_dict = recipe.model_dump()
    recipe_dict["created_at"] = datetime.now(timezone.utc)
    recipe_dict["user_id"] = ObjectId(user_id)
    recipe_dict["image_url"] = await _maybe_archive_image(recipe_dict.get("image_url"))
    result = await recipes_collection.insert_one(recipe_dict)
    return {"id": str(result.inserted_id), "message": "Recipe created successfully"}


# Server-managed fields the client must never overwrite on edit (a full-document
# replace would otherwise reset them to the model's zero defaults / drop them).
_PRESERVE_ON_UPDATE = ("avg_rating", "rating_count", "view_count", "created_at")


@router.put("/{recipe_id}")
async def update_recipe(recipe_id: str, recipe: Recipe, user_id: str = Depends(get_current_user_id)):
    oid = parse_object_id(recipe_id, "recipe_id")
    existing = await recipes_collection.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if str(existing.get("user_id")) != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    recipe_dict = recipe.model_dump()
    try:
        recipe_dict["user_id"] = ObjectId(recipe_dict["user_id"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    recipe_dict["image_url"] = await _maybe_archive_image(recipe_dict.get("image_url"))
    # Carry over ratings / view counts / creation date from the stored doc
    for field in _PRESERVE_ON_UPDATE:
        if field in existing:
            recipe_dict[field] = existing[field]
    # Preserve provenance; mark as modified once edited
    if existing.get("original_recipe_id"):
        recipe_dict["original_recipe_id"] = existing["original_recipe_id"]
        recipe_dict["original_recipe_name"] = existing.get("original_recipe_name", "")
        recipe_dict["original_author_name"] = existing.get("original_author_name")
        recipe_dict["is_modified"] = True
    result = await recipes_collection.find_one_and_replace(
        {"_id": oid},
        recipe_dict,
        return_document=True,
    )
    return recipe_to_json(result)


@router.delete("/{recipe_id}")
async def delete_recipe(recipe_id: str, user_id: str = Depends(get_current_user_id)):
    oid = parse_object_id(recipe_id, "recipe_id")
    existing = await recipes_collection.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if str(existing.get("user_id")) != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    await recipes_collection.delete_one({"_id": oid})
    await ratings_collection.delete_many({"recipe_id": recipe_id})
    return {"message": "Recipe deleted successfully"}


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...), _: str = Depends(get_current_user_id)):
    content_type = file.content_type or "image/jpeg"
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    result = await images_collection.insert_one({"data": data, "content_type": content_type})
    return {"url": f"/images/{result.inserted_id}"}


@router.post("/{recipe_id}/{selected_day}/{user_id}")
async def select_recipe(recipe_id: str, selected_day: str, user_id: str, _: str = Depends(get_current_user_id)):
    try:
        recipe_obj_id = ObjectId(recipe_id)
        user_obj_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid recipe_id or user_id format")
    await mealPlans_collection.insert_one({
        "user_id": user_obj_id,
        "recipe_id": recipe_obj_id,
        "date": selected_day,
    })
    return {"message": "Recipe selected successfully"}
