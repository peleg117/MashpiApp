import { NotFoundError } from './youtube.js';

// Instagram Graph API — Business Discovery.
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
// Works for Business / Creator accounts only, queried through your own connected IG business account.
const API = 'https://graph.facebook.com/v21.0';

export function createInstagramProvider({ accessToken, businessAccountId, fetchImpl = fetch }) {
  return {
    id: 'instagram',
    label: 'Instagram Graph API',
    async fetchProfile({ handle }) {
      const fields = `business_discovery.username(${handle}){name,biography,profile_picture_url,followers_count,media_count,media.limit(12){like_count,comments_count}}`;
      const params = new URLSearchParams({ fields, access_token: accessToken });
      const res = await fetchImpl(`${API}/${businessAccountId}?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Error 110 / subcode 2207013: the account is personal or doesn't exist.
        if (body.error?.error_subcode === 2207013 || body.error?.code === 110) {
          throw new NotFoundError(`פרופיל אינסטגרם לא נמצא או שאינו חשבון עסקי/קריאייטור: ${handle}`);
        }
        throw new Error(`Instagram API ${res.status}: ${body.error?.message ?? 'unknown error'}`);
      }
      const bd = body.business_discovery;
      if (!bd) throw new NotFoundError(`פרופיל אינסטגרם לא נמצא: ${handle}`);
      const media = bd.media?.data ?? [];
      let engagement;
      if (media.length && bd.followers_count > 0) {
        const avgInteractions = media.reduce((s, m) => s + (m.like_count ?? 0) + (m.comments_count ?? 0), 0) / media.length;
        engagement = Math.round((avgInteractions / bd.followers_count) * 10000) / 100;
      }
      return {
        name: bd.name || undefined,
        bio: bd.biography || undefined,
        avatar_url: bd.profile_picture_url,
        followers: bd.followers_count,
        posts_count: bd.media_count,
        engagement_rate: engagement,
      };
    },
  };
}
