import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileUrl, buildProfileUrl } from '../src/platforms.js';

test('parses profile URLs from all platforms', () => {
  assert.deepEqual(parseProfileUrl('https://www.instagram.com/some.user/'), { platform: 'instagram', handle: 'some.user' });
  assert.deepEqual(parseProfileUrl('instagram.com/some_user?igsh=abc'), { platform: 'instagram', handle: 'some_user' });
  assert.deepEqual(parseProfileUrl('https://www.tiktok.com/@creator'), { platform: 'tiktok', handle: 'creator' });
  assert.deepEqual(parseProfileUrl('https://youtube.com/@chan'), { platform: 'youtube', handle: 'chan' });
  assert.deepEqual(parseProfileUrl('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), { platform: 'youtube', handle: 'UCabcdefghijklmnopqrstuv' });
  assert.deepEqual(parseProfileUrl('https://x.com/someone'), { platform: 'x', handle: 'someone' });
});

test('rejects unknown hosts and bare post URLs', () => {
  assert.equal(parseProfileUrl('https://example.com/user'), null);
  assert.equal(parseProfileUrl('https://instagram.com/'), null);
  assert.equal(parseProfileUrl('not a url at all ::'), null);
});

test('builds canonical profile URLs', () => {
  assert.equal(buildProfileUrl('tiktok', '@abc'), 'https://www.tiktok.com/@abc');
  assert.equal(buildProfileUrl('instagram', 'abc'), 'https://www.instagram.com/abc/');
});
