import { CATEGORIES } from './categories.js';

/**
 * Turns a free-text Hebrew/English request such as
 *   "משפיענית אמא מעל 50,000 עוקבים באינסטגרם"
 * into structured search filters:
 *   { gender: 'female', category: ['parenting'], minFollowers: 50000, platform: ['instagram'] }
 * Anything not understood is returned as `q` for plain text search.
 */
export function parseQuery(text) {
  let rest = ` ${String(text ?? '').replace(/\s+/g, ' ').trim()} `;
  const filters = {};
  const take = (re) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  // ---- engagement ----
  const eng = take(/(?:אנגייג'מנט|אנגייג׳מנט|מעורבות|engagement)\s*(?:מעל|של|לפחות|מינימום|over|above|>)?\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (eng) filters.minEngagement = Number(eng[1]);
  // A bare percentage ("מעל 4%") can only mean engagement.
  const pct = !eng && take(/(?:מעל|לפחות|over|above)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (pct) filters.minEngagement = Number(pct[1]);

  // ---- follower ranges ----
  const NUM = String.raw`(\d[\d,.]*)\s*(k|K|m|M|אלף|אלפים|א'|א׳|מיליון|מליון|מיל'|מ'|מ׳)?(?![\d,.]*\s*%)`;
  const between = take(new RegExp(String.raw`בין\s*${NUM}\s*(?:ל|עד|-|–)\s*-?\s*${NUM}`));
  if (between) {
    const a = toNumber(between[1], between[2] ?? between[4]);
    const b = toNumber(between[3], between[4]);
    filters.minFollowers = Math.min(a, b);
    filters.maxFollowers = Math.max(a, b);
  }
  const over = take(new RegExp(String.raw`(?:מעל|מעל ל|יותר מ|לפחות|מינימום|החל מ|over|above|more than|at least|\+)\s*-?\s*${NUM}\s*\+?`, 'i'));
  if (over) filters.minFollowers = toNumber(over[1], over[2]);
  const under = take(new RegExp(String.raw`(?:עד|פחות מ|מתחת ל|מתחת|מקסימום|under|below|less than|up to)\s*-?\s*${NUM}`, 'i'));
  if (under) filters.maxFollowers = toNumber(under[1], under[2]);
  if (filters.minFollowers === undefined) {
    // "50K+" style
    const plus = take(new RegExp(String.raw`${NUM}\s*\+`));
    if (plus) filters.minFollowers = toNumber(plus[1], plus[2]);
  }

  // ---- tiers ----
  const tierWords = [
    [/(?:^|\s)(?:ננו|nano)(?:\s|$)/i, 'nano'],
    [/(?:^|\s)(?:מיקרו|micro)(?:\s|$)/i, 'micro'],
    [/(?:^|\s)(?:מאקרו|מקרו|macro)(?:\s|$)/i, 'macro'],
    [/(?:^|\s)(?:מגה|mega)(?:\s|$)/i, 'mega'],
  ];
  for (const [re, tier] of tierWords) {
    if (take(re)) { filters.tier = tier; break; }
  }

  // ---- platforms ----
  const platformWords = [
    ['instagram', /(?:^|\s)ו?ב?(?:אינסטגרם|אינסטה|instagram|insta|ig)(?=\s)/i],
    ['tiktok', /(?:^|\s)ו?ב?(?:טיקטוק|טיק טוק|tiktok|tik tok)(?=\s)/i],
    ['youtube', /(?:^|\s)ו?ב?(?:יוטיוב|יו טיוב|youtube|yt)(?=\s)/i],
    ['facebook', /(?:^|\s)ו?ב?(?:פייסבוק|facebook|fb)(?=\s)/i],
    ['x', /(?:^|\s)ו?ב?(?:טוויטר|twitter)(?=\s)/i],
  ];
  const platforms = [];
  for (const [id, re] of platformWords) {
    if (take(re)) platforms.push(id);
  }
  if (platforms.length) filters.platform = platforms;

  // ---- gender (before categories, since "אמא" implies both) ----
  const female = /(?:^|\s)(?:משפיענית|משפיעניות|יוצרת|יוצרות|בלוגרית|בלוגריות|אמא|אימא|אמהות|אימהות|נשים|אישה|בחורה|בחורות|female|women|woman|mom|moms|גיימרית|ספורטאית|זמרת)(?=\s)/i;
  const male = /(?:^|\s)(?:משפיען|יוצר|בלוגר|אבא|אבות|גברים|גבר|בחור|בחורים|male|men|man|dad|dads|גיימר|ספורטאי|זמר)(?=\s)/i;
  if (female.test(rest)) filters.gender = 'female';
  else if (male.test(rest)) filters.gender = 'male';

  // ---- categories ----
  const categories = [];
  const lower = rest.toLowerCase();
  for (const cat of CATEGORIES) {
    const words = [...cat.keywords, cat.label].sort((a, b) => b.length - a.length);
    for (const word of words) {
      const re = new RegExp(String.raw`(^|\s)ו?ב?ה?ל?${escapeRe(word.toLowerCase())}(?=\s)`);
      if (re.test(lower)) {
        categories.push(cat.id);
        break;
      }
    }
  }
  if (categories.length) {
    filters.category = categories;
    for (const cat of CATEGORIES.filter((c) => categories.includes(c.id))) {
      for (const word of [cat.label, ...cat.keywords].sort((a, b) => b.length - a.length)) {
        rest = rest.replace(new RegExp(String.raw`(^|\s)ו?ב?ה?ל?${escapeRe(word)}(?=\s)`, 'gi'), ' ');
      }
    }
  }

  // ---- city ----
  const city = take(/(?:^|\s)(?:מ|ב)?(תל אביב|ירושלים|חיפה|באר שבע|אשדוד|ראשון לציון|פתח תקווה|נתניה|חולון|רמת גן|הרצליה|רעננה|כפר סבא|אילת|מודיעין|רחובות|הצפון|הדרום|המרכז)(?=\s)/);
  if (city) filters.city = city[1];

  // ---- drop filler words; whatever remains is a free-text query ----
  const STOP = new Set(['משפיען', 'משפיענית', 'משפיענים', 'משפיעניות', 'יוצר', 'יוצרת', 'יוצרי', 'יוצרות', 'יוצרים', 'תוכן', 'עוקבים', 'עוקבות', 'עוקב',
    'followers', 'influencer', 'influencers', 'creator', 'creators', 'עם', 'של', 'על', 'את', 'אני', 'צריך', 'צריכה', 'מחפש', 'מחפשת', 'מחפשים', 'רוצה',
    'בלוגר', 'בלוגרית', 'בתחום', 'תחום', 'ו', 'או', 'גם', 'רק', 'כל', 'שיש', 'לה', 'לו', 'להם', 'ש', 'i', 'need', 'with', 'and', 'or', 'the', 'a', 'in', 'for',
    'female', 'male', 'women', 'men', 'נשים', 'גברים', 'אישה', 'גבר', 'בחורה', 'בחור', 'בחורות', 'בחורים', 'ישראל', 'ישראלי', 'ישראלית', 'ישראלים', 'ישראליות']);
  const leftover = rest.split(' ').map((w) => w.replace(/[.,!?״"]/g, '')).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (leftover.length) filters.q = leftover.join(' ');

  return filters;
}

function toNumber(raw, unit) {
  let n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const u = (unit ?? '').toLowerCase();
  if (['k', 'אלף', 'אלפים', "א'", 'א׳'].includes(u)) n *= 1000;
  else if (['m', 'מיליון', 'מליון', "מיל'", "מ'", 'מ׳'].includes(u)) n *= 1_000_000;
  return Math.round(n);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
