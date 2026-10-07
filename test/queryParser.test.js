import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/queryParser.js';

test('mom influencer over 50,000 followers', () => {
  assert.deepEqual(parseQuery('משפיענית אמא מעל 50,000 עוקבים'), { minFollowers: 50000, gender: 'female', category: ['parenting'] });
});

test('range with K units and platform prefix', () => {
  assert.deepEqual(parseQuery('יוצרי תוכן אוכל בטיקטוק בין 10K ל-100K'),
    { minFollowers: 10000, maxFollowers: 100000, platform: ['tiktok'], category: ['food'] });
});

test('millions, male gender and gaming', () => {
  assert.deepEqual(parseQuery('גיימר ביוטיוב מעל 1M'), { minFollowers: 1000000, platform: ['youtube'], gender: 'male', category: ['gaming'] });
});

test('Hebrew thousand unit and "עד"', () => {
  assert.deepEqual(parseQuery('משפיעניות אופנה עד 30 אלף'), { maxFollowers: 30000, gender: 'female', category: ['fashion'] });
});

test('tier and city', () => {
  assert.deepEqual(parseQuery('מיקרו משפיעניות ביוטי מתל אביב'), { tier: 'micro', gender: 'female', category: ['beauty'], city: 'תל אביב' });
});

test('percentages are engagement, not followers', () => {
  assert.deepEqual(parseQuery('בלוגרית אופנה 20k+ מעורבות מעל 3%'), { minEngagement: 3, minFollowers: 20000, gender: 'female', category: ['fashion'] });
  assert.deepEqual(parseQuery('כושר מעל 4%'), { minEngagement: 4, category: ['fitness'] });
});

test('English query', () => {
  assert.deepEqual(parseQuery('fitness instagram over 100k'), { minFollowers: 100000, platform: ['instagram'], category: ['fitness'] });
});

test('unrecognised words fall through to free text', () => {
  assert.deepEqual(parseQuery('נועה כהן'), { q: 'נועה כהן' });
  assert.deepEqual(parseQuery(''), {});
});
