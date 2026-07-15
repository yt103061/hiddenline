import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import battlepass from '../data/battlepass.json' with { type: 'json' };
import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import boards from '../data/boards.json' with { type: 'json' };
import { buildFormation, chooseFirstTurn, createGame, createGameFromFormations } from '../src/state.js';
import {
  applyMove, bridgeEdges, canonicalPosition, generateMovesForPiece, hqCell,
  isHqContinuation, logicalNeighbors, resolveCombat,
} from '../src/rules.js';
import { DIFFICULTIES, evaluateMove } from '../src/ai.js';
import { PROTOCOL_VERSION } from '../src/online.js';
import { battleMessage, logLine } from '../src/text.js';

const attackers = Object.keys(combat.matrix);
const defenders = piecesData.pieces.map((piece) => piece.id);

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
assert.equal(PROTOCOL_VERSION, 3, 'online protocol is versioned for synchronized first-turn selection');
assert.equal(chooseFirstTurn(() => 0), 'south', 'coin toss lower half starts south');
assert.equal(chooseFirstTurn(() => 0.4999), 'south', 'coin toss boundary below half starts south');
assert.equal(chooseFirstTurn(() => 0.5), 'north', 'coin toss upper half starts north');

for (const [mode, expectedCount] of [['casual', 11], ['classic', 31]]) {
  const game = createGame(mode);
  const board = boards[mode];
  const south = game.pieces.filter((piece) => piece.owner === 'south');
  const southHq = hqCell(board, 'south');
  assert.equal(south.length, expectedCount, `${mode} has ${expectedCount} pieces per side`);
  assert.equal(new Set(south.map((piece) => `${piece.x},${piece.y}`)).size, expectedCount, `${mode} formation has no overlap`);
  assert.equal(south.filter((piece) => piece.x === southHq.x && piece.y === southHq.y).length, 1, `${mode} headquarters holds one piece`);
  assert.ok(south.every((piece) => !isHqContinuation(board, piece)), `${mode} never stores a piece on the headquarters continuation`);
  assert.equal(canonicalPosition(board, { x: southHq.x + 1, y: southHq.y }).x, southHq.x, `${mode} headquarters continuation canonicalizes to anchor`);
}

{
  const south = buildFormation('casual', 'balanced', 'south');
  const north = buildFormation('casual', 'balanced', 'north');
  assert.equal(createGameFromFormations('casual', south, north, 'north').turn, 'north', 'game accepts a randomized opening turn');
}

assert.equal(piecesData.pieces.find((piece) => piece.id === 'rank_09').count_casual, 2, 'casual adds one rabbit');
assert.equal(piecesData.pieces.find((piece) => piece.id === 'rank_09').count_classic, 5, 'classic adds one rabbit');

assert.deepEqual(
  new Set(logicalNeighbors(boards.casual, { x: 1, y: 6 }).map((pos) => `${pos.x},${pos.y}`)),
  new Set(['0,6', '3,6', '1,5', '2,5']),
  'casual south headquarters has four perimeter neighbors',
);

const hqEntryBase = {
  mode: 'casual',
  board: boards.casual,
  turn: 'south',
  moveCount: 0,
  maxMoves: 120,
  strength: boards.strengthPointsForTiebreak,
};
const officerState = {
  ...hqEntryBase,
  pieces: [
    { id: 'officer', owner: 'south', type: 'rank_07', x: 1, y: 1, alive: true },
    { id: 'north-general', owner: 'north', type: 'rank_01', x: 0, y: 1, alive: true },
    { id: 'south-general', owner: 'south', type: 'rank_01', x: 3, y: 6, alive: true },
  ],
};
assert.ok(
  !generateMovesForPiece(officerState, officerState.pieces[0], piecesData).some((move) => move.to.x === 1 && move.to.y === 0),
  'non-general cannot enter the enemy headquarters',
);

const generalState = structuredClone(officerState);
generalState.pieces[0].type = 'rank_01';
const winningMove = generateMovesForPiece(generalState, generalState.pieces[0], piecesData)
  .find((move) => move.to.x === 1 && move.to.y === 0);
assert.ok(winningMove, 'general can enter the enemy headquarters');
const wonAtHq = applyMove(generalState, winningMove, piecesData, combat);
assert.equal(wonAtHq.winner, 'south', 'surviving general wins on enemy headquarters entry');
assert.equal(wonAtHq.reason, 'hq');

const board = { cols: 6, rows: 6, riverRow: 3, bridges: [{ island: 2, banks: [1, 3] }] };
const movementState = {
  board,
  turn: 'south',
  pieces: [
    { id: 'm', owner: 'south', type: 'sp_mouse', x: 2, y: 5, alive: true },
    { id: 't', owner: 'south', type: 'trap', x: 0, y: 5, alive: true },
  ],
};

assert.ok(
  generateMovesForPiece(movementState, movementState.pieces[0], piecesData).some((move) => move.to.x === 2 && move.to.y === 4),
  'runner can move vertically',
);
assert.equal(generateMovesForPiece(movementState, movementState.pieces[1], piecesData).length, 0, 'trap cannot move');

const trapState = {
  board,
  turn: 'south',
  moveCount: 0,
  maxMoves: 120,
  strength: {},
  pieces: [
    { id: 'lion', owner: 'south', type: 'rank_01', x: 0, y: 1, alive: true, history: [] },
    { id: 'trap', owner: 'north', type: 'trap', x: 0, y: 0, alive: true, history: [] },
    { id: 'north_lion', owner: 'north', type: 'rank_01', x: 4, y: 0, alive: true, history: [] },
  ],
};
const afterTrap = applyMove(trapState, { pieceId: 'lion', from: { x: 0, y: 1 }, to: { x: 0, y: 0 }, targetId: 'trap' }, piecesData, combat);
assert.equal(afterTrap.pieces.find((piece) => piece.id === 'lion').alive, false, 'attacker dies to trap');
assert.equal(afterTrap.pieces.find((piece) => piece.id === 'trap').alive, false, 'trap self-removes after successful defense');
assert.equal(afterTrap.pieces.some((piece) => piece.revealed), false, 'combat never reveals either piece');
assert.ok(afterTrap.pieces.every((piece) => !(piece.history || []).join(' ').includes('trap')), 'piece history stores results without enemy types');
const trapEvent = afterTrap.log.at(-1);
const southBattleText = battleMessage(trapEvent, piecesData, { south: 'あなた', north: '相手' }, 'south');
assert.match(southBattleText, /相手の伏せ駒/, 'battle message hides the enemy type');
assert.doesNotMatch(southBattleText, /ハチの巣/, 'battle message does not disclose an enemy trap');
assert.match(logLine(trapEvent, piecesData, { south: 'あなた', north: '相手' }, 'south'), /相手の伏せ駒/, 'battle log hides the enemy type');

const casualBridgeState = {
  board: boards.casual,
  turn: 'south',
  pieces: [{ id: 'w', owner: 'south', type: 'rank_04', x: 0, y: 4, alive: true }],
};
assert.ok(
  generateMovesForPiece(casualBridgeState, casualBridgeState.pieces[0], piecesData).some((move) => move.to.x === 1 && move.to.y === 3),
  'bank piece can step onto island via bridge',
);

const casualFlyerState = {
  board: boards.casual,
  turn: 'south',
  pieces: [{ id: 'e', owner: 'south', type: 'sp_eagle', x: 1, y: 4, alive: true }],
};
assert.ok(
  generateMovesForPiece(casualFlyerState, casualFlyerState.pieces[0], piecesData).some((move) => move.to.y <= 1),
  'eagle can fly over the river',
);

for (const mode of ['casual', 'classic']) {
  const bridgePositions = bridgeEdges(boards[mode]).flat();
  const bridgeCells = new Set(bridgePositions.map((pos) => `${pos.x},${pos.y}`));
  const waterY = boards[mode].riverRow - 1;
  for (const preset of ['balanced', 'attack', 'defense']) {
    const game = createGame(mode, preset);
    for (const piece of game.pieces) {
      if (piece.type === 'trap') assert.ok(!bridgeCells.has(`${piece.x},${piece.y}`), `${mode}/${preset}: trap stays off bridge positions`);
      assert.notEqual(piece.y, waterY, `${mode}/${preset}: no piece starts on the water row`);
    }
  }

  const attack = buildFormation(mode, 'attack', 'south').filter((piece) => piece.type.startsWith('rank_0') && Number(piece.type.slice(-2)) <= 6);
  const defense = buildFormation(mode, 'defense', 'south').filter((piece) => piece.type.startsWith('rank_0') && Number(piece.type.slice(-2)) <= 6);
  const averageY = (formation) => formation.reduce((sum, piece) => sum + piece.y, 0) / formation.length;
  assert.ok(averageY(attack) < averageY(defense), `${mode}: attack puts generals farther forward than defense`);
}

const hiddenMove = { pieceId: 'ai', from: { x: 0, y: 1 }, to: { x: 0, y: 2 }, targetId: 'hidden' };
const hiddenState = (hiddenType) => ({
  mode: 'casual',
  board: boards.casual,
  turn: 'north',
  pieces: [
    { id: 'ai', owner: 'north', type: 'rank_04', x: 0, y: 1, alive: true, revealed: false },
    { id: 'hidden', owner: 'south', type: hiddenType, x: 0, y: 2, alive: true, revealed: false },
  ],
});
const safeLionScore = evaluateMove(hiddenState('rank_01'), hiddenMove, piecesData, combat, DIFFICULTIES.intermediate);
const safeRabbitScore = evaluateMove(hiddenState('rank_09'), hiddenMove, piecesData, combat, DIFFICULTIES.intermediate);
assert.equal(safeLionScore, safeRabbitScore, 'normal AI does not peek at a hidden target type');
assert.notEqual(
  evaluateMove(hiddenState('rank_01'), hiddenMove, piecesData, combat, DIFFICULTIES.oni),
  evaluateMove(hiddenState('rank_09'), hiddenMove, piecesData, combat, DIFFICULTIES.oni),
  'oni difficulty deliberately uses the disclosed full-information handicap',
);

for (const definition of piecesData.pieces) {
  assert.ok(definition.asset, `${definition.id} declares an asset`);
  const svg = await readFile(new URL(`../${definition.asset}`, import.meta.url), 'utf8');
  assert.match(svg, /<svg\b/);
  assert.doesNotMatch(svg, /<text\b|[\u{1F300}-\u{1FAFF}]/u, `${definition.asset} is path-based and contains no emoji text`);
}
const backSvg = await readFile(new URL(`../${piecesData.backAsset}`, import.meta.url), 'utf8');
assert.doesNotMatch(backSvg, /<text\b|[\u{1F300}-\u{1FAFF}]/u, 'piece back is path-based and contains no emoji text');

console.log('rules, composite headquarters, fair AI, assets, and data integrity tests passed');
