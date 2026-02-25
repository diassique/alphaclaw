export const BULL_WORDS = new Map<string, number>([
  // Classic bullish
  ["bullish", 1], ["moon", 2], ["mooning", 2], ["pump", 1], ["pumping", 1],
  ["rally", 1], ["rallying", 1], ["surge", 2], ["surging", 2],
  ["breakout", 2], ["ath", 2], ["adoption", 1], ["accumulate", 1],
  ["buy", 1], ["long", 1], ["uptrend", 1], ["green", 1], ["gains", 1],
  ["profit", 1], ["strong", 1], ["support", 1], ["reversal", 1],
  ["explosive", 2], ["parabolic", 2], ["outperform", 1], ["institutional", 1],
  ["whale", 1], ["hodl", 1], ["accumulation", 1], ["undervalued", 1],
  ["opportunity", 1], ["catalyst", 1], ["bullrun", 2], ["recovery", 1],
  ["rebound", 1], ["momentum", 1], ["positive", 1], ["growth", 1],
  ["expand", 1], ["rise", 1], ["rising", 1],
  // Market action
  ["divergence", 1], ["breakaway", 1], ["retest", 1], ["higher", 1],
  ["lows", 1], ["bounce", 1], ["reclaim", 1], ["flip", 1],
  ["rip", 1], ["send", 1], ["launch", 1], ["ignite", 1],
  // Crypto slang
  ["wagmi", 2], ["lfg", 2], ["fomo", 1], ["diamond", 1], ["degen", 1],
  ["alpha", 1], ["hopium", 1], ["chad", 1], ["based", 1],
  ["airdrop", 1], ["lambo", 1], ["supercycle", 2], ["flippening", 2],
  // Financial / TA
  ["overbought", 1], ["oversold", 1], ["bid", 1], ["inflow", 1],
  ["upgrade", 1], ["approval", 1], ["etf", 1], ["halving", 1],
  ["unlocked", 1], ["staking", 1], ["yield", 1], ["tvl", 1],
  // Fundamentals
  ["partnership", 1], ["integration", 1], ["launch", 1], ["mainnet", 1],
  ["upgrade", 1], ["audit", 1], ["listing", 1], ["backed", 1],
]);

export const BEAR_WORDS = new Map<string, number>([
  // Classic bearish
  ["bearish", 1], ["dump", 1], ["dumping", 1], ["crash", 2], ["crashing", 2],
  ["correction", 1], ["downtrend", 1], ["red", 1], ["sell", 1], ["short", 1],
  ["resistance", 1], ["breakdown", 1], ["capitulation", 2], ["panic", 1],
  ["fear", 1], ["fud", 1], ["rug", 2], ["scam", 2], ["overvalued", 1],
  ["bubble", 1], ["liquidation", 2], ["rekt", 2], ["weak", 1],
  ["decline", 1], ["plunge", 1], ["bleed", 1], ["distribution", 1],
  ["downfall", 1], ["collapse", 2], ["warning", 1], ["risk", 1],
  ["volatile", 1], ["uncertainty", 1],
  // Market action
  ["rejection", 1], ["failed", 1], ["lower", 1], ["highs", 1],
  ["drain", 1], ["exit", 1], ["outflow", 1], ["depeg", 2],
  ["exploit", 2], ["hack", 2], ["breach", 2], ["compromised", 2],
  // Crypto slang
  ["ngmi", 2], ["copium", 1], ["paper", 1], ["wen", 1],
  ["ponzi", 2], ["rugpull", 2], ["bagholder", 1], ["underwater", 1],
  ["nuke", 2], ["wrecked", 2], ["dumped", 1], ["tanking", 1],
  // Financial / TA
  ["overbought", 1], ["margin", 1], ["call", 1], ["delisted", 2],
  ["ban", 2], ["regulation", 1], ["lawsuit", 1], ["sec", 1],
  ["subpoena", 2], ["freeze", 1], ["sanctions", 1], ["default", 1],
  // Fundamentals
  ["vulnerability", 2], ["insolvency", 2], ["bankrupt", 2], ["shutdown", 2],
  ["delay", 1], ["abandoned", 1], ["fork", 1], ["centralized", 1],
]);

export const STRONG_BULL = new Set(["moon", "mooning", "parabolic", "explosive", "breakout", "ath", "surge", "surging", "bullrun", "wagmi", "lfg", "supercycle", "flippening"]);
export const STRONG_BEAR = new Set(["crash", "crashing", "rug", "rugpull", "rekt", "wrecked", "capitulation", "liquidation", "collapse", "exploit", "hack", "depeg", "nuke", "insolvency", "bankrupt"]);

export const BULL_PHRASES = new Map<string, number>([
  ["short squeeze", 3], ["golden cross", 3], ["higher lows", 2], ["higher highs", 2],
  ["buy signal", 2], ["bull flag", 2], ["cup handle", 2], ["trend reversal", 2],
  ["price discovery", 2], ["all time high", 3], ["smart money", 2], ["whale accumulation", 3],
  ["strong support", 2], ["bullish divergence", 3], ["oversold bounce", 2], ["demand zone", 2],
]);

export const BEAR_PHRASES = new Map<string, number>([
  ["blow off top", 3], ["dead cat bounce", 3], ["death cross", 3], ["lower highs", 2],
  ["lower lows", 2], ["sell signal", 2], ["bear flag", 2], ["head shoulders", 2],
  ["rug pull", 3], ["exit scam", 3], ["bank run", 3], ["margin call", 2],
  ["bearish divergence", 3], ["supply zone", 2], ["resistance rejection", 2], ["sell off", 2],
]);

export const NEGATIONS = new Set(["not", "no", "never", "neither", "hardly", "barely", "dont", "doesn't", "isn't", "aren't", "won't", "can't", "wasn't", "weren't"]);
