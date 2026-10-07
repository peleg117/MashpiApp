/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, n) => [h, (r[n] ?? '').trim()])));
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('|') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(c.value(row))).join(','));
  // BOM so Excel opens Hebrew correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Accept Hebrew or English column headers on import.
export const IMPORT_ALIASES = {
  name: ['name', 'שם', 'שם המשפיען'],
  handle: ['handle', 'username', 'שם משתמש', 'יוזר'],
  platform: ['platform', 'פלטפורמה', 'רשת'],
  profile_url: ['profile_url', 'url', 'link', 'לינק', 'קישור', 'לינק לפרופיל'],
  followers: ['followers', 'עוקבים', 'מספר עוקבים'],
  categories: ['categories', 'category', 'קטגוריה', 'קטגוריות', 'תחום'],
  gender: ['gender', 'מגדר'],
  city: ['city', 'עיר', 'אזור'],
  engagement_rate: ['engagement_rate', 'engagement', 'מעורבות', 'אנגייג\'מנט'],
  avg_views: ['avg_views', 'צפיות ממוצעות'],
  contact_email: ['contact_email', 'email', 'אימייל', 'מייל'],
  contact_phone: ['contact_phone', 'phone', 'טלפון'],
  bio: ['bio', 'תיאור', 'ביו'],
  notes: ['notes', 'הערות'],
};

export function mapImportRow(raw) {
  const out = {};
  const lowerKeys = Object.fromEntries(Object.keys(raw).map((k) => [k.toLowerCase(), k]));
  for (const [field, aliases] of Object.entries(IMPORT_ALIASES)) {
    const key = aliases.map((a) => lowerKeys[a.toLowerCase()]).find(Boolean);
    if (key !== undefined && raw[key] !== '') out[field] = raw[key];
  }
  if (out.gender) {
    const g = out.gender.toLowerCase();
    out.gender = ['f', 'female', 'אישה', 'נקבה', 'נ'].includes(g) ? 'female' : ['m', 'male', 'גבר', 'זכר', 'ז'].includes(g) ? 'male' : null;
  }
  if (out.platform) out.platform = out.platform.toLowerCase().replace('twitter', 'x');
  return out;
}
