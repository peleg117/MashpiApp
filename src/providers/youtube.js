// YouTube Data API v3 — https://developers.google.com/youtube/v3/docs/channels/list
const API = 'https://www.googleapis.com/youtube/v3/channels';

export function createYouTubeProvider({ apiKey, fetchImpl = fetch }) {
  return {
    id: 'youtube',
    label: 'YouTube Data API',
    async fetchProfile({ handle }) {
      const params = new URLSearchParams({ part: 'snippet,statistics', key: apiKey });
      if (/^UC[\w-]{22}$/.test(handle)) params.set('id', handle);
      else params.set('forHandle', handle.startsWith('@') ? handle : `@${handle}`);
      const res = await fetchImpl(`${API}?${params}`);
      if (!res.ok) throw new Error(`YouTube API ${res.status}: ${await res.text()}`);
      const body = await res.json();
      const channel = body.items?.[0];
      if (!channel) throw new NotFoundError(`ערוץ יוטיוב לא נמצא: ${handle}`);
      const stats = channel.statistics ?? {};
      return {
        name: channel.snippet?.title,
        bio: channel.snippet?.description?.slice(0, 500) || undefined,
        avatar_url: channel.snippet?.thumbnails?.medium?.url ?? channel.snippet?.thumbnails?.default?.url,
        followers: stats.hiddenSubscriberCount ? undefined : Number(stats.subscriberCount),
        posts_count: Number(stats.videoCount) || undefined,
        avg_views: stats.videoCount > 0 ? Math.round(Number(stats.viewCount) / Number(stats.videoCount)) : undefined,
      };
    },
  };
}

export class NotFoundError extends Error {}
