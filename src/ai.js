import { generateLegalMoves, occupantAt, hqOwnerAt, hqCell, flagStrengthType, logicalNeighbors, pieceById } from './rules.js';
import { CPU_RANK_CONFIGS } from './rank.js';

export const DIFFICULTIES = {
  beginner: { depth: 1, inference: false, omniscient: false, noise: 8, aggression: 5, caution: 8 },
  intermediate: { depth: 1, inference: true, omniscient: false, noise: 3, aggression: 12, caution: 24 },
  advanced: { depth: 2, inference: true, omniscient: false, noise: 1, aggression: 16, caution: 34 },
  oni: { depth: 3, inference: true, omniscient: true, noise: 0, aggression: 18, caution: 42 },
  ...CPU_RANK_CONFIGS,
};

export function chooseAiMove(state, data, combat, difficulty = 'intermediate') {
  const config = DIFFICULTIES[difficulty] || DIFFICULTIES.intermediate;
  const moves = generateLegalMoves(state, data, 'north');
  if (!moves.length) return null;

  return moves
    .map((move) => ({ move, score: evaluateMove(state, move, data, combat, config) + Math.random() * config.noise }))
    .sort((a, b) => b.score - a.score)[0].move;
}

export function evaluateMove(state, move, data, combat, config) {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  const target = occupantAt(state, move.to);
  const definition = pieceById(data, piece.type);
  let score = move.to.y * 2;

  if (target) {
    if (config.omniscient) {
      score += combatScore(combat.matrix[piece.type]?.[flagStrengthType(state, target)]);
    } else if (config.inference) {
      score += expectedHiddenCombatScore(state, piece.type, target.owner, data, combat);
    } else {
      score += 2;
    }
    score += config.aggression;
  }

  if (definition?.canCapture && hqOwnerAt(state.board, move.to) === 'south') score += 999;

  const enemyHq = hqCell(state.board, 'south');
  const hqDistance = enemyHq
    ? Math.min(...Array.from({ length: enemyHq.span }, (_, offset) => (
      Math.abs(move.to.x - (enemyHq.x + offset)) + Math.abs(move.to.y - enemyHq.y)
    )))
    : Infinity;
  if (Number.isFinite(hqDistance)) score += 20 - hqDistance * 2;

  const currentDanger = adjacentThreat(state, move.from, piece, data, combat);
  const destinationDanger = adjacentThreat(state, move.to, piece, data, combat, target?.id);
  const support = adjacentFriendlyCount(state, move.to, piece.owner, piece.id);
  const caution = config.caution * (1 + (state.strength?.[piece.type] || 0) / 18) * (1 + (config.depth - 1) * 0.15);
  score -= destinationDanger * caution * Math.max(0.55, 1 - support * 0.15);
  score += Math.max(0, currentDanger - destinationDanger) * caution * 0.7;

  const ownHq = hqCell(state.board, 'north');
  if (target && ownHq && distanceToHq(target, ownHq) <= 2) score += 24;

  return score;
}

function adjacentThreat(state, position, piece, data, combat, ignoredId = null) {
  const enemies = logicalNeighbors(state.board, position)
    .map((cell) => occupantAt(state, cell))
    .filter((candidate) => candidate && candidate.id !== ignoredId && candidate.owner !== piece.owner);
  if (!enemies.length) return 0;

  const attackers = hiddenCandidates(state, enemies[0].owner, data).filter((type) => pieceById(data, type)?.move !== 'none');
  if (!attackers.length) return 0;
  const lossRisk = attackers.reduce((sum, attackerType) => {
    const result = combat.matrix[attackerType]?.[piece.type];
    return sum + (result === 'WIN' ? 1 : result === 'DRAW' ? 0.65 : result ? 0 : 0.35);
  }, 0) / attackers.length;
  return Math.min(1, lossRisk * enemies.length);
}

function adjacentFriendlyCount(state, position, owner, movingId) {
  return logicalNeighbors(state.board, position)
    .map((cell) => occupantAt(state, cell))
    .filter((piece) => piece && piece.id !== movingId && piece.owner === owner).length;
}

function distanceToHq(position, hq) {
  return Math.min(...Array.from({ length: hq.span }, (_, offset) => (
    Math.abs(position.x - (hq.x + offset)) + Math.abs(position.y - hq.y)
  )));
}

function combatScore(result) {
  if (!result) return 2;
  return result === 'WIN' ? 50 : result === 'DRAW' ? 8 : -25;
}

function expectedHiddenCombatScore(state, attackerType, targetOwner, data, combat) {
  const candidates = hiddenCandidates(state, targetOwner, data);
  if (!candidates.length) return 2;
  return candidates.reduce((sum, type) => sum + combatScore(combat.matrix[attackerType]?.[type]), 0) / candidates.length;
}

function hiddenCandidates(state, owner, data) {
  const candidates = [];
  for (const definition of data.pieces) {
    const initialCount = definition[`count_${state.mode}`] || 0;
    for (let index = 0; index < initialCount; index += 1) candidates.push(definition.id);
  }
  return candidates;
}

export function updateInference(candidates, result) {
  return candidates.filter((id) => result.possible?.includes?.(id) ?? true);
}
