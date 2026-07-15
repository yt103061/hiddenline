import { generateLegalMoves, occupantAt, hqOwnerAt, hqCell, flagStrengthType } from './rules.js';

export const DIFFICULTIES = {
  beginner: { depth: 1, inference: false, omniscient: false, noise: 8 },
  intermediate: { depth: 1, inference: true, omniscient: false, noise: 3 },
  advanced: { depth: 2, inference: true, omniscient: false, noise: 1 },
  oni: { depth: 3, inference: true, omniscient: true, noise: 0 },
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
  let score = (state.board.rows - 1 - move.to.y) * 2;

  if (target) {
    if (config.omniscient) {
      score += combatScore(combat.matrix[piece.type]?.[flagStrengthType(state, target)]);
    } else if (config.inference) {
      score += expectedHiddenCombatScore(state, piece.type, target.owner, data, combat);
    } else {
      score += 2;
    }
  }

  if (hqOwnerAt(state.board, move.to) === 'south') score += 999;

  const enemyHq = hqCell(state.board, 'south');
  const hqDistance = enemyHq
    ? Math.min(...Array.from({ length: enemyHq.span }, (_, offset) => (
      Math.abs(move.to.x - (enemyHq.x + offset)) + Math.abs(move.to.y - enemyHq.y)
    )))
    : Infinity;
  if (Number.isFinite(hqDistance)) score += 20 - hqDistance * 2;

  return score;
}

function combatScore(result) {
  if (!result) return 2;
  return result === 'WIN' ? 50 : result === 'DRAW' ? 8 : -25;
}

function expectedHiddenCombatScore(state, attackerType, targetOwner, data, combat) {
  const candidates = [];
  for (const definition of data.pieces) {
    const initialCount = definition[`count_${state.mode}`] || 0;
    for (let index = 0; index < initialCount; index += 1) candidates.push(definition.id);
  }
  if (!candidates.length) return 2;
  return candidates.reduce((sum, type) => sum + combatScore(combat.matrix[attackerType]?.[type]), 0) / candidates.length;
}

export function updateInference(candidates, result) {
  return candidates.filter((id) => result.possible?.includes?.(id) ?? true);
}
