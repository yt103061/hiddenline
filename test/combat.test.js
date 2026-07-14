import assert from 'node:assert/strict';
import battlepass from '../data/battlepass.json' with { type: 'json' };
import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import { createGame } from '../src/state.js';
import { applyMove, generateMovesForPiece, resolveCombat } from '../src/rules.js';

const attackers = Object.keys(combat.matrix);
const defenders = piecesData.pieces.map((piece) => piece.id).filter((id) => id !== 'base');

for (const attacker of attackers) {
  assert.notEqual(attacker, 'trap', 'trap must not be an attacker row');
  for (const defender of defenders) {
    assert.ok(combat.matrix[attacker][defender], `${attacker} vs ${defender} is explicit`);
    assert.match(combat.matrix[attacker][defender], /^(WIN|LOSE|DRAW)$/);
    if (attacker === defender) assert.equal(combat.matrix[attacker][defender], 'DRAW', `${attacker} mirror is DRAW`);
  }
}

for (const [attacker, result] of Object.entries(combat.trapDefense.vs)) {
  assert.equal(combat.matrix[attacker].trap, result, `trapDefense mirrors matrix for ${attacker}`);
}

for (const attacker of attackers.filter((id) => !['sp_eagle', 'sp_mouse'].includes(id))) {
  assert.equal(resolveCombat(combat, attacker, 'trap').trapSelfRemove, true, `${attacker} triggers trap self removal`);
}

assert.equal(resolveCombat(combat, 'sp_eagle', 'trap').result, 'WIN');
assert.equal(resolveCombat(combat, 'sp_mouse', 'trap').result, 'WIN');
assert.equal(battlepass.rewardTable.length, 50, 'battle pass has all 50 levels');
assert.equal(createGame('casual').pieces.filter((piece) => piece.owner === 'south').length, 10, 'casual has 10 pieces per side');
assert.equal(createGame('classic').pieces.filter((piece) => piece.owner === 'south').length, 23, 'classic has 23 pieces per side');

const board = { cols: 6, rows: 6, riverRow: 3, crossings: [1, 3, 4] };
const movementState = {
  board,
  turn: 'south',
  pieces: [
    { id: 'm', owner: 'south', type: 'sp_mouse', x: 2, y: 5, alive: true },
    { id: 'b', owner: 'south', type: 'base', x: 0, y: 5, alive: true },
  ],
};

assert.ok(
  generateMovesForPiece(movementState, movementState.pieces[0], piecesData).some((move) => move.to.x === 2 && move.to.y === 4),
  'runner can move vertically',
);
assert.equal(generateMovesForPiece(movementState, movementState.pieces[1], piecesData).length, 0, 'base cannot move');

const trapState = {
  board,
  turn: 'south',
  moveCount: 0,
  maxMoves: 120,
  strength: {},
  pieces: [
    { id: 'lion', owner: 'south', type: 'rank_01', x: 0, y: 1, alive: true, history: [] },
    { id: 'trap', owner: 'north', type: 'trap', x: 0, y: 0, alive: true, history: [] },
    { id: 'south_base', owner: 'south', type: 'base', x: 5, y: 5, alive: true, history: [] },
    { id: 'north_base', owner: 'north', type: 'base', x: 5, y: 0, alive: true, history: [] },
    { id: 'north_lion', owner: 'north', type: 'rank_01', x: 4, y: 0, alive: true, history: [] },
  ],
};
const afterTrap = applyMove(trapState, { pieceId: 'lion', from: { x: 0, y: 1 }, to: { x: 0, y: 0 }, targetId: 'trap' }, piecesData, combat);
assert.equal(afterTrap.pieces.find((piece) => piece.id === 'lion').alive, false, 'attacker dies to trap');
assert.equal(afterTrap.pieces.find((piece) => piece.id === 'trap').alive, false, 'trap self-removes after successful defense');

console.log('combat matrix, data integrity, and core movement tests passed');
