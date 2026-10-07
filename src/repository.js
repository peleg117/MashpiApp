import { transaction } from './db.js';
import { normalizeCategories, tierFor, TIERS } from './categories.js';
import { buildProfileUrl, PLATFORM_IDS } from './platforms.js';

const SORTS = {
  followers: 'i.followers',
  engagement: 'i.engagement_rate',
  name: 'i.name COLLATE NOCASE',
  updated: 'COALESCE(i.last_synced_at, i.updated_at)',
  growth: 'growth_30d',
};

const EDITABLE = ['name', 'handle', 'platform', 'profile_url', 'followers', 'engagement_rate', 'avg_views', 'posts_count',
  'gender', 'city', 'language', 'bio', 'avatar_url', 'contact_email', 'contact_phone', 'notes'];

const now = () => new Date().toISOString();

function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloat(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

export class ValidationError extends Error {}

export class InfluencerRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Search with structured filters. All filters are optional.
   * { q, platform[], category[], gender, minFollowers, maxFollowers, tier, minEngagement, city, sort, order, page, pageSize }
   */
  search(filters = {}) {
    const where = [];
    const params = {};

    if (filters.q) {
      where.push('(i.name LIKE $q OR i.handle LIKE $q OR i.bio LIKE $q OR i.city LIKE $q OR i.notes LIKE $q)');
      params.q = `%${filters.q.trim()}%`;
    }
    const platforms = asList(filters.platform).filter((p) => PLATFORM_IDS.has(p));
    if (platforms.length) {
      where.push(`i.platform IN (${platforms.map((_, n) => `$p${n}`).join(',')})`);
      platforms.forEach((p, n) => { params[`p${n}`] = p; });
    }
    const categories = normalizeCategories(asList(filters.category));
    if (categories.length) {
      // Match influencers having ANY of the selected categories.
      where.push(`i.id IN (SELECT influencer_id FROM influencer_categories WHERE category IN (${categories.map((_, n) => `$c${n}`).join(',')}))`);
      categories.forEach((c, n) => { params[`c${n}`] = c; });
    }
    if (filters.gender === 'female' || filters.gender === 'male') {
      where.push('i.gender = $gender');
      params.gender = filters.gender;
    }
    let minFollowers = toInt(filters.minFollowers);
    let maxFollowers = toInt(filters.maxFollowers);
    const tier = TIERS.find((t) => t.id === filters.tier);
    if (tier) {
      minFollowers = Math.max(minFollowers ?? 0, tier.min);
      if (tier.max !== null) maxFollowers = maxFollowers === null ? tier.max : Math.min(maxFollowers, tier.max);
    }
    if (minFollowers !== null) { where.push('i.followers >= $minF'); params.minF = minFollowers; }
    if (maxFollowers !== null) { where.push('i.followers <= $maxF'); params.maxF = maxFollowers; }
    const minEng = toFloat(filters.minEngagement);
    if (minEng !== null) { where.push('i.engagement_rate >= $minEng'); params.minEng = minEng; }
    if (filters.city) { where.push('i.city LIKE $city'); params.city = `%${filters.city.trim()}%`; }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortCol = SORTS[filters.sort] ?? SORTS.followers;
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    const pageSize = Math.min(Math.max(toInt(filters.pageSize) ?? 25, 1), 500);
    const page = Math.max(toInt(filters.page) ?? 1, 1);

    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM influencers i ${whereSql}`).get(params).n;
    const rows = this.db.prepare(`
      SELECT i.*, ${GROWTH_SQL} AS growth_30d
      FROM influencers i
      ${whereSql}
      ORDER BY ${sortCol} ${order} NULLS LAST, i.id ASC
      LIMIT $limit OFFSET $offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    return { total, page, pageSize, items: this.#hydrate(rows) };
  }

  get(id) {
    const row = this.db.prepare(`SELECT i.*, ${GROWTH_SQL} AS growth_30d FROM influencers i WHERE i.id = ?`).get(id);
    return row ? this.#hydrate([row])[0] : null;
  }

  findByHandle(platform, handle) {
    const row = this.db.prepare('SELECT id FROM influencers WHERE platform = ? AND handle = ? COLLATE NOCASE').get(platform, cleanHandle(handle));
    return row ? this.get(row.id) : null;
  }

  history(id, days = 90) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return this.db.prepare(`
      SELECT recorded_at, followers, engagement_rate FROM follower_history
      WHERE influencer_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC
    `).all(id, since).map((r) => ({ ...r }));
  }

  create(input, { isDemo = false } = {}) {
    const data = this.#validate(input, { partial: false });
    return transaction(this.db, () => {
      const cols = Object.keys(data);
      const stmt = this.db.prepare(`
        INSERT INTO influencers (${cols.join(',')}, is_demo, sync_status)
        VALUES (${cols.map((c) => `$${c}`).join(',')}, $is_demo, $sync_status)
      `);
      const { lastInsertRowid } = stmt.run({ ...data, is_demo: isDemo ? 1 : 0, sync_status: 'pending' });
      const id = Number(lastInsertRowid);
      this.#setCategories(id, input.categories);
      this.#recordHistory(id, data.followers ?? 0, data.engagement_rate ?? null, input.recorded_at);
      return this.get(id);
    });
  }

  update(id, input) {
    const existing = this.get(id);
    if (!existing) return null;
    const data = this.#validate({ ...input, platform: input.platform ?? existing.platform }, { partial: true });
    return transaction(this.db, () => {
      const cols = Object.keys(data);
      if (cols.length) {
        this.db.prepare(`UPDATE influencers SET ${cols.map((c) => `${c} = $${c}`).join(', ')}, updated_at = $now WHERE id = $id`)
          .run({ ...data, now: now(), id });
      }
      if (input.categories !== undefined) this.#setCategories(id, input.categories);
      if (data.followers !== undefined && data.followers !== existing.followers) {
        this.#recordHistory(id, data.followers, data.engagement_rate ?? existing.engagement_rate);
      }
      return this.get(id);
    });
  }

  delete(id) {
    return this.db.prepare('DELETE FROM influencers WHERE id = ?').run(id).changes > 0;
  }

  /** Apply fresh metrics from a data provider. Returns { influencer, changed }. */
  applySync(id, metrics) {
    const existing = this.get(id);
    if (!existing) return { influencer: null, changed: false };
    const fields = {};
    for (const key of ['followers', 'engagement_rate', 'avg_views', 'posts_count', 'avatar_url', 'bio', 'name']) {
      if (metrics[key] !== undefined && metrics[key] !== null && metrics[key] !== existing[key]) fields[key] = metrics[key];
    }
    const changed = Object.keys(fields).length > 0;
    return transaction(this.db, () => {
      const ts = now();
      const sets = Object.keys(fields).map((c) => `${c} = $${c}`);
      this.db.prepare(`
        UPDATE influencers SET ${[...sets, "sync_status = 'ok'", 'sync_error = NULL', 'last_synced_at = $ts', 'checked_at = $ts', ...(changed ? ['updated_at = $ts'] : [])].join(', ')}
        WHERE id = $id
      `).run({ ...fields, ts, id });
      if (fields.followers !== undefined || fields.engagement_rate !== undefined) {
        this.#recordHistory(id, fields.followers ?? existing.followers, fields.engagement_rate ?? existing.engagement_rate, ts);
      }
      return { influencer: this.get(id), changed };
    });
  }

  markSyncFailed(id, status, message) {
    this.db.prepare('UPDATE influencers SET sync_status = ?, sync_error = ?, checked_at = ? WHERE id = ?')
      .run(status, message ?? null, now(), id);
  }

  /** Profiles whose data is older than `staleMinutes`, oldest first. */
  staleBatch(limit, staleMinutes) {
    const cutoff = new Date(Date.now() - staleMinutes * 60000).toISOString();
    return this.db.prepare(`
      SELECT id, platform, handle, is_demo FROM influencers
      WHERE checked_at IS NULL OR checked_at < ?
      ORDER BY checked_at ASC NULLS FIRST LIMIT ?
    `).all(cutoff, limit).map((r) => ({ ...r }));
  }

  stats() {
    const totals = this.db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(followers),0) AS reach, MAX(last_synced_at) AS last_sync,
             SUM(CASE WHEN last_synced_at >= ? THEN 1 ELSE 0 END) AS synced_24h
      FROM influencers
    `).get(new Date(Date.now() - 86400000).toISOString());
    const byPlatform = this.db.prepare('SELECT platform, COUNT(*) AS n FROM influencers GROUP BY platform').all();
    const byCategory = this.db.prepare('SELECT category, COUNT(*) AS n FROM influencer_categories GROUP BY category').all();
    return {
      ...totals,
      byPlatform: Object.fromEntries(byPlatform.map((r) => [r.platform, r.n])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.n])),
    };
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM influencers').get().n;
  }

  #validate(input, { partial }) {
    const out = {};
    for (const key of EDITABLE) {
      if (input[key] !== undefined) out[key] = input[key] === '' ? null : input[key];
    }
    if (out.handle !== undefined) out.handle = cleanHandle(out.handle);
    if (out.platform !== undefined && !PLATFORM_IDS.has(out.platform)) throw new ValidationError(`פלטפורמה לא נתמכת: ${out.platform}`);
    if (out.followers !== undefined) out.followers = toInt(out.followers) ?? 0;
    if (out.avg_views !== undefined) out.avg_views = toInt(out.avg_views);
    if (out.posts_count !== undefined) out.posts_count = toInt(out.posts_count);
    if (out.engagement_rate !== undefined) out.engagement_rate = toFloat(out.engagement_rate);
    if (out.gender !== undefined && out.gender !== null && !['female', 'male', 'other'].includes(out.gender)) out.gender = null;
    if (out.followers !== undefined && out.followers < 0) throw new ValidationError('מספר עוקבים לא תקין');

    if (!partial) {
      if (!out.handle) throw new ValidationError('חסר שם משתמש (handle)');
      if (!out.platform) throw new ValidationError('חסרה פלטפורמה');
      if (!out.name) out.name = out.handle;
      if (!out.profile_url) out.profile_url = buildProfileUrl(out.platform, out.handle);
      if (out.followers === undefined) out.followers = 0;
    } else if (out.handle && !out.profile_url && input.platform) {
      out.profile_url = buildProfileUrl(input.platform, out.handle);
    }
    for (const key of ['name', 'handle', 'profile_url']) {
      if (key in out && !out[key]) throw new ValidationError(`שדה חובה ריק: ${key}`);
    }
    return out;
  }

  #setCategories(id, categories) {
    this.db.prepare('DELETE FROM influencer_categories WHERE influencer_id = ?').run(id);
    const insert = this.db.prepare('INSERT INTO influencer_categories (influencer_id, category) VALUES (?, ?)');
    for (const c of normalizeCategories(categories ?? [])) insert.run(id, c);
  }

  #recordHistory(id, followers, engagement, at = now()) {
    this.db.prepare('INSERT INTO follower_history (influencer_id, recorded_at, followers, engagement_rate) VALUES (?, ?, ?, ?)')
      .run(id, at, followers, engagement);
  }

  #hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const cats = this.db.prepare(`SELECT influencer_id, category FROM influencer_categories WHERE influencer_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byId = new Map();
    for (const c of cats) {
      if (!byId.has(c.influencer_id)) byId.set(c.influencer_id, []);
      byId.get(c.influencer_id).push(c.category);
    }
    return rows.map((r) => ({
      ...r,
      is_demo: Boolean(r.is_demo),
      categories: byId.get(r.id) ?? [],
      tier: tierFor(r.followers),
    }));
  }
}

// Follower growth (%) over the last 30 days, based on the oldest history point in that window.
const GROWTH_SQL = `(
  SELECT CASE WHEN h.followers > 0 THEN ROUND((i.followers - h.followers) * 100.0 / h.followers, 2) END
  FROM follower_history h
  WHERE h.influencer_id = i.id AND h.recorded_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  ORDER BY h.recorded_at ASC LIMIT 1
)`;

function cleanHandle(h) {
  return String(h ?? '').trim().replace(/^@/, '');
}

function asList(v) {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
}
