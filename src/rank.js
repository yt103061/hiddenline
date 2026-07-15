export const RANKS = [
  { key: 'small_iii', name: '小動物 III', min: 1000 },
  { key: 'small_ii', name: '小動物 II', min: 1100 },
  { key: 'small_i', name: '小動物 I', min: 1200 },
  { key: 'forest_iii', name: '森の動物 III', min: 1300 },
  { key: 'forest_ii', name: '森の動物 II', min: 1400 },
  { key: 'forest_i', name: '森の動物 I', min: 1500 },
  { key: 'beast_iii', name: '猛獣 III', min: 1600 },
  { key: 'beast_ii', name: '猛獣 II', min: 1700 },
  { key: 'beast_i', name: '猛獣 I', min: 1800 },
  { key: 'divine', name: '神獣', min: 1900 },
];

export const CPU_RANK_CONFIGS = {
  small_iii: { depth: 1, inference: false, omniscient: false, noise: 10, aggression: 4, caution: 7 },
  small_ii: { depth: 1, inference: false, omniscient: false, noise: 8, aggression: 6, caution: 10 },
  small_i: { depth: 1, inference: true, omniscient: false, noise: 6, aggression: 8, caution: 14 },
  forest_iii: { depth: 1, inference: true, omniscient: false, noise: 5, aggression: 10, caution: 18 },
  forest_ii: { depth: 2, inference: true, omniscient: false, noise: 4, aggression: 12, caution: 22 },
  forest_i: { depth: 2, inference: true, omniscient: false, noise: 3, aggression: 14, caution: 26 },
  beast_iii: { depth: 2, inference: true, omniscient: false, noise: 2.4, aggression: 16, caution: 30 },
  beast_ii: { depth: 3, inference: true, omniscient: false, noise: 1.8, aggression: 17, caution: 34 },
  beast_i: { depth: 3, inference: true, omniscient: false, noise: 1, aggression: 18, caution: 38 },
  divine: { depth: 4, inference: true, omniscient: false, noise: 0.4, aggression: 20, caution: 44 },
};

export function rankForRating(rating = 1000) {
  return [...RANKS].reverse().find((rank) => rating >= rank.min) || RANKS[0];
}

export function eloDelta(playerRating, opponentRating, score, k = 32) {
  const expected = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
  return Math.round(k * (score - expected));
}

export function resetSeasonRating(rating) {
  return Math.max(1000, Math.round(1000 + (rating - 1000) * 0.5));
}
