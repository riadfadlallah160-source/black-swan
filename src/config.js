export const CONFIG = Object.freeze({
  creatorAddress: '0xf744573cdfFC211163c11c0a31730851Da78f708',
  scoreThreshold: 65,
  targetPackagesPerScan: 9,
  maxCandidatesPerScan: 36,
  maxLaunchesPerMinute: 2,
  initialMarketCapUsd: 10000,
  creatorFeeSplitBps: 8000,
  sniperProtection: true,
  unofficialDisclosure: 'Unofficial culture token. No affiliation or endorsement is claimed.',
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
      'https://trends.google.com/trending/rss?geo=NG',
      'https://trends.google.com/trending/rss?geo=CA',
      'https://trends.google.com/trending/rss?geo=AU'
    ],
    googleNews: [
      'https://news.google.com/rss/search?q=viral%20meme%20OR%20internet%20trend&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=gaming%20viral%20OR%20technology%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=funny%20viral%20OR%20internet%20culture&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=consumer%20technology%20launch%20OR%20gaming%20launch&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=celebrity%20trend%20OR%20viral%20celebrity&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=sports%20viral%20OR%20sports%20meme&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=AI%20viral%20OR%20robot%20viral%20OR%20space%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=streamer%20viral%20OR%20youtube%20viral%20OR%20tiktok%20viral&hl=en-US&gl=US&ceid=US:en'
    ],
    coinGeckoTrending: 'https://api.coingecko.com/api/v3/search/trending'
  }
});
