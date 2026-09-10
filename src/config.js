export const CONFIG = Object.freeze({
  creatorAddress: '0xf744573cdfFC211163c11c0a31730851Da78f708',
  scoreThreshold: 88,
  maxCandidatesPerScan: 100,
  maxLaunchesPerMinute: 2,
  initialMarketCapUsd: 10000,
  creatorFeeSplitBps: 8000,
  sniperProtection: true,
  blockedNarrativeTerms: [
    '9/11','911','9 11','september 11','world trade center','bin laden','al qaeda',
    'terror','terrorist','terrorism','massacre','killed','killing','murder','murdered',
    'dead','death','fatal','bomb','bombing','explosion','shooting','gunman','war casualty',
    'hostage','suicide','memorial','funeral','assassination','genocide','victim'
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
      'https://news.google.com/rss/search?q=funny%20viral%20OR%20internet%20culture&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=consumer%20technology%20launch%20OR%20gaming%20launch&hl=en-US&gl=US&ceid=US:en'
    ],
    coinGeckoTrending: 'https://api.coingecko.com/api/v3/search/trending'
  }
});
