import { NotFoundError } from './youtube.js';

// TikTok Research API — https://developers.tiktok.com/doc/research-api-specs-query-user-info
// Requires an approved Research API application (client credentials grant).
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/research/user/info/?fields=display_name,bio_description,avatar_url,follower_count,likes_count,video_count';

export function createTikTokProvider({ clientKey, clientSecret, fetchImpl = fetch }) {
  let token = null;
  let tokenExpires = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpires - 60000) return token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) throw new Error(`TikTok auth failed: ${body.error_description ?? res.status}`);
    token = body.access_token;
    tokenExpires = Date.now() + body.expires_in * 1000;
    return token;
  }

  return {
    id: 'tiktok',
    label: 'TikTok Research API',
    async fetchProfile({ handle }) {
      const res = await fetchImpl(USER_INFO_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error?.code !== 'ok') {
        if (res.status === 404 || body.error?.code === 'invalid_params') throw new NotFoundError(`פרופיל טיקטוק לא נמצא: ${handle}`);
        throw new Error(`TikTok API ${res.status}: ${body.error?.message ?? 'unknown error'}`);
      }
      const d = body.data ?? {};
      return {
        name: d.display_name || undefined,
        bio: d.bio_description || undefined,
        avatar_url: d.avatar_url,
        followers: d.follower_count,
        posts_count: d.video_count,
      };
    },
  };
}
