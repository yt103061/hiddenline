import { generateLegalMoves, occupantAt, pieceById } from './rules.js';

export const DIFFICULTIES = {
  beginner: { depth: 1, inference: false, noise: 8 },
  intermediate: { depth: 1, inference: true, noise: 3 },
  advanced: { depth: 2, inference: true, noise: 1 },
  oni: { depth: 3, inference: true, noise: 0 },
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
    if (target.type === 'base' && pieceById(data, piece.type).canCapture) score += 999;
    const result = combat.matrix[piece.type]?.[target.type];
    score += result === 'WIN' ? 50 : result === 'DRAW' ? 8 : -25;
    if (!config.inference && !target.revealed) score -= 10;
  }

  const southBase = state.pieces.find((candidate) => candidate.owner === 'south' && candidate.type === 'base');
  if (southBase) score += 20 - (Math.abs(move.to.x - southBase.x) + Math.abs(move.to.y - southBase.y)) * 2;

  return score;
}

export function updateInference(candidates, result) {
  return candidates.filter((id) => result.possible?.includes?.(id) ?? true);
}
