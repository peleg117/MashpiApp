import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS influencers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  handle           TEXT    NOT NULL,
  platform         TEXT    NOT NULL,
  profile_url      TEXT    NOT NULL,
  followers        INTEGER NOT NULL DEFAULT 0,
  engagement_rate  REAL,
  avg_views        INTEGER,
  posts_count      INTEGER,
  gender           TEXT,
  city             TEXT,
  language         TEXT    DEFAULT 'he',
  bio              TEXT,
  avatar_url       TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,
  notes            TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  sync_status      TEXT    NOT NULL DEFAULT 'pending',
  sync_error       TEXT,
  last_synced_at   TEXT,   -- last time fresh data was actually received
  checked_at       TEXT,   -- last sync attempt (drives scheduling)
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (platform, handle)
);
CREATE INDEX IF NOT EXISTS idx_influencers_followers ON influencers (followers);
CREATE INDEX IF NOT EXISTS idx_influencers_platform ON influencers (platform);
CREATE INDEX IF NOT EXISTS idx_influencers_checked ON influencers (checked_at);

CREATE TABLE IF NOT EXISTS influencer_categories (
  influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  category      TEXT    NOT NULL,
  PRIMARY KEY (influencer_id, category)
);
CREATE INDEX IF NOT EXISTS idx_categories_category ON influencer_categories (category);

CREATE TABLE IF NOT EXISTS follower_history (
  influencer_id   INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  recorded_at     TEXT    NOT NULL,
  followers       INTEGER NOT NULL,
  engagement_rate REAL
);
CREATE INDEX IF NOT EXISTS idx_history ON follower_history (influencer_id, recorded_at);
`;

export function openDatabase(file = process.env.DB_PATH || './data/mashpiapp.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

let savepointSeq = 0;

/** Run fn atomically, rolling back on error. Savepoints make nested calls safe. */
export function transaction(db, fn) {
  const name = `sp_${++savepointSeq}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
}
