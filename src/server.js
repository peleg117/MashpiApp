import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { InfluencerRepository, ValidationError } from './repository.js';
import { CATEGORIES, TIERS } from './categories.js';
import { PLATFORMS, parseProfileUrl } from './platforms.js';
import { parseQuery } from './queryParser.js';
import { createProviders, NotFoundError } from './providers/index.js';
import { EventHub } from './events.js';
import { SyncService } from './sync.js';
import { parseCsv, toCsv, mapImportRow } from './csv.js';
import { seedDemoData } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv(path.join(__dirname, '..', '.env'));

export function createApp({ db, providers, events = new EventHub(), adminToken = process.env.ADMIN_TOKEN, syncOptions = {} }) {
  const repo = new InfluencerRepository(db);
  const sync = new SyncService({ repo, providers, events, ...syncOptions });
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const requireAdmin = (req, res, next) => {
    if (!adminToken) return next();
    const header = req.get('authorization') ?? '';
    if (header === `Bearer ${adminToken}`) return next();
    res.status(401).json({ error: 'נדרשת הרשאת מנהל' });
  };

  const id = (req) => Number(req.params.id);

  app.get('/api/meta', (_req, res) => {
    res.json({
      categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
      platforms: PLATFORMS,
      tiers: TIERS,
      sync: sync.status(),
      adminRequired: Boolean(adminToken),
    });
  });

  app.get('/api/stats', (_req, res) => res.json({ ...repo.stats(), liveClients: events.size, sync: sync.status() }));

  app.get('/api/parse', (req, res) => res.json(parseQuery(req.query.text ?? '')));

  app.get('/api/influencers', (req, res) => {
    const filters = { ...req.query };
    // `smart` = free-text request, parsed into filters; explicit query params win.
    if (req.query.smart) Object.assign(filters, { ...parseQuery(req.query.smart), ...stripEmpty(req.query) });
    res.json({ ...repo.search(filters), applied: filters });
  });

  app.get('/api/influencers/export.csv', (req, res) => {
    const filters = { ...req.query, page: 1, pageSize: 500 };
    if (req.query.smart) Object.assign(filters, { ...parseQuery(req.query.smart), ...stripEmpty(req.query), page: 1, pageSize: 500 });
    const labels = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
    const items = [];
    for (let page = 1; ; page++) {
      const result = repo.search({ ...filters, page });
      items.push(...result.items);
      if (items.length >= result.total || !result.items.length) break;
    }
    const csv = toCsv(items, [
      { label: 'שם', value: (r) => r.name },
      { label: 'שם משתמש', value: (r) => r.handle },
      { label: 'פלטפורמה', value: (r) => r.platform },
      { label: 'לינק לפרופיל', value: (r) => r.profile_url },
      { label: 'עוקבים', value: (r) => r.followers },
      { label: 'מעורבות %', value: (r) => r.engagement_rate },
      { label: 'צפיות ממוצעות', value: (r) => r.avg_views },
      { label: 'קטגוריות', value: (r) => r.categories.map((c) => labels[c] ?? c) },
      { label: 'מגדר', value: (r) => ({ female: 'אישה', male: 'גבר' })[r.gender] ?? '' },
      { label: 'עיר', value: (r) => r.city },
      { label: 'אימייל', value: (r) => r.contact_email },
      { label: 'טלפון', value: (r) => r.contact_phone },
      { label: 'צמיחה 30 יום %', value: (r) => r.growth_30d },
      { label: 'עודכן לאחרונה', value: (r) => r.last_synced_at ?? r.updated_at },
    ]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="influencers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  app.get('/api/influencers/:id', (req, res) => {
    const influencer = repo.get(id(req));
    if (!influencer) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ ...influencer, history: repo.history(influencer.id, Number(req.query.days) || 90) });
  });

  app.post('/api/influencers', requireAdmin, async (req, res, next) => {
    try {
      const body = { ...req.body };
      if (body.profile_url && (!body.handle || !body.platform)) {
        const parsed = parseProfileUrl(body.profile_url);
        if (!parsed) return res.status(400).json({ error: 'לא הצלחנו לזהות את הלינק לפרופיל' });
        body.handle ??= parsed.handle;
        body.platform ??= parsed.platform;
      }
      if (body.handle && body.platform && repo.findByHandle(body.platform, body.handle)) {
        return res.status(409).json({ error: 'המשפיען כבר קיים במאגר' });
      }
      let influencer = repo.create(body);
      events.publish('influencer.created', influencer);
      // Pull live numbers right away when a data source is configured.
      if (sync.providerFor(influencer)) {
        await sync.refresh(influencer.id);
        influencer = repo.get(influencer.id);
      }
      res.status(201).json(influencer);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/influencers/:id', requireAdmin, (req, res, next) => {
    try {
      const influencer = repo.update(id(req), req.body);
      if (!influencer) return res.status(404).json({ error: 'לא נמצא' });
      events.publish('influencer.updated', influencer);
      res.json(influencer);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/influencers/:id', requireAdmin, (req, res) => {
    if (!repo.delete(id(req))) return res.status(404).json({ error: 'לא נמצא' });
    events.publish('influencer.deleted', { id: id(req) });
    res.status(204).end();
  });

  app.post('/api/influencers/:id/refresh', requireAdmin, async (req, res, next) => {
    try {
      if (!repo.get(id(req))) return res.status(404).json({ error: 'לא נמצא' });
      await sync.refresh(id(req));
      res.json(repo.get(id(req)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/import', requireAdmin, (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (!text) return res.status(400).json({ error: 'לא התקבל קובץ CSV' });
    const result = { created: 0, updated: 0, errors: [] };
    parseCsv(text).forEach((raw, n) => {
      try {
        const row = mapImportRow(raw);
        if (row.profile_url && (!row.handle || !row.platform)) {
          const parsed = parseProfileUrl(row.profile_url);
          if (parsed) { row.handle ??= parsed.handle; row.platform ??= parsed.platform; }
        }
        const existing = row.platform && row.handle ? repo.findByHandle(row.platform, row.handle) : null;
        if (existing) {
          repo.update(existing.id, row);
          result.updated++;
        } else {
          repo.create(row);
          result.created++;
        }
      } catch (err) {
        result.errors.push({ row: n + 2, error: err.message });
      }
    });
    events.publish('bulk', { ...result, stats: repo.stats() });
    res.json(result);
  });

  app.get('/api/events', (req, res) => events.connect(req, res));

  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError || err instanceof NotFoundError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  });

  return { app, repo, sync, events };
}

function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => k !== 'smart' && v !== '' && v !== undefined));
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDatabase();
  const providers = createProviders();
  const { app, repo, sync } = createApp({
    db,
    providers,
    syncOptions: {
      intervalSeconds: Number(process.env.SYNC_INTERVAL_SECONDS) || 60,
      batchSize: Number(process.env.SYNC_BATCH_SIZE) || 10,
      staleMinutes: Number(process.env.SYNC_STALE_MINUTES) || 360,
    },
  });
  if (repo.count() === 0 && process.env.SEED_DEMO_DATA !== 'false') {
    console.log(`מאגר ריק — נוצרו ${seedDemoData(repo, db)} משפיענים לדוגמה (דמו)`);
  }
  sync.start();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    const live = Object.keys(providers.byPlatform);
    console.log(`MashpiApp פועל: http://localhost:${port}`);
    console.log(live.length ? `מקורות נתונים חיים: ${live.join(', ')}` : 'לא הוגדרו מפתחות API — עדכונים חיים פועלים על נתוני הדמו בלבד');
  });
}
