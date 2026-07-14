import pass from '../data/battlepass.json' with { type: 'json' };

const KEY = 'hidden-line-battlepass';

export function loadProgress() {
  return JSON.parse(localStorage.getItem(KEY) || '{"bp":0,"claimed":[]}');
}

export function saveProgress(progress) {
  localStorage.setItem(KEY, JSON.stringify(progress));
  return progress;
}

export function levelForBp(bp) {
  return Math.min(pass.levels, Math.floor(bp / 100) + 1);
}

export function grantBattlePoints(amount = 40) {
  const progress = loadProgress();
  progress.bp += amount;
  progress.level = levelForBp(progress.bp);
  return saveProgress(progress);
}

export function rewardsUpTo(level, tier = 'free') {
  return pass.rewardTable.filter((reward) => reward.lv <= level).map((reward) => ({ lv: reward.lv, reward: reward[tier] }));
}

export function purchaseHook(tier) {
  return { ok: false, tier, message: 'Payment integration is reserved for the online phase.' };
}
