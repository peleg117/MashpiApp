import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';
import { EventHub } from '../src/events.js';

let server, base, ctx;
const fakeYouTube = {
  id: 'youtube',
  label: 'fake',
  calls: 0,
  async fetchProfile() {
    this.calls++;
    return { followers: 123456 + this.calls, name: 'Live Channel' };
  },
};

before(async () => {
  ctx = createApp({
    db: openDatabase(':memory:'),
    providers: { byPlatform: { youtube: fakeYouTube }, demo: { label: 'demo', fetchProfile: async (_r, c) => ({ followers: c.followers + 10 }) } },
    events: new EventHub(),
    adminToken: '',
  });
  server = ctx.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const add = (body) => fetch(`${base}/api/influencers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await add({ profile_url: 'https://www.instagram.com/mom.one/', name: 'אמא אחת', followers: '80,000', gender: 'female', categories: ['parenting'] });
  await add({ profile_url: 'https://www.instagram.com/mom.two/', name: 'אמא שתיים', followers: 20000, gender: 'female', categories: ['אמא'] });
  await add({ profile_url: 'https://www.tiktok.com/@dad.one', name: 'אבא', followers: 90000, gender: 'male', categories: ['parenting'] });
  await add({ profile_url: 'https://www.instagram.com/chef/', name: 'שפית', followers: 300000, gender: 'female', categories: ['food'], engagement_rate: 2.5 });
});

after(() => server.close());

test('smart search: mom over 50K', async () => {
  const q = encodeURIComponent('משפיענית אמא מעל 50,000 עוקבים');
  const body = await (await fetch(`${base}/api/influencers?smart=${q}`)).json();
  assert.equal(body.total, 1);
  assert.equal(body.items[0].handle, 'mom.one');
  assert.equal(body.items[0].followers, 80000);
  assert.deepEqual(body.items[0].categories, ['parenting']);
});

test('structured filters combine and sort', async () => {
  const body = await (await fetch(`${base}/api/influencers?category=parenting&sort=followers&order=asc`)).json();
  assert.deepEqual(body.items.map((i) => i.handle), ['mom.two', 'mom.one', 'dad.one']);
  const ig = await (await fetch(`${base}/api/influencers?platform=instagram&minFollowers=100000`)).json();
  assert.deepEqual(ig.items.map((i) => i.handle), ['chef']);
});

test('duplicate profiles are rejected', async () => {
  const res = await fetch(`${base}/api/influencers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile_url: 'instagram.com/mom.one' }) });
  assert.equal(res.status, 409);
});

test('adding a profile with a live provider fetches its data immediately', async () => {
  const res = await fetch(`${base}/api/influencers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile_url: 'https://www.youtube.com/@livechan' }) });
  assert.equal(res.status, 201);
  const inf = await res.json();
  assert.equal(inf.platform, 'youtube');
  assert.equal(inf.name, 'Live Channel');
  assert.ok(inf.followers > 123456);
  assert.equal(inf.sync_status, 'ok');
});

test('sync tick updates data, records history and marks manual profiles', async () => {
  const yt = ctx.repo.findByHandle('youtube', 'livechan');
  const before = yt.followers;
  ctx.sync.staleMinutes = 0;
  await ctx.sync.tick();
  const after = ctx.repo.get(yt.id);
  assert.ok(after.followers > before);
  assert.ok(ctx.repo.history(yt.id).length >= 2);
  const manual = ctx.repo.findByHandle('instagram', 'mom.one');
  assert.equal(manual.sync_status, 'manual');
  assert.equal(manual.last_synced_at, null, 'no data was fetched, so it must not look freshly synced');
});

test('CSV import with Hebrew headers, then export', async () => {
  const csv = 'שם,לינק לפרופיל,עוקבים,קטגוריה,מגדר\n"יוצרת, חדשה",https://www.tiktok.com/@new.one,"55,000",אמהות והורות|lifestyle,אישה\nשבור,https://example.com/x,1,,\n';
  const res = await (await fetch(`${base}/api/import`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv })).json();
  assert.equal(res.created, 1);
  assert.equal(res.errors.length, 1);
  const created = ctx.repo.findByHandle('tiktok', 'new.one');
  assert.equal(created.name, 'יוצרת, חדשה');
  assert.equal(created.followers, 55000);
  assert.deepEqual(created.categories.sort(), ['lifestyle', 'parenting']);

  const out = await (await fetch(`${base}/api/influencers/export.csv?category=parenting`)).text();
  assert.match(out, /^\uFEFF?שם,/);
  assert.match(out, /"יוצרת, חדשה"/);
  assert.equal(out.trim().split('\r\n').length, 1 + 4);
});

test('admin token protects writes', async () => {
  const guarded = createApp({ db: openDatabase(':memory:'), providers: { byPlatform: {}, demo: null }, adminToken: 'secret' });
  const s = guarded.app.listen(0);
  const url = `http://127.0.0.1:${s.address().port}/api/influencers`;
  const body = JSON.stringify({ profile_url: 'https://x.com/a' });
  const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body });
  s.close();
  assert.equal(denied.status, 401);
  assert.equal(ok.status, 201);
});
