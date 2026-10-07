// Mashpi — client app (vanilla JS, no build step)

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EXAMPLES = [
  'משפיענית אמא מעל 50,000 עוקבים',
  'יוצרי תוכן אוכל בטיקטוק בין 10K ל-100K',
  'מיקרו משפיעניות ביוטי',
  'גיימר ביוטיוב מעל 100K',
  'כושר באינסטגרם מעורבות מעל 4%',
];
const GENDER_LABEL = { female: 'נשים', male: 'גברים' };
const PAGE_SIZE = 25;

const state = {
  meta: null,
  filters: emptyFilters(),
  sort: 'followers',
  order: 'desc',
  page: 1,
  total: 0,
  rows: new Map(), // id -> influencer currently on screen
  openId: null,
  editingId: null,
  lastSyncAt: null,
};

function emptyFilters() {
  return { q: '', platform: new Set(), category: new Set(), gender: '', tier: '', minFollowers: '', maxFollowers: '', minEngagement: '', city: '' };
}

// ---------------- helpers ----------------
const numberFmt = new Intl.NumberFormat('he-IL');
const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });

function compact(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 10_000) return `${trim(n / 1000, 0)}K`;
  if (n >= 1000) return `${trim(n / 1000)}K`;
  return String(n);
}
function trim(x, digits = 1) {
  return x.toFixed(digits).replace(/\.0$/, '');
}
function parseNum(v) {
  if (v === '' || v === null || v === undefined) return '';
  const m = String(v).trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(k|m|אלף|מיליון)?$/);
  if (!m) return '';
  const mult = { k: 1e3, 'אלף': 1e3, m: 1e6, 'מיליון': 1e6 }[m[2]] ?? 1;
  return String(Math.round(Number(m[1]) * mult));
}
function ago(iso) {
  if (!iso) return 'טרם עודכן';
  const sec = Math.round((new Date(iso) - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}
function hue(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
function avatar(inf) {
  if (inf.avatar_url) return `<img class="avatar" src="${esc(inf.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const initials = inf.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return `<span class="avatar" style="background:hsl(${hue(inf.handle)} 55% 48%)" aria-hidden="true">${esc(initials)}</span>`;
}
const platformLabel = (id) => state.meta?.platforms.find((p) => p.id === id)?.label ?? id;
const categoryLabel = (id) => state.meta?.categories.find((c) => c.id === id)?.label ?? id;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  const token = safeStorage('get', 'adminToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const t = prompt('פעולה זו דורשת טוקן מנהל:');
    if (t) {
      safeStorage('set', 'adminToken', t);
      return api(path, opts);
    }
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `שגיאה ${res.status}`);
  return body;
}

function safeStorage(op, key, value) {
  try {
    return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// ---------------- filters ----------------
function queryParams({ withPaging = true } = {}) {
  const f = state.filters;
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.platform.size) p.set('platform', [...f.platform].join(','));
  if (f.category.size) p.set('category', [...f.category].join(','));
  if (f.gender) p.set('gender', f.gender);
  if (f.tier) p.set('tier', f.tier);
  if (f.minFollowers) p.set('minFollowers', f.minFollowers);
  if (f.maxFollowers) p.set('maxFollowers', f.maxFollowers);
  if (f.minEngagement) p.set('minEngagement', f.minEngagement);
  if (f.city) p.set('city', f.city);
  p.set('sort', state.sort);
  p.set('order', state.order);
  if (withPaging) {
    p.set('page', state.page);
    p.set('pageSize', PAGE_SIZE);
  }
  return p;
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const f = state.filters;
  f.q = p.get('q') ?? '';
  f.platform = new Set((p.get('platform') ?? '').split(',').filter(Boolean));
  f.category = new Set((p.get('category') ?? '').split(',').filter(Boolean));
  f.gender = p.get('gender') ?? '';
  f.tier = p.get('tier') ?? '';
  f.minFollowers = p.get('minFollowers') ?? '';
  f.maxFollowers = p.get('maxFollowers') ?? '';
  f.minEngagement = p.get('minEngagement') ?? '';
  f.city = p.get('city') ?? '';
  state.sort = p.get('sort') ?? 'followers';
  state.order = p.get('order') ?? 'desc';
  state.page = Number(p.get('page')) || 1;
}

function syncControls() {
  const f = state.filters;
  $('#f-q').value = f.q;
  $('#f-min').value = f.minFollowers ? numberFmt.format(f.minFollowers) : '';
  $('#f-max').value = f.maxFollowers ? numberFmt.format(f.maxFollowers) : '';
  $('#f-eng').value = f.minEngagement;
  $('#f-city').value = f.city;
  for (const b of document.querySelectorAll('#f-platform .pill')) b.classList.toggle('on', f.platform.has(b.dataset.value));
  for (const b of document.querySelectorAll('#f-category .pill')) b.classList.toggle('on', f.category.has(b.dataset.value));
  for (const b of document.querySelectorAll('#f-tier .pill')) b.classList.toggle('on', f.tier === b.dataset.value);
  for (const b of document.querySelectorAll('#f-gender button')) b.classList.toggle('on', f.gender === b.dataset.value);
  $('#sort').value = `${state.sort}:${state.order}`;
}

function renderChips() {
  const f = state.filters;
  const chips = [];
  if (f.q) chips.push(['q', `"${f.q}"`]);
  for (const p of f.platform) chips.push([`platform:${p}`, platformLabel(p)]);
  for (const c of f.category) chips.push([`category:${c}`, categoryLabel(c)]);
  if (f.gender) chips.push(['gender', GENDER_LABEL[f.gender]]);
  if (f.tier) chips.push(['tier', state.meta.tiers.find((t) => t.id === f.tier)?.label ?? f.tier]);
  if (f.minFollowers) chips.push(['minFollowers', `מעל ${compact(+f.minFollowers)} עוקבים`]);
  if (f.maxFollowers) chips.push(['maxFollowers', `עד ${compact(+f.maxFollowers)} עוקבים`]);
  if (f.minEngagement) chips.push(['minEngagement', `מעורבות ${f.minEngagement}%+`]);
  if (f.city) chips.push(['city', f.city]);
  $('#active-chips').innerHTML = chips.map(([key, label]) =>
    `<span class="chip">${esc(label)}<button type="button" data-remove="${esc(key)}" aria-label="הסרה">✕</button></span>`).join('');
}

function removeFilter(key) {
  const [name, value] = key.split(':');
  const f = state.filters;
  if (value) f[name].delete(value);
  else f[name] = '';
  update();
}

let searchSeq = 0;
async function search() {
  const seq = ++searchSeq;
  const params = queryParams();
  history.replaceState(null, '', `?${params}`);
  renderChips();
  try {
    const data = await api(`/api/influencers?${params}`);
    if (seq !== searchSeq) return; // a newer search finished first
    state.total = data.total;
    state.rows = new Map(data.items.map((i) => [i.id, i]));
    renderRows(data.items);
    renderPager();
    $('#results-count').textContent = data.total === 0 ? 'אין תוצאות'
      : data.total === 1 ? 'נמצא משפיען אחד' : `נמצאו ${numberFmt.format(data.total)} משפיענים`;
    $('#empty').hidden = data.total !== 0;
  } catch (err) {
    $('#results-count').textContent = 'שגיאה בטעינה';
    toast(err.message);
  }
}

function update({ resetPage = true } = {}) {
  if (resetPage) state.page = 1;
  syncControls();
  search();
}

// ---------------- rendering ----------------
function rowHtml(inf) {
  const g = inf.growth_30d;
  const delta = g === null || g === undefined ? '' : `<span class="delta ${g >= 0 ? 'up' : 'down'}" title="שינוי ב-30 הימים האחרונים">${g >= 0 ? '▲' : '▼'} ${Math.abs(g)}%</span>`;
  const syncWarn = ['error', 'not_found'].includes(inf.sync_status) ? ` <span class="status-warn" title="${esc(inf.sync_error)}">⚠</span>` : '';
  return `
    <td class="c-who"><div class="who-cell">
      ${avatar(inf)}
      <div>
        <div class="name">${esc(inf.name)}${inf.is_demo ? '<span class="badge" title="נתוני דמו לצורך הדגמה">דמו</span>' : ''}</div>
        <a class="handle" href="${esc(inf.profile_url)}" target="_blank" rel="noopener" data-stop>@${esc(inf.handle)}</a>
      </div>
    </div></td>
    <td class="c-platform"><span class="platform p-${esc(inf.platform)}"><i></i>${esc(platformLabel(inf.platform))}</span></td>
    <td class="c-followers num followers" title="${numberFmt.format(inf.followers)}"><strong>${compact(inf.followers)}</strong>${delta}</td>
    <td class="c-eng num">${inf.engagement_rate != null ? `${inf.engagement_rate}%` : '—'}</td>
    <td class="c-tags"><div class="tags">${inf.categories.map((c) => `<span class="tag">${esc(categoryLabel(c))}</span>`).join('')}</div></td>
    <td class="c-city">${esc(inf.city ?? '')}</td>
    <td class="c-when"><span class="when" data-ts="${esc(inf.last_synced_at ?? inf.updated_at)}">${ago(inf.last_synced_at ?? inf.updated_at)}</span>${syncWarn}</td>`;
}

function renderRows(items) {
  $('#rows').innerHTML = items.map((inf) => `<tr data-id="${inf.id}">${rowHtml(inf)}</tr>`).join('');
}

function renderPager() {
  const pages = Math.ceil(state.total / PAGE_SIZE);
  const pager = $('#pager');
  if (pages <= 1) { pager.innerHTML = ''; return; }
  const cur = state.page;
  const nums = [...new Set([1, cur - 1, cur, cur + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="הקודם">›</button>`;
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) html += '<button disabled>…</button>';
    html += `<button data-page="${n}" class="${n === cur ? 'on' : ''}">${n}</button>`;
    prev = n;
  }
  html += `<button data-page="${cur + 1}" ${cur === pages ? 'disabled' : ''} aria-label="הבא">‹</button>`;
  pager.innerHTML = html;
}

function renderStats(s) {
  $('#stats').innerHTML = `
    <div class="stat"><span>משפיענים במאגר</span><strong>${numberFmt.format(s.total)}</strong></div>
    <div class="stat"><span>חשיפה מצטברת</span><strong>${compact(s.reach)}</strong></div>
    <div class="stat"><span>עודכנו ב-24 שעות</span><strong>${numberFmt.format(s.synced_24h ?? 0)}</strong></div>
    <div class="stat"><span>סנכרון אחרון</span><strong class="when-big" data-ts="${esc(s.last_sync ?? '')}">${ago(s.last_sync)}</strong></div>`;
}

async function refreshStats() {
  try { renderStats(await api('/api/stats')); } catch { /* stats are non-critical */ }
}

// ---------------- detail drawer ----------------
async function openDrawer(id) {
  state.openId = id;
  const drawer = $('#drawer');
  drawer.innerHTML = '<div class="drawer-body muted">טוען…</div>';
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  try {
    const inf = await api(`/api/influencers/${id}`);
    if (state.openId === id) renderDrawer(inf);
  } catch (err) {
    drawer.innerHTML = `<div class="drawer-body">${esc(err.message)}</div>`;
  }
}

function closeDrawer() {
  state.openId = null;
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
}

function renderDrawer(inf) {
  const syncNote = {
    ok: 'מתעדכן אוטומטית',
    manual: 'עדכון ידני — לא הוגדר מקור נתונים לפלטפורמה',
    error: `שגיאת סנכרון: ${inf.sync_error ?? ''}`,
    not_found: 'הפרופיל לא נמצא במקור הנתונים',
    pending: 'ממתין לסנכרון ראשון',
  }[inf.sync_status] ?? inf.sync_status;
  $('#drawer').innerHTML = `
    <div class="drawer-head">
      ${avatar(inf)}
      <div>
        <h2>${esc(inf.name)} ${inf.is_demo ? '<span class="badge">דמו</span>' : ''}</h2>
        <a href="${esc(inf.profile_url)}" target="_blank" rel="noopener" dir="ltr">@${esc(inf.handle)}</a>
        <div class="platform p-${esc(inf.platform)}"><i></i>${esc(platformLabel(inf.platform))}</div>
      </div>
      <button class="icon-btn" data-close aria-label="סגירה">✕</button>
    </div>
    <div class="drawer-body">
      <div class="kpis">
        <div class="kpi"><span>עוקבים</span><strong data-live="followers">${numberFmt.format(inf.followers)}</strong></div>
        <div class="kpi"><span>מעורבות</span><strong data-live="engagement_rate">${inf.engagement_rate != null ? `${inf.engagement_rate}%` : '—'}</strong></div>
        <div class="kpi"><span>צמיחה 30 יום</span><strong><bdi dir="ltr">${inf.growth_30d != null ? `${inf.growth_30d > 0 ? '+' : ''}${inf.growth_30d}%` : '—'}</bdi></strong></div>
      </div>
      <div class="chart"><h3>עוקבים — 90 הימים האחרונים</h3>${chartSvg(inf.history)}</div>
      ${inf.bio ? `<p>${esc(inf.bio)}</p>` : ''}
      <dl class="details">
        <dt>קטגוריות</dt><dd>${inf.categories.map(categoryLabel).map(esc).join(', ') || '—'}</dd>
        <dt>מגדר</dt><dd>${({ female: 'אישה', male: 'גבר', other: 'אחר' })[inf.gender] ?? '—'}</dd>
        <dt>עיר</dt><dd>${esc(inf.city ?? '—')}</dd>
        <dt>צפיות ממוצעות</dt><dd>${inf.avg_views != null ? numberFmt.format(inf.avg_views) : '—'}</dd>
        <dt>פוסטים</dt><dd>${inf.posts_count != null ? numberFmt.format(inf.posts_count) : '—'}</dd>
        <dt>אימייל</dt><dd>${inf.contact_email ? `<a href="mailto:${esc(inf.contact_email)}" dir="ltr">${esc(inf.contact_email)}</a>` : '—'}</dd>
        <dt>טלפון</dt><dd dir="ltr" style="text-align:right">${esc(inf.contact_phone ?? '—')}</dd>
        <dt>הערות</dt><dd>${esc(inf.notes ?? '—')}</dd>
        <dt>סטטוס נתונים</dt><dd>${esc(syncNote)}</dd>
        <dt>עודכן</dt><dd>${ago(inf.last_synced_at ?? inf.updated_at)}</dd>
      </dl>
      <div class="drawer-actions">
        <button class="btn primary" data-action="refresh">רענון נתונים עכשיו</button>
        <button class="btn ghost" data-action="edit">עריכה</button>
        <button class="btn danger" data-action="delete">מחיקה</button>
      </div>
    </div>`;
}

function chartSvg(history) {
  if (!history || history.length < 2) return '<p class="muted">אין עדיין מספיק נתונים להצגת גרף</p>';
  const W = 400, H = 140, P = { t: 10, r: 8, b: 18, l: 44 };
  const xs = history.map((h) => new Date(h.recorded_at).getTime());
  const ys = history.map((h) => h.followers);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.1;
  y0 -= pad; y1 += pad;
  // RTL page, but time runs left → right as in any chart.
  const sx = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const sy = (y) => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);
  const pts = history.map((h, n) => `${sx(xs[n]).toFixed(1)},${sy(h.followers).toFixed(1)}`);
  const area = `M${sx(x0)},${H - P.b} L${pts.join(' L')} L${sx(x1)},${H - P.b} Z`;
  const fmtY = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : numberFmt.format(n));
  const fmtDate = (t) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="גרף עוקבים" direction="ltr">
    <path class="area" d="${area}"/>
    <polyline class="line" points="${pts.join(' ')}"/>
    <text class="axis" x="${P.l - 4}" y="${sy(y1 - pad) + 4}" text-anchor="end">${fmtY(Math.round(y1 - pad))}</text>
    <text class="axis" x="${P.l - 4}" y="${sy(y0 + pad) + 4}" text-anchor="end">${fmtY(Math.round(y0 + pad))}</text>
    <text class="axis" x="${sx(x0)}" y="${H - 4}" text-anchor="start">${fmtDate(x0)}</text>
    <text class="axis" x="${sx(x1)}" y="${H - 4}" text-anchor="end">${fmtDate(x1)}</text>
  </svg>`;
}

// ---------------- add / edit ----------------
function openEditor(inf = null) {
  state.editingId = inf?.id ?? null;
  const form = $('#edit-form');
  form.reset();
  $('#edit-title').textContent = inf ? `עריכת ${inf.name}` : 'הוספת משפיען';
  $('#edit-error').hidden = true;
  $('#url-hint').textContent = 'מדביקים לינק — הפלטפורמה ושם המשתמש מזוהים אוטומטית';
  $('#url-hint').className = 'hint';
  const selected = new Set(inf?.categories ?? []);
  $('#edit-categories').innerHTML = state.meta.categories.map((c) =>
    `<button type="button" class="pill ${selected.has(c.id) ? 'on' : ''}" data-value="${c.id}">${esc(c.label)}</button>`).join('');
  if (inf) {
    for (const el of form.elements) {
      if (el.name && inf[el.name] !== undefined && inf[el.name] !== null) el.value = inf[el.name];
    }
  }
  $('#dlg-edit').showModal();
}

async function submitEditor(ev) {
  if (ev.submitter?.value === 'cancel') return;
  ev.preventDefault();
  const form = $('#edit-form');
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  data.followers = parseNum(data.followers) || (state.editingId ? undefined : '0');
  data.avg_views = parseNum(data.avg_views);
  data.categories = [...document.querySelectorAll('#edit-categories .pill.on')].map((b) => b.dataset.value);
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  if (!state.editingId) {
    for (const k of Object.keys(data)) if (data[k] === '') delete data[k];
  }
  const btn = $('#edit-submit');
  btn.disabled = true;
  try {
    const saved = state.editingId
      ? await api(`/api/influencers/${state.editingId}`, { method: 'PATCH', json: data })
      : await api('/api/influencers', { method: 'POST', json: data });
    $('#dlg-edit').close();
    toast(state.editingId ? 'השינויים נשמרו' : `${saved.name} נוסף/ה למאגר`);
    search();
    if (state.openId === saved.id) openDrawer(saved.id);
  } catch (err) {
    $('#edit-error').textContent = err.message;
    $('#edit-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function detectPlatform(url) {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    const map = { 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X' };
    const handle = u.pathname.split('/').filter(Boolean).pop()?.replace(/^@/, '');
    return map[host] && handle ? `${map[host]} · @${handle}` : null;
  } catch {
    return null;
  }
}

// ---------------- import ----------------
async function submitImport(ev) {
  if (ev.submitter?.value === 'cancel') return;
  ev.preventDefault();
  const file = $('#import-file').files[0];
  if (!file) return;
  const btn = $('#import-submit');
  btn.disabled = true;
  try {
    const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text() });
    $('#import-result').innerHTML = `<p><strong>נוספו ${result.created}, עודכנו ${result.updated}</strong></p>${result.errors.length
      ? `<p class="form-error">${result.errors.length} שורות נכשלו:</p><ul>${result.errors.slice(0, 10).map((e) => `<li>שורה ${e.row}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}`;
    search();
    refreshStats();
  } catch (err) {
    $('#import-result').innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------- live updates (SSE) ----------------
function connectLive() {
  const live = $('#live');
  const es = new EventSource('/api/events');
  es.onopen = () => {
    live.className = 'live on';
    $('#live-text').textContent = 'מחובר — מתעדכן בזמן אמת';
  };
  es.onerror = () => {
    live.className = 'live off';
    $('#live-text').textContent = 'החיבור נותק — מנסה שוב…';
  };
  es.addEventListener('influencer.updated', (e) => onInfluencerUpdated(JSON.parse(e.data)));
  es.addEventListener('influencer.created', debounce(() => { search(); refreshStats(); }, 800));
  es.addEventListener('influencer.deleted', (e) => {
    const { id } = JSON.parse(e.data);
    if (state.rows.has(id)) search();
    if (state.openId === id) closeDrawer();
    refreshStats();
  });
  es.addEventListener('bulk', debounce(() => { search(); refreshStats(); }, 800));
  es.addEventListener('sync', (e) => {
    const { stats } = JSON.parse(e.data);
    renderStats(stats);
  });
}

function onInfluencerUpdated(inf) {
  const prev = state.rows.get(inf.id);
  if (prev) {
    state.rows.set(inf.id, { ...prev, ...inf });
    const tr = document.querySelector(`#rows tr[data-id="${inf.id}"]`);
    if (tr) {
      tr.innerHTML = rowHtml(state.rows.get(inf.id));
      tr.classList.add('flash');
      requestAnimationFrame(() => requestAnimationFrame(() => tr.classList.remove('flash')));
    }
  }
  if (state.openId === inf.id) {
    const f = document.querySelector('#drawer [data-live="followers"]');
    const e = document.querySelector('#drawer [data-live="engagement_rate"]');
    if (f) f.textContent = numberFmt.format(inf.followers);
    if (e && inf.engagement_rate != null) e.textContent = `${inf.engagement_rate}%`;
  }
  addFeed(inf, prev);
}

const feedPrev = new Map();
function addFeed(inf, prevRow) {
  const before = feedPrev.get(inf.id) ?? prevRow?.followers;
  feedPrev.set(inf.id, inf.followers);
  if (before === undefined || before === inf.followers) return;
  const diff = inf.followers - before;
  const feed = $('#feed');
  feed.querySelector('.muted')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `<span class="who" data-open="${inf.id}">${esc(inf.name)}</span>
    <span class="delta ${diff >= 0 ? 'up' : 'down'}"><bdi dir="ltr">${diff >= 0 ? '+' : '−'}${compact(Math.abs(diff))}</bdi> עוקבים</span>`;
  feed.prepend(li);
  while (feed.children.length > 8) feed.lastElementChild.remove();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------- wiring ----------------
function renderFilterControls() {
  const m = state.meta;
  $('#f-platform').innerHTML = m.platforms.map((p) => `<button type="button" class="pill" data-value="${p.id}">${esc(p.label)}</button>`).join('');
  $('#f-category').innerHTML = m.categories.map((c) => `<button type="button" class="pill" data-value="${c.id}">${esc(c.label)}</button>`).join('');
  $('#f-tier').innerHTML = m.tiers.map((t) => `<button type="button" class="pill" data-value="${t.id}">${esc(t.label)}</button>`).join('');
  $('#examples').innerHTML = `<span>נסו:</span>${EXAMPLES.map((x) => `<button type="button">${esc(x)}</button>`).join('')}`;
}

async function runSmartSearch(text) {
  if (!text.trim()) { state.filters = emptyFilters(); update(); return; }
  const parsed = await api(`/api/parse?text=${encodeURIComponent(text)}`);
  state.filters = emptyFilters();
  const f = state.filters;
  f.q = parsed.q ?? '';
  f.platform = new Set(parsed.platform ?? []);
  f.category = new Set(parsed.category ?? []);
  f.gender = parsed.gender ?? '';
  f.tier = parsed.tier ?? '';
  f.minFollowers = parsed.minFollowers != null ? String(parsed.minFollowers) : '';
  f.maxFollowers = parsed.maxFollowers != null ? String(parsed.maxFollowers) : '';
  f.minEngagement = parsed.minEngagement != null ? String(parsed.minEngagement) : '';
  f.city = parsed.city ?? '';
  update();
}

function bind() {
  $('#smart-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runSmartSearch($('#smart-input').value).catch((err) => toast(err.message));
  });
  $('#examples').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    $('#smart-input').value = e.target.textContent;
    runSmartSearch(e.target.textContent).catch((err) => toast(err.message));
  });

  const togglePill = (setName) => (e) => {
    const b = e.target.closest('.pill');
    if (!b) return;
    const set = state.filters[setName];
    set.has(b.dataset.value) ? set.delete(b.dataset.value) : set.add(b.dataset.value);
    update();
  };
  $('#f-platform').addEventListener('click', togglePill('platform'));
  $('#f-category').addEventListener('click', togglePill('category'));
  $('#f-tier').addEventListener('click', (e) => {
    const b = e.target.closest('.pill');
    if (!b) return;
    state.filters.tier = state.filters.tier === b.dataset.value ? '' : b.dataset.value;
    update();
  });
  $('#f-gender').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.filters.gender = b.dataset.value;
    update();
  });
  const onText = debounce(() => {
    const f = state.filters;
    f.q = $('#f-q').value.trim();
    f.minFollowers = parseNum($('#f-min').value);
    f.maxFollowers = parseNum($('#f-max').value);
    f.minEngagement = $('#f-eng').value;
    f.city = $('#f-city').value.trim();
    state.page = 1;
    search();
  }, 350);
  for (const id of ['#f-q', '#f-min', '#f-max', '#f-eng', '#f-city']) $(id).addEventListener('input', onText);
  for (const id of ['#f-min', '#f-max']) $(id).addEventListener('change', () => syncControls());

  $('#btn-clear').addEventListener('click', () => {
    state.filters = emptyFilters();
    $('#smart-input').value = '';
    update();
  });
  $('#active-chips').addEventListener('click', (e) => {
    const key = e.target.closest('[data-remove]')?.dataset.remove;
    if (key) removeFilter(key);
  });
  $('#sort').addEventListener('change', (e) => {
    [state.sort, state.order] = e.target.value.split(':');
    update();
  });
  $('#pager').addEventListener('click', (e) => {
    const page = Number(e.target.closest('button')?.dataset.page);
    if (!page) return;
    state.page = page;
    search();
    window.scrollTo({ top: $('.results').offsetTop - 80, behavior: 'smooth' });
  });
  $('#rows').addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDrawer(Number(tr.dataset.id));
  });
  $('#feed').addEventListener('click', (e) => {
    const id = e.target.closest('[data-open]')?.dataset.open;
    if (id) openDrawer(Number(id));
  });

  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openId) closeDrawer(); });
  $('#drawer').addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeDrawer();
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const id = state.openId;
    try {
      if (action === 'refresh') {
        e.target.disabled = true;
        await api(`/api/influencers/${id}/refresh`, { method: 'POST' });
        await openDrawer(id);
        toast('הנתונים עודכנו');
      } else if (action === 'edit') {
        openEditor(await api(`/api/influencers/${id}`));
      } else if (action === 'delete') {
        if (!confirm('למחוק את המשפיען מהמאגר?')) return;
        await api(`/api/influencers/${id}`, { method: 'DELETE' });
        closeDrawer();
        toast('נמחק מהמאגר');
        search();
      }
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  });

  $('#btn-add').addEventListener('click', () => openEditor());
  $('#edit-form').addEventListener('submit', submitEditor);
  $('#edit-categories').addEventListener('click', (e) => e.target.closest('.pill')?.classList.toggle('on'));
  $('#edit-form').elements.profile_url.addEventListener('input', (e) => {
    const found = detectPlatform(e.target.value);
    $('#url-hint').textContent = found ? `זוהה: ${found}` : 'מדביקים לינק — הפלטפורמה ושם המשתמש מזוהים אוטומטית';
    $('#url-hint').className = found ? 'hint ok' : 'hint';
  });

  $('#btn-import').addEventListener('click', () => {
    $('#import-form').reset();
    $('#import-result').innerHTML = '';
    $('#dlg-import').showModal();
  });
  $('#import-form').addEventListener('submit', submitImport);

  $('#btn-export').addEventListener('click', () => {
    location.href = `/api/influencers/export.csv?${queryParams({ withPaging: false })}`;
  });
  const toggleFilters = (open) => $('#filters').classList.toggle('open', open);
  $('#btn-filters').addEventListener('click', () => toggleFilters(true));
  $('#btn-close-filters').addEventListener('click', () => toggleFilters(false));

  // Keep relative times ("לפני 3 דקות") fresh.
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-ts]')) el.textContent = ago(el.dataset.ts || null);
  }, 30000);
}

async function init() {
  state.meta = await api('/api/meta');
  renderFilterControls();
  bind();
  readUrl();
  syncControls();
  search();
  refreshStats();
  connectLive();
}

init().catch((err) => {
  $('#results-count').textContent = 'לא ניתן להתחבר לשרת';
  toast(err.message);
});
