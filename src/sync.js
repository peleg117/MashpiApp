import { NotFoundError } from './providers/index.js';

/**
 * Keeps influencer metrics fresh: on every tick it picks the most out-of-date profiles,
 * fetches their latest numbers from the matching provider and broadcasts changes live.
 */
export class SyncService {
  constructor({ repo, providers, events, intervalSeconds = 60, batchSize = 10, staleMinutes = 360, logger = console }) {
    Object.assign(this, { repo, providers, events, intervalSeconds, batchSize, staleMinutes, logger });
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((err) => this.logger.error('[sync]', err)), this.intervalSeconds * 1000);
    this.timer.unref?.();
    setTimeout(() => this.tick().catch((err) => this.logger.error('[sync]', err)), 2000).unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  providerFor(row) {
    if (row.is_demo) return this.providers.demo;
    return this.providers.byPlatform[row.platform] ?? null;
  }

  async tick() {
    if (this.running) return { skipped: true };
    this.running = true;
    let updated = 0;
    try {
      // Demo rows refresh every tick so the live feed is visible; real rows honour staleMinutes.
      const batch = this.repo.staleBatch(this.batchSize, this.staleMinutes);
      const demoBatch = this.repo.staleBatch(this.batchSize * 5, 0).filter((r) => r.is_demo);
      const seen = new Set();
      for (const row of [...batch, ...demoBatch.sort(() => Math.random() - 0.5).slice(0, this.batchSize)]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        if (await this.refresh(row.id)) updated++;
      }
      this.lastRunAt = new Date().toISOString();
      this.events.publish('sync', { at: this.lastRunAt, updated, stats: this.repo.stats() });
      return { updated };
    } finally {
      this.running = false;
    }
  }

  /** Refresh a single influencer. Returns true when its data changed. */
  async refresh(id) {
    const current = this.repo.get(id);
    if (!current) return false;
    const provider = this.providerFor(current);
    if (!provider) {
      this.repo.markSyncFailed(id, 'manual', 'אין מקור נתונים מוגדר לפלטפורמה זו — עדכון ידני');
      return false;
    }
    try {
      const metrics = await provider.fetchProfile({ platform: current.platform, handle: current.handle }, current);
      const { influencer, changed } = this.repo.applySync(id, metrics);
      if (changed) this.events.publish('influencer.updated', influencer);
      return changed;
    } catch (err) {
      const status = err instanceof NotFoundError ? 'not_found' : 'error';
      this.repo.markSyncFailed(id, status, err.message);
      this.logger.warn(`[sync] ${current.platform}/${current.handle}: ${err.message}`);
      this.events.publish('influencer.updated', this.repo.get(id));
      return false;
    }
  }

  status() {
    return {
      intervalSeconds: this.intervalSeconds,
      lastRunAt: this.lastRunAt,
      providers: Object.fromEntries(Object.entries(this.providers.byPlatform).map(([k, p]) => [k, p.label])),
    };
  }
}
