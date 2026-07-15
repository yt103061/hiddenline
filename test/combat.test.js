import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import battlepass from '../data/battlepass.json' with { type: 'json' };
import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import boards from '../data/boards.json' with { type: 'json' };
import { buildFormation, chooseFirstTurn, createGame, createGameFromFormations, shuffleFormationPieces, swapFormationPieces } from '../src/state.js';
import {
  applyMove, bridgeEdges, canonicalPosition, checkVictory, generateMovesForPiece, hqCell,
  isHqContinuation, logicalNeighbors, resolveCombat,
} from '../src/rules.js';
import { DIFFICULTIES, evaluateMove } from '../src/ai.js';
import { PROTOCOL_VERSION, selectRandomPair } from '../src/online.js';
import { battleMessage, logLine } from '../src/text.js';

const attackers = Object.keys(combat.matrix);
const defenders = piecesData.pieces.map((piece) => piece.id).filter((id) => id !== 'flag');

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
  assert.equal(resolveCombat(combat, attacker, 'trap').trapSelfRemove, false, `${attacker} leaves the defending trap on the board`);
}

assert.equal(resolveCombat(combat, 'sp_eagle', 'trap').result, 'WIN');
assert.equal(resolveCombat(combat, 'sp_mouse', 'trap').result, 'WIN');
assert.equal(battlepass.rewardTable.length, 50, 'battle pass has all 50 levels');
assert.equal(PROTOCOL_VERSION, 4, 'online protocol is versioned for matchmaking and current rules');
assert.deepEqual(
  selectRandomPair([
    { id: 'later', joinedAt: 20 },
    { id: 'first-b', joinedAt: 10 },
    { id: 'first-a', joinedAt: 10 },
  ]).map((player) => player.id),
  ['first-a', 'first-b'],
  'random matchmaking pairs the earliest two waiting players deterministically',
);
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

assert.deepEqual(
  piecesData.pieces.filter((piece) => piece.count_casual > 0).map((piece) => piece.id),
  ['rank_01', 'rank_02', 'rank_03', 'rank_04', 'rank_05', 'rank_06', 'sp_snake', 'sp_eagle', 'sp_rhino', 'sp_mouse', 'trap'],
  'casual keeps six headquarters occupiers and five signature special pieces',
);
assert.ok(
  piecesData.pieces.filter((piece) => piece.count_casual > 0 && piece.canCapture).length === 6,
  'casual includes all six headquarters occupiers',
);
assert.equal(piecesData.pieces.find((piece) => piece.id === 'rank_09').count_classic, 4, 'classic uses four rabbits');
assert.equal(piecesData.pieces.find((piece) => piece.id === 'flag').count_classic, 1, 'classic includes one flag');

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
  generateMovesForPiece(officerState, officerState.pieces[0], piecesData).some((move) => move.to.x === 1 && move.to.y === 0),
  'non-capturing piece can enter the enemy headquarters',
);
const officerHqMove = generateMovesForPiece(officerState, officerState.pieces[0], piecesData)
  .find((move) => move.to.x === 1 && move.to.y === 0);
const officerAtHq = applyMove(officerState, officerHqMove, piecesData, combat);
assert.notEqual(officerAtHq.winner, 'south', 'non-capturing piece does not win by entering headquarters');

const generalState = structuredClone(officerState);
generalState.pieces[0].type = 'rank_01';
const winningMove = generateMovesForPiece(generalState, generalState.pieces[0], piecesData)
  .find((move) => move.to.x === 1 && move.to.y === 0);
assert.ok(winningMove, 'general can enter the enemy headquarters');
const wonAtHq = applyMove(generalState, winningMove, piecesData, combat);
assert.equal(wonAtHq.winner, 'south', 'surviving general wins on enemy headquarters entry');
assert.equal(wonAtHq.reason, 'hq');

const noCapturerDraw = checkVictory({
  mode: 'casual',
  board: boards.casual,
  pieces: [
    { id: 'south-spy', owner: 'south', type: 'sp_snake', x: 0, y: 6, alive: true },
    { id: 'north-spy', owner: 'north', type: 'sp_snake', x: 0, y: 0, alive: true },
  ],
}, piecesData);
assert.equal(noCapturerDraw.winner, 'draw', 'game is drawn when both sides lose every headquarters occupier');
assert.equal(noCapturerDraw.reason, 'noCapturers');

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

const cavalryBoard = { cols: 7, rows: 7, riverRow: 99, bridges: [] };
const cavalryState = {
  board: cavalryBoard,
  turn: 'south',
  pieces: [{ id: 'cavalry', owner: 'south', type: 'sp_deer', x: 3, y: 4, alive: true }],
};
const cavalryTargets = generateMovesForPiece(cavalryState, cavalryState.pieces[0], piecesData)
  .map((move) => `${move.to.x},${move.to.y}`);
for (const target of ['3,3', '3,2', '2,4', '4,4', '3,5']) {
  assert.ok(cavalryTargets.includes(target), `cavalry can move to ${target}`);
}
const blockedCavalryState = structuredClone(cavalryState);
blockedCavalryState.pieces.push({ id: 'blocker', owner: 'south', type: 'rank_09', x: 3, y: 3, alive: true });
assert.ok(
  !generateMovesForPiece(blockedCavalryState, blockedCavalryState.pieces[0], piecesData).some((move) => move.to.x === 3 && move.to.y === 2),
  'cavalry cannot jump over the first forward cell to reach the second',
);

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
assert.equal(afterTrap.pieces.find((piece) => piece.id === 'trap').alive, true, 'trap remains after successful defense');
assert.equal(afterTrap.pieces.some((piece) => piece.revealed), false, 'combat never reveals either piece');
assert.ok(afterTrap.pieces.every((piece) => !(piece.history || []).join(' ').includes('trap')), 'piece history stores results without enemy types');
const trapEvent = afterTrap.log.at(-1);
const southBattleText = battleMessage(trapEvent, piecesData, { south: 'あなた', north: '相手' }, 'south');
assert.match(southBattleText, /相手の伏せ駒/, 'battle message hides the enemy type');
assert.doesNotMatch(southBattleText, /ハチの巣/, 'battle message does not disclose an enemy trap');
assert.match(logLine(trapEvent, piecesData, { south: 'あなた', north: '相手' }, 'south'), /相手の伏せ駒/, 'battle log hides the enemy type');

const supportedFlagState = {
  board,
  turn: 'south',
  moveCount: 0,
  maxMoves: 120,
  strength: {},
  pieces: [
    { id: 'rabbit', owner: 'south', type: 'rank_09', x: 0, y: 2, alive: true, history: [] },
    { id: 'south_lion', owner: 'south', type: 'rank_01', x: 4, y: 6, alive: true, history: [] },
    { id: 'flag', owner: 'north', type: 'flag', x: 0, y: 1, alive: true, history: [] },
    { id: 'flag_support', owner: 'north', type: 'rank_01', x: 0, y: 0, alive: true, history: [] },
  ],
};
const afterSupportedFlag = applyMove(supportedFlagState, { pieceId: 'rabbit', from: { x: 0, y: 2 }, to: { x: 0, y: 1 }, targetId: 'flag' }, piecesData, combat);
assert.equal(afterSupportedFlag.pieces.find((piece) => piece.id === 'rabbit').alive, false, 'flag borrows the strength of the friendly piece behind it');
assert.equal(afterSupportedFlag.pieces.find((piece) => piece.id === 'flag').alive, true, 'supported flag survives when its borrowed rank wins');

const unsupportedFlagState = structuredClone(supportedFlagState);
unsupportedFlagState.pieces = unsupportedFlagState.pieces.filter((piece) => piece.id !== 'flag_support');
const afterUnsupportedFlag = applyMove(unsupportedFlagState, { pieceId: 'rabbit', from: { x: 0, y: 2 }, to: { x: 0, y: 1 }, targetId: 'flag' }, piecesData, combat);
assert.equal(afterUnsupportedFlag.pieces.find((piece) => piece.id === 'rabbit').alive, true, 'any movable piece defeats an unsupported flag');
assert.equal(afterUnsupportedFlag.pieces.find((piece) => piece.id === 'flag').alive, false, 'unsupported flag is removed');

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
  pieces: [
    { id: 'e', owner: 'south', type: 'sp_eagle', x: 1, y: 6, alive: true },
    { id: 'friend', owner: 'south', type: 'rank_01', x: 1, y: 4, alive: true },
    { id: 'enemy', owner: 'north', type: 'rank_06', x: 1, y: 2, alive: true },
  ],
};
assert.ok(
  generateMovesForPiece(casualFlyerState, casualFlyerState.pieces[0], piecesData).some((move) => move.to.x === 1 && move.to.y === 1),
  'eagle can fly over friendly pieces, enemy pieces, and the river',
);

for (const mode of ['casual', 'classic']) {
  const bridgePositions = bridgeEdges(boards[mode]).flat();
  const bridgeCells = new Set(bridgePositions.map((pos) => `${pos.x},${pos.y}`));
  const waterY = boards[mode].riverRow - 1;
  for (const preset of ['balanced', 'attack', 'defense']) {
    const game = createGame(mode, preset);
    for (const piece of game.pieces) {
      if (piece.type === 'trap') {
        assert.ok(!bridgeCells.has(`${piece.x},${piece.y}`), `${mode}/${preset}: trap stays off bridge positions`);
        const ownHq = hqCell(boards[mode], piece.owner);
        assert.notDeepEqual({ x: piece.x, y: piece.y }, { x: ownHq.x, y: ownHq.y }, `${mode}/${preset}: trap stays out of headquarters`);
      }
      assert.notEqual(piece.y, waterY, `${mode}/${preset}: no piece starts on the water row`);
    }
  }

  const editable = buildFormation(mode, 'balanced', 'south');
  const ownHq = hqCell(boards[mode], 'south');
  const trapIndex = editable.findIndex((piece) => piece.type === 'trap');
  const hqIndex = editable.findIndex((piece) => piece.x === ownHq.x && piece.y === ownHq.y);
  assert.equal(swapFormationPieces(editable, trapIndex, hqIndex, boards[mode]), editable, `${mode}: manual swap rejects a trap in headquarters`);
  let seed = 17;
  const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shuffled = shuffleFormationPieces(editable, boards[mode], random);
    assert.ok(shuffled.filter((piece) => piece.type === 'trap').every((piece) => piece.x !== ownHq.x || piece.y !== ownHq.y), `${mode}: shuffle keeps traps out of headquarters`);
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
  assert.match(definition.asset, /\.png$/, `${definition.asset} uses the approved illustrated asset set`);
  const image = await readFile(new URL(`../${definition.asset}`, import.meta.url));
  assert.ok(image.length > 10_000, `${definition.asset} contains a production image`);
}
const backImage = await readFile(new URL(`../${piecesData.backAsset}`, import.meta.url));
assert.ok(backImage.length > 10_000, 'piece back contains the approved illustrated asset');

console.log('rules, composite headquarters, fair AI, assets, and data integrity tests passed');
