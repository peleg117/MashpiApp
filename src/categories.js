// Categories with Hebrew labels and the keywords the smart search recognises.
export const CATEGORIES = [
  { id: 'parenting', label: 'אמהות והורות', keywords: ['אמא', 'אמהות', 'אימא', 'אימהות', 'אבא', 'אבהות', 'הורות', 'הורים', 'ילדים', 'תינוקות', 'הריון', 'mom', 'mother', 'parenting', 'dad'] },
  { id: 'fashion', label: 'אופנה', keywords: ['אופנה', 'סטייל', 'בגדים', 'לוקים', 'fashion', 'style'] },
  { id: 'beauty', label: 'ביוטי וטיפוח', keywords: ['ביוטי', 'איפור', 'טיפוח', 'קוסמטיקה', 'beauty', 'makeup', 'skincare'] },
  { id: 'fitness', label: 'כושר', keywords: ['כושר', 'אימונים', 'אימון', 'חדר כושר', 'פילאטיס', 'יוגה', 'fitness', 'gym', 'workout'] },
  { id: 'health', label: 'בריאות ותזונה', keywords: ['בריאות', 'תזונה', 'דיאטה', 'טבעוני', 'טבעונות', 'health', 'nutrition', 'vegan'] },
  { id: 'food', label: 'אוכל ובישול', keywords: ['אוכל', 'בישול', 'מתכונים', 'אפייה', 'שף', 'מסעדות', 'קולינריה', 'food', 'cooking', 'recipes', 'foodie'] },
  { id: 'travel', label: 'טיולים ותיירות', keywords: ['טיולים', 'טיול', 'תיירות', 'חופשות', 'נסיעות', 'travel'] },
  { id: 'tech', label: 'טכנולוגיה', keywords: ['טכנולוגיה', 'טק', 'גאדג\'טים', 'גאדג׳טים', 'סמארטפונים', 'tech', 'technology', 'gadgets'] },
  { id: 'gaming', label: 'גיימינג', keywords: ['גיימינג', 'גיימר', 'גיימרית', 'משחקים', 'gaming', 'gamer'] },
  { id: 'lifestyle', label: 'לייפסטייל', keywords: ['לייפסטייל', 'lifestyle', 'וולוג', 'vlog'] },
  { id: 'comedy', label: 'הומור ובידור', keywords: ['הומור', 'קומדיה', 'מצחיק', 'סטנדאפ', 'בידור', 'comedy', 'funny'] },
  { id: 'music', label: 'מוזיקה', keywords: ['מוזיקה', 'זמר', 'זמרת', 'מוזיקאי', 'music', 'singer'] },
  { id: 'sports', label: 'ספורט', keywords: ['ספורט', 'כדורגל', 'כדורסל', 'ספורטאי', 'ספורטאית', 'sports', 'football'] },
  { id: 'home', label: 'עיצוב ובית', keywords: ['עיצוב', 'עיצוב פנים', 'בית', 'דקור', 'שיפוצים', 'home', 'decor', 'interior'] },
  { id: 'education', label: 'חינוך והעשרה', keywords: ['חינוך', 'לימודים', 'העשרה', 'מדע', 'education', 'science'] },
  { id: 'finance', label: 'כסף ופיננסים', keywords: ['פיננסים', 'כלכלה', 'השקעות', 'כסף', 'נדל"ן', 'finance', 'investing'] },
  { id: 'auto', label: 'רכב', keywords: ['רכב', 'רכבים', 'מכוניות', 'אופנועים', 'cars', 'auto'] },
  { id: 'pets', label: 'חיות מחמד', keywords: ['חיות', 'חיות מחמד', 'כלבים', 'חתולים', 'pets', 'dogs', 'cats'] },
];

export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export const TIERS = [
  { id: 'nano', label: 'ננו (עד 10K)', min: 0, max: 9999 },
  { id: 'micro', label: 'מיקרו (10K–100K)', min: 10000, max: 99999 },
  { id: 'macro', label: 'מאקרו (100K–1M)', min: 100000, max: 999999 },
  { id: 'mega', label: 'מגה (1M+)', min: 1000000, max: null },
];

export function tierFor(followers) {
  return TIERS.find((t) => followers >= t.min && (t.max === null || followers <= t.max))?.id ?? 'nano';
}

export function normalizeCategories(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[,;|]/);
  const out = new Set();
  for (const raw of list) {
    const value = String(raw).trim().toLowerCase();
    if (!value) continue;
    if (CATEGORY_IDS.has(value)) {
      out.add(value);
      continue;
    }
    const match = CATEGORIES.find((c) => c.label === value || c.keywords.includes(value));
    if (match) out.add(match.id);
  }
  return [...out];
}
