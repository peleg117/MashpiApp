// Simulates live metric changes for demo profiles so the real-time pipeline can be seen
// working without API credentials. Only applied to rows flagged is_demo.
export function createDemoProvider({ random = Math.random } = {}) {
  return {
    id: 'demo',
    label: 'סימולציית דמו',
    async fetchProfile(_ref, current) {
      // Small random walk biased towards growth: roughly -0.3% .. +0.9%
      const drift = (random() * 1.2 - 0.3) / 100;
      const followers = Math.max(0, Math.round(current.followers * (1 + drift)));
      const engagement = current.engagement_rate == null ? undefined
        : Math.max(0.1, Math.round((current.engagement_rate + (random() - 0.5) * 0.2) * 100) / 100);
      return { followers, engagement_rate: engagement };
    },
  };
}
