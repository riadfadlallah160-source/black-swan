export const CONFIG = Object.freeze({
  creatorAddress: '0xf744573cdfFC211163c11c0a31730851Da78f708',
  chainId: 8453,
  issuanceRail: 'clanker-v4',

  // Throughput / discovery: rank broadly, release nine best fresh packages per cycle.
  scoreThreshold: 65,
  targetPackagesPerScan: 9,
  maxCandidatesPerScan: 180,
  targetPackagesPerHour: 108,

  // Two-stream Clanker V4 economics:
  // 1) creator LP rewards in Base USDC
  // 2) 10% founder supply: 3% 1-day airdrop + 7% 7-day vault
  clanker: {
    pairedToken: 'USDC',
    initialMarketCapUsdc: 10000,
    earlyAirdropPercentage: 3,
    earlyAirdropLockupSeconds: 24 * 60 * 60,
    earlyAirdropVestingSeconds: 0,
    founderVaultPercentage: 7,
    founderVaultLockupSeconds: 7 * 24 * 60 * 60,
    founderVaultVestingSeconds: 0,
    devBuyEth: 0,
    staticFeeBps: 100,
    rewardFeePreference: 'Paired',
    sniperFees: {
      startingFee: 666777,
      endingFee: 41673,
      secondsToDecay: 15
    },
    rewardRecipientBps: 10000
  },

  exitPolicy: {
    minLiquidityUsd: 50000,
    min24hOrganicVolumeUsd: 100000,
    maxSlippageBps: 150,
    maxSaleVs24hVolumeBps: 100,
    maxFounderBagSoldPer24hBps: 1500,
    milestones: [
      { multiple: 3, sellFounderBagBps: 500 },
      { multiple: 5, sellFounderBagBps: 1000 },
      { multiple: 10, sellFounderBagBps: 1500 },
      { multiple: 20, sellFounderBagBps: 2000 },
      { multiple: 50, sellFounderBagBps: 2000 },
      { multiple: 100, sellFounderBagBps: 1500 }
    ],
    reserveFounderBagBps: 1500
  },

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
      'https://trends.google.com/trending/rss?geo=CA',
      'https://trends.google.com/trending/rss?geo=AU',
      'https://trends.google.com/trending/rss?geo=NG',
      'https://trends.google.com/trending/rss?geo=IN',
      'https://trends.google.com/trending/rss?geo=BR',
      'https://trends.google.com/trending/rss?geo=MX',
      'https://trends.google.com/trending/rss?geo=ZA',
      'https://trends.google.com/trending/rss?geo=PH',
      'https://trends.google.com/trending/rss?geo=SG',
      'https://trends.google.com/trending/rss?geo=AE'
    ],
    googleNews: [
      'https://news.google.com/rss/search?q=viral%20meme%20OR%20internet%20trend&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=gaming%20viral%20OR%20technology%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=funny%20viral%20OR%20internet%20culture&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=consumer%20technology%20launch%20OR%20gaming%20launch&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=celebrity%20trend%20OR%20viral%20celebrity&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=sports%20viral%20OR%20sports%20meme&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=AI%20viral%20OR%20robot%20viral%20OR%20space%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=streamer%20viral%20OR%20youtube%20viral%20OR%20tiktok%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=movie%20viral%20OR%20tv%20viral%20OR%20music%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=animal%20viral%20OR%20weird%20internet%20OR%20funny%20trend&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=product%20viral%20OR%20app%20viral%20OR%20gadget%20viral&hl=en-US&gl=US&ceid=US:en',
      'https://news.google.com/rss/search?q=internet%20challenge%20OR%20catchphrase%20viral%20OR%20meme%20trend&hl=en-US&gl=US&ceid=US:en'
    ],
    coinGeckoTrending: 'https://api.coingecko.com/api/v3/search/trending'
  }
});
