import { createYouTubeProvider } from './youtube.js';
import { createInstagramProvider } from './instagram.js';
import { createTikTokProvider } from './tiktok.js';
import { createDemoProvider } from './demo.js';

export { NotFoundError } from './youtube.js';

/** Builds the platform → provider map from environment configuration. */
export function createProviders(env = process.env) {
  const byPlatform = {};
  if (env.YOUTUBE_API_KEY) byPlatform.youtube = createYouTubeProvider({ apiKey: env.YOUTUBE_API_KEY });
  if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    byPlatform.instagram = createInstagramProvider({
      accessToken: env.INSTAGRAM_ACCESS_TOKEN,
      businessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    });
  }
  if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) {
    byPlatform.tiktok = createTikTokProvider({ clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET });
  }
  return { byPlatform, demo: createDemoProvider() };
}
