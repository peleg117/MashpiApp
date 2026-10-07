// Generates FICTIONAL demo influencers so the app can be explored without real data.
// Every generated row is flagged is_demo and shown with a "דמו" badge in the UI.
import { fileURLToPath } from 'node:url';
import { openDatabase, transaction } from './db.js';
import { InfluencerRepository } from './repository.js';

const FIRST = [
  ['נועה', 'noa', 'female'], ['מאיה', 'maya', 'female'], ['שירה', 'shira', 'female'], ['יעל', 'yael', 'female'], ['טל', 'tal', 'female'],
  ['רוני', 'roni', 'female'], ['הילה', 'hila', 'female'], ['ליאור', 'lior', 'female'], ['מיכל', 'michal', 'female'], ['עדי', 'adi', 'female'],
  ['אורטל', 'ortal', 'female'], ['דנה', 'dana', 'female'], ['קרן', 'keren', 'female'], ['אביגיל', 'avigail', 'female'], ['ליה', 'lia', 'female'],
  ['יונתן', 'yonatan', 'male'], ['איתי', 'itay', 'male'], ['עומר', 'omer', 'male'], ['דניאל', 'daniel', 'male'], ['אורי', 'ori', 'male'],
  ['נדב', 'nadav', 'male'], ['גיא', 'guy', 'male'], ['אלון', 'alon', 'male'], ['רועי', 'roy', 'male'], ['עידו', 'ido', 'male'],
];
const LAST = [['כהן', 'cohen'], ['לוי', 'levi'], ['מזרחי', 'mizrahi'], ['פרץ', 'peretz'], ['ביטון', 'biton'], ['אברהם', 'avraham'],
  ['פרידמן', 'friedman'], ['שלום', 'shalom'], ['אזולאי', 'azoulay'], ['גבאי', 'gabay'], ['דהן', 'dahan'], ['חדד', 'hadad'], ['ברק', 'barak'], ['רוזן', 'rozen']];
const CITIES = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'הרצליה', 'רעננה', 'מודיעין', 'נתניה', 'אשדוד', 'רמת גן', 'כפר סבא'];
const SUFFIX = ['', '_official', '.creates', '_tv', '.life', '_daily', 'xo', '.studio'];
const PLATFORM_WEIGHTS = [['instagram', 0.5], ['tiktok', 0.3], ['youtube', 0.2]];

const FEMALE_CATS = [['parenting', 'lifestyle'], ['fashion'], ['beauty'], ['fitness', 'health'], ['food'], ['travel', 'lifestyle'], ['home'], ['parenting', 'food'], ['beauty', 'fashion'], ['comedy'], ['music'], ['pets'], ['education'], ['finance'], ['parenting']];
const MALE_CATS = [['tech'], ['gaming'], ['fitness'], ['food'], ['comedy'], ['sports'], ['auto'], ['finance'], ['travel'], ['parenting', 'comedy'], ['music'], ['education', 'tech']];

const BIO = {
  parenting: 'אמא לשלושה, משתפת את הכאוס היומיומי של החיים עם ילדים 👶',
  fashion: 'לוקים יומיומיים, טרנדים ושופינג חכם 👗',
  beauty: 'טיפוח, איפור וביקורות מוצרים כנות 💄',
  fitness: 'אימונים ביתיים ומוטיבציה 💪',
  health: 'תזונה מאוזנת בלי דיאטות קיצוניות 🥗',
  food: 'מתכונים קלים לכל יום 🍳',
  travel: 'מטיילים בארץ ובעולם ✈️',
  tech: 'סקירות גאדג׳טים וטיפים טכנולוגיים 📱',
  gaming: 'סטרימים, משחקים וקהילה 🎮',
  lifestyle: 'החיים הקטנים והיפים ✨',
  comedy: 'סקיצות ומערכונים קצרים 😂',
  music: 'קאברים ושירים מקוריים 🎶',
  sports: 'הכל על ספורט ישראלי ⚽',
  home: 'עיצוב בית בתקציב נמוך 🏡',
  education: 'מדע ועובדות מעניינות בשפה פשוטה 🔬',
  finance: 'כסף, חיסכון והשקעות למתחילים 💰',
  auto: 'מבחני דרכים וחדשות רכב 🚗',
  pets: 'החיים עם כלבים וחתולים 🐾',
};

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoInfluencers(count = 150, seed = 2026) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const used = new Set();
  const out = [];
  while (out.length < count) {
    const [firstHe, firstEn, gender] = pick(FIRST);
    const [lastHe, lastEn] = pick(LAST);
    let platform = 'instagram';
    let r = rnd();
    for (const [p, w] of PLATFORM_WEIGHTS) { if ((r -= w) <= 0) { platform = p; break; } }
    const handle = `demo.${firstEn}.${lastEn}${pick(SUFFIX)}`.toLowerCase();
    if (used.has(`${platform}:${handle}`)) continue;
    used.add(`${platform}:${handle}`);

    // Log-uniform follower distribution: 3K .. 2.5M
    const followers = Math.round(Math.exp(Math.log(3000) + rnd() * (Math.log(2_500_000) - Math.log(3000))));
    const categories = pick(gender === 'female' ? FEMALE_CATS : MALE_CATS);
    // Smaller accounts typically engage better.
    const engagement = Math.round((Math.max(0.4, 9 - Math.log10(followers) * 1.3) * (0.6 + rnd() * 0.8)) * 100) / 100;
    out.push({
      name: `${firstHe} ${lastHe}`,
      handle,
      platform,
      followers,
      engagement_rate: engagement,
      avg_views: Math.round(followers * (platform === 'tiktok' ? 0.8 + rnd() : 0.08 + rnd() * 0.25)),
      posts_count: Math.round(80 + rnd() * 1500),
      gender,
      city: pick(CITIES),
      language: 'he',
      bio: BIO[categories[0]],
      contact_email: `${firstEn}.${lastEn}@example.com`,
      categories,
      growthPerDay: (rnd() * 0.6 - 0.1) / 100,
    });
  }
  return out;
}

export function seedDemoData(repo, db, { count = 150, days = 60 } = {}) {
  const people = generateDemoInfluencers(count);
  transaction(db, () => {
    const history = db.prepare('INSERT INTO follower_history (influencer_id, recorded_at, followers, engagement_rate) VALUES (?, ?, ?, ?)');
    for (const p of people) {
      const { growthPerDay, ...data } = p;
      const start = Math.round(p.followers / (1 + growthPerDay) ** days);
      const created = repo.create({ ...data, recorded_at: new Date(Date.now() - days * 86400000).toISOString(), followers: start }, { isDemo: true });
      // Backfill a daily history curve ending at today's follower count.
      for (let d = days - 1; d >= 1; d--) {
        // Trend plus a little day-to-day noise so curves look like real accounts.
        const f = Math.round((p.followers / (1 + growthPerDay) ** d) * (1 + (Math.random() - 0.5) * 0.006));
        history.run(created.id, new Date(Date.now() - d * 86400000).toISOString(), f, p.engagement_rate);
      }
      db.prepare('UPDATE influencers SET followers = ? WHERE id = ?').run(p.followers, created.id);
      history.run(created.id, new Date().toISOString(), p.followers, p.engagement_rate);
    }
  });
  return people.length;
}

// CLI: npm run seed  (wipes existing demo rows and re-generates them)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDatabase();
  if (process.argv.includes('--reset')) db.exec('DELETE FROM influencers WHERE is_demo = 1');
  const n = seedDemoData(new InfluencerRepository(db), db);
  console.log(`נוצרו ${n} משפיענים לדוגמה`);
}
