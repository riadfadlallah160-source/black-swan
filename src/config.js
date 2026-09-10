export const CONFIG = Object.freeze({
  creatorAddress: '0xf744573cdfFC211163c11c0a31730851Da78f708',
  scoreThreshold: 88,
  maxCandidatesPerScan: 100,
  maxLaunchesPerMinute: 2,
  initialMarketCapUsd: 10000,
  creatorFeeSplitBps: 8000,
  sniperProtection: true,
  blockedNarrativeTerms: [
    '9/11','911','september 11','terror','terrorist','massacre','killed','dead','death','bomb','shooting','war casualty','hostage','suicide'
  ],
  feeds: {
    googleTrends: [
      'https://trends.google.com/trending/rss?geo=US',
      'https://trends.google.com/trending/rss?geo=GB',
      'https://trends.google.com/trending/rss?geo=NG'
    ],
    googleNews: [
      'https://news.google.com/rss/search?q=viral%20meme%20OR%20internet%20trend&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=gaming%20viral%20OR%20technology%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=celebrity%20viral%20OR%20sports%20viral&hl=en-US&gl=US&ceid=US:en'
    ],
    coinGeckoTrending: 'https://api.coingecko.com/api/v3/search/trending'
  }
});
