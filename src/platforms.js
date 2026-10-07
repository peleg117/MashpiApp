export const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X (Twitter)' },
];

export const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));

const HOSTS = [
  { re: /(^|\.)instagram\.com$/, platform: 'instagram' },
  { re: /(^|\.)tiktok\.com$/, platform: 'tiktok' },
  { re: /(^|\.)(youtube\.com|youtu\.be)$/, platform: 'youtube' },
  { re: /(^|\.)(facebook\.com|fb\.com)$/, platform: 'facebook' },
  { re: /(^|\.)(x\.com|twitter\.com)$/, platform: 'x' },
];

// Path segments that are never a profile handle.
const RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'watch', 'shorts', 'video', 'channel', 'c', 'user', 'status', 'share', 'tv']);

/** Extract { platform, handle } from a profile URL. Returns null when unrecognised. */
export function parseProfileUrl(input) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const match = HOSTS.find((h) => h.re.test(host));
  if (!match) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let handle = null;
  if (match.platform === 'youtube' && ['channel', 'c', 'user'].includes(segments[0])) {
    handle = segments[1] ?? null;
  } else {
    handle = segments.find((s) => !RESERVED.has(s.toLowerCase())) ?? null;
  }
  if (!handle) return null;
  handle = decodeURIComponent(handle).replace(/^@/, '');
  return { platform: match.platform, handle };
}

export function buildProfileUrl(platform, handle) {
  const h = String(handle).replace(/^@/, '');
  switch (platform) {
    case 'instagram': return `https://www.instagram.com/${h}/`;
    case 'tiktok': return `https://www.tiktok.com/@${h}`;
    case 'youtube': return h.startsWith('UC') && h.length === 24 ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`;
    case 'facebook': return `https://www.facebook.com/${h}`;
    case 'x': return `https://x.com/${h}`;
    default: return null;
  }
}
