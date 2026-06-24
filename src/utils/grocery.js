import { apiFetch } from '../api';

// Shared between the grocery list page's "Import from meal plan" flow and
// the single-recipe "Add to grocery list" action, so pantry state and aisle
// categorization stay consistent no matter where an item gets added from.

// ── Pantry (localStorage) ─────────────────────────────────────────────────────
const PANTRY_KEY = 'mise_pantry';
const DEFAULT_PANTRY = [
  'salt','pepper','black pepper','olive oil','vegetable oil','canola oil',
  'sugar','brown sugar','flour','all purpose flour','bread flour',
  'baking powder','baking soda','butter','water','garlic','onion',
  'vanilla extract','cooking spray',
];
export function pantryGet() {
  try {
    const raw = localStorage.getItem(PANTRY_KEY);
    return raw ? JSON.parse(raw) : [...DEFAULT_PANTRY];
  } catch { return [...DEFAULT_PANTRY]; }
}
export function pantrySave(items) {
  try { localStorage.setItem(PANTRY_KEY, JSON.stringify(items)); } catch {}
}
// Strip leading prep adjectives so "fresh garlic" → "garlic", "unsalted butter" → "butter"
export const PREP_PREFIX_RE = /^(fresh|dried|dry|ground|minced|chopped|diced|sliced|crushed|whole|raw|cooked|roasted|toasted|peeled|grated|shredded|cubed|halved|unsalted|salted|organic|extra[\s-]virgin|light|dark|pure|large|medium|small|ripe|firm|hot|mild|sweet|frozen|canned|low[\s-]sodium|reduced[\s-]fat)\s+/i;

export function pantryMatches(name, pantry) {
  const lower = name.toLowerCase().trim();
  const stripped = lower.replace(PREP_PREFIX_RE, '').trim();
  return pantry.some(p => {
    // Exact match on the raw or adjective-stripped name, with optional trailing 's'
    return lower === p || stripped === p ||
      lower === p + 's' || stripped === p + 's' ||
      (p.endsWith('s') && (lower === p.slice(0, -1) || stripped === p.slice(0, -1)));
  });
}

// ── Store sections in aisle order ────────────────────────────────────
export const SECTIONS = [
  { key: 'produce',    label: 'Produce',             icon: '🥦', keywords: ['apple','banana','orange','lemon','lime','lettuce','spinach','kale','arugula','spring mix','onion','shallot','scallion','green onion','garlic clove','garlic cloves','carrot','celery','cucumber','zucchini','bell pepper','chile pepper','jalapeño','jalapeno','habanero','serrano','chili pepper','poblano','potato','sweet potato','yam','broccoli','cauliflower','mushroom','shiitake','cremini','portobello','avocado','corn','peas','green bean','green beans','ginger','cilantro','parsley','basil','thyme','rosemary','mint','dill','chives','leek','fennel','radish','beet','butternut squash','acorn squash','spaghetti squash','summer squash','pumpkin','eggplant','asparagus','artichoke','cabbage','bok choy','brussels sprout','mango','pineapple','strawberry','blueberry','raspberry','blackberry','grapes','cherry','peach','plum','pear','watermelon','cantaloupe','melon','honeydew','fig','dates','pomegranate','lemongrass','turmeric root','fresh herb','micro greens','endive','watercress','radicchio','snap peas','snow peas','sugar snap peas','butterhead','romaine','iceberg','turnip','parsnip','rutabaga'] },
  { key: 'meat',       label: 'Meat & Seafood',      icon: '🥩', keywords: ['chicken breast','chicken thigh','chicken thighs','chicken drumstick','chicken wing','whole chicken','ground chicken','ground beef','ground pork','ground turkey','ground lamb','chicken','beef','pork','lamb','turkey','duck','veal','bison','venison','bacon','pancetta','prosciutto','sausage','italian sausage','chorizo','andouille','bratwurst','pepperoni','salami','ham','lunchmeat','deli meat','steak','ribeye','sirloin','filet mignon','brisket','short rib','pork chop','pork loin','pork belly','pork shoulder','baby back ribs','spare ribs','tenderloin','salmon','tuna','shrimp','prawns','cod','tilapia','halibut','mahi','sea bass','snapper','trout','catfish','crab','lobster','scallop','anchovy','anchovies','sardine','clam','mussel','oyster','squid','octopus','langostino','imitation crab','surimi'] },
  { key: 'dairy',      label: 'Dairy & Eggs',        icon: '🥛', keywords: ['whole milk','skim milk','2% milk','oat milk','almond milk','soy milk','coconut milk beverage','heavy cream','heavy whipping cream','half and half','half & half','whipping cream','light cream','sour cream','crème fraîche','cream fraiche','buttermilk','milk','butter','ghee','clarified butter','parmesan','parmigiano','mozzarella','cheddar','feta','ricotta','brie','gouda','gruyere','gruyère','swiss cheese','provolone','cream cheese','cottage cheese','mascarpone','burrata','havarti','manchego','asiago','pecorino','monterey jack','colby','blue cheese','gorgonzola','bocconcini','queso fresco','queso','cheese','yogurt','greek yogurt','skyr','eggs','egg','kefir','whipped cream','dulce de leche'] },
  { key: 'deli',       label: 'Deli',                icon: '🫕', keywords: ['deli','rotisserie chicken','hummus','tzatziki','guacamole','smoked salmon','lox','nova lox','pastrami','corned beef','roast beef'] },
  { key: 'bakery',     label: 'Bakery & Bread',      icon: '🍞', keywords: ['sourdough','baguette','dinner roll','kaiser roll','bagel','pita','pita bread','flour tortilla','corn tortilla','tortilla','naan','croissant','english muffin','brioche','ciabatta','focaccia','rye bread','pumpernickel','whole wheat bread','white bread','hamburger bun','hot dog bun','slider bun','sub roll','hoagie roll','flatbread','lavash','matzo','bread','pie crust','pie shell','pastry dough','puff pastry','danish','scone','biscuit','cake layer','cornbread'] },
  { key: 'frozen',     label: 'Frozen',              icon: '🧊', keywords: ['frozen peas','frozen corn','frozen edamame','frozen spinach','frozen broccoli','frozen mixed vegetables','frozen berries','frozen mango','frozen fruit','frozen vegetables','edamame','ice cream','gelato','sorbet','frozen pizza','frozen waffle','tater tots','french fries','frozen','ice cubes'] },
  { key: 'canned',     label: 'Canned & Jarred',     icon: '🥫', keywords: ['tomato paste','crushed tomatoes','diced tomatoes','fire roasted tomatoes','whole peeled tomatoes','stewed tomatoes','tomato sauce','tomato puree','tomato soup','chicken broth','beef broth','vegetable broth','chicken stock','beef stock','vegetable stock','bone broth','stock cubes','bouillon','coconut milk','coconut cream','black beans','kidney beans','chickpeas','garbanzo beans','lentils','pinto beans','white beans','cannellini beans','navy beans','great northern beans','refried beans','baked beans','green lentils','red lentils','canned tuna','canned salmon','canned chicken','canned corn','canned green beans','canned artichoke','canned olives','artichoke hearts','roasted red peppers','capers','pumpkin puree','sweet potato puree','evaporated milk','sweetened condensed milk','condensed milk','pickles','dill pickles','bread and butter pickles','giardiniera','jam','jelly','fruit preserves','marmalade','salsa','enchilada sauce','green chile','chipotle in adobo','miso paste','curry paste','red curry paste','green curry paste','tahini','peanut butter','almond butter','nut butter','sun dried tomatoes','olive tapenade','harissa','gochujang','sambal','soup'] },
  { key: 'dry_goods',  label: 'Dry Goods & Pasta',   icon: '🌾', keywords: ['spaghetti','penne','rigatoni','fettuccine','linguine','lasagna noodles','lasagna','orzo','farfalle','fusilli','rotini','bucatini','tagliatelle','pappardelle','angel hair','ditalini','macaroni','egg noodles','pasta','white rice','brown rice','jasmine rice','basmati rice','arborio rice','sushi rice','long grain rice','short grain rice','rice','quinoa','couscous','farro','barley','bulgur','wheat berries','freekeh','rolled oats','steel cut oats','quick oats','oats','polenta','grits','cornmeal','all purpose flour','bread flour','whole wheat flour','self rising flour','cake flour','almond flour','oat flour','tapioca flour','coconut flour','flour','breadcrumbs','panko','ramen noodles','udon noodles','soba noodles','rice noodles','glass noodles','vermicelli','cellophane noodles','noodles','cereal','granola','muesli','crackers','saltines','graham crackers','tortilla chips','pita chips','potato chips','popcorn','pretzels','walnuts','pecans','peanuts','cashews','pistachios','pine nuts','almonds','hazelnuts','macadamia','brazil nuts','mixed nuts','sunflower seeds','pumpkin seeds','sesame seeds','hemp seeds','chia seeds','flaxseed','poppy seeds','raisins','dried cranberries','dried apricots','dried mango','dried cherries','prunes','medjool dates','dried fruit','green lentils dried','red lentils dried','split peas','dried chickpeas','dried beans','lentils'] },
  { key: 'condiments', label: 'Condiments & Sauces', icon: '🧴', keywords: ['ketchup','yellow mustard','dijon mustard','whole grain mustard','mustard','mayo','mayonnaise','aioli','hot sauce','sriracha','tabasco','crystal hot sauce','worcestershire sauce','worcestershire','soy sauce','tamari','coconut aminos','fish sauce','oyster sauce','hoisin sauce','teriyaki sauce','sweet chili sauce','ponzu','bbq sauce','buffalo sauce','ranch dressing','caesar dressing','italian dressing','balsamic vinegar','balsamic glaze','red wine vinegar','white wine vinegar','apple cider vinegar','rice vinegar','sherry vinegar','champagne vinegar','white vinegar','vinegar','extra virgin olive oil','olive oil','vegetable oil','canola oil','coconut oil','sesame oil','avocado oil','truffle oil','grapeseed oil','peanut oil','cooking spray','lemon juice','lime juice','orange juice concentrate'] },
  { key: 'spices',     label: 'Spices & Baking',     icon: '🧂', keywords: ['kosher salt','sea salt','pink salt','black pepper','white pepper','red pepper flakes','crushed red pepper','cayenne pepper','cayenne','cumin','smoked paprika','sweet paprika','paprika','turmeric','cinnamon','chili powder','ancho chili','chipotle powder','oregano','dried thyme','dried rosemary','dried basil','dried oregano','bay leaves','bay leaf','nutmeg','whole cloves','ground cloves','cardamom','ground coriander','coriander','fennel seeds','mustard seeds','celery seeds','caraway seeds','anise seeds','za\'atar','ras el hanout','five spice','allspice','juniper berries','saffron','curry powder','garam masala','tikka masala','berbere','sumac','dried chili','italian seasoning','herbs de provence','old bay','cajun seasoning','taco seasoning','everything bagel','garlic powder','onion powder','garlic salt','onion salt','salt','pepper','powdered sugar','confectioners sugar','brown sugar','white sugar','raw sugar','coconut sugar','maple syrup','honey','agave','corn syrup','molasses','sugar','vanilla extract','almond extract','pure vanilla','baking powder','baking soda','active dry yeast','instant yeast','cornstarch','arrowroot','tapioca starch','cocoa powder','dutch process cocoa','chocolate chips','dark chocolate','milk chocolate','white chocolate','semi sweet chocolate','unsweetened chocolate','food coloring','cream of tartar','gelatin','agar'] },
  { key: 'beverages',  label: 'Beverages',           icon: '🥤', keywords: ['sparkling water','club soda','tonic water','soda water','orange juice','apple juice','cranberry juice','grape juice','pineapple juice','grapefruit juice','tomato juice','vegetable juice','lemonade','limeade','iced tea','sweet tea','kombucha','cold brew','espresso','coffee','tea bags','herbal tea','green tea','black tea','chai','red wine','white wine','rosé','sparkling wine','prosecco','champagne','beer','lager','ale','stout','vodka','gin','whiskey','bourbon','rum','tequila','mezcal','brandy','triple sec','kahlua','baileys','wine','juice','water'] },
  { key: 'household',  label: 'Household',           icon: '🧹', keywords: ['paper towels','toilet paper','dish soap','laundry detergent','dishwasher pods','sponge','trash bags','zip lock bags','plastic wrap','aluminum foil','parchment paper','wax paper','coffee filters','toothpaste','shampoo','conditioner','body wash','hand soap','cleaning spray','bleach','all purpose cleaner','baking sheets','plastic bags'] },
  { key: 'other',      label: 'Other',               icon: '🛒', keywords: [] },
];

export const SECTION_MAP = Object.fromEntries(SECTIONS.map(s => [s.key, s]));

export function categorize(name) {
  const lower = name.toLowerCase();
  let bestSection = 'other';
  let bestLen = 0;
  for (const section of SECTIONS) {
    if (section.key === 'other') continue;
    for (const k of section.keywords) {
      // Require word-boundary match so "oil" doesn't match "foil"
      const re = new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\s|$|,)`);
      if (re.test(lower) && k.length > bestLen) {
        bestLen = k.length;
        bestSection = section.key;
      }
    }
  }
  return bestSection;
}

// ── Per-user category overrides (localStorage) ───────────────────────────────
export function getCatOverrides(uid) {
  try { return JSON.parse(localStorage.getItem(`mise_cat_${uid}`) || '{}'); } catch { return {}; }
}
export function saveCatOverride(uid, name, cat) {
  const obj = getCatOverrides(uid);
  obj[name.toLowerCase().trim()] = cat;
  localStorage.setItem(`mise_cat_${uid}`, JSON.stringify(obj));
  return obj;
}
export function effectiveCategory(name, category, overrides) {
  return overrides[(name || '').toLowerCase().trim()] || category || categorize(name);
}

// ── Grocery list lookup/creation (the "every consumer needs a list id" dance) ─
export async function ensureGroceryList(uid) {
  const res = await apiFetch(`/groceryList/userID/${uid}`);
  if (res.ok) {
    const data = await res.json();
    if (data.length > 0) return data[0];
  }
  const cr = await apiFetch('/groceryList/', {
    method: 'POST',
    body: JSON.stringify({ name: 'My List', user_id: uid, items: [] }),
  });
  if (cr.ok) {
    const res2 = await apiFetch(`/groceryList/userID/${uid}`);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.length > 0) return data2[0];
    }
  }
  throw new Error('Could not get or create grocery list');
}
