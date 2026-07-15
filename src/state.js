import boards from '../data/boards.json' with { type: 'json' };
import piecesData from '../data/pieces.json' with { type: 'json' };
import { bridgeEdges, waterRowY, canonicalPosition, isHqContinuation } from './rules.js';

export function buildFormation(mode = 'casual', preset = 'balanced', owner = 'south') {
  const board = boards[mode];
  const pieceList = piecesData.pieces.flatMap((piece) =>
    Array.from({ length: piece[`count_${mode}`] || 0 }, (_, index) => ({ type: piece.id, index })),
  );
  return formation(pieceList, preset, owner, board);
}

export function createGameFromFormations(mode = 'casual', south, north, firstTurn = 'south') {
  const board = boards[mode];
  return {
    mode,
    board,
    turn: firstTurn,
    moveCount: 0,
    maxMoves: boards.maxMoves,
    strength: boards.strengthPointsForTiebreak,
    clocks: { south: boards.clockSec, north: boards.clockSec },
    pieces: [...south, ...north],
  };
}

export function chooseFirstTurn(random = Math.random) {
  return random() < 0.5 ? 'south' : 'north';
}

export function createGame(mode = 'casual', preset = 'balanced') {
  const south = buildFormation(mode, preset, 'south');
  const north = buildFormation(mode, 'balanced', 'north');
  return createGameFromFormations(mode, south, north);
}

export function formation(pieceList, preset, owner, board) {
  const sorted = [...pieceList].sort((a, b) => compareForPreset(a.type, b.type, preset));
  const rows = owner === 'south'
    ? [...board.deployRows].reverse()
    : board.deployRows.map((row) => board.rows - 1 - row).sort((a, b) => a - b);
  const cells = deploymentCells(rows, owner, board, sorted.length);
  keepStaticPiecesOffBridgeEnds(sorted, cells, board);

  return sorted.map((item, index) => ({
    id: `${owner}_${item.type}_${item.index}`,
    owner,
    type: item.type,
    x: cells[index].x,
    y: cells[index].y,
    alive: true,
    revealed: false,
    history: [],
  }));
}

function deploymentCells(rows, owner, board, needed) {
  const expandedRows = [...rows];
  let nextRow = owner === 'south' ? Math.min(...rows) - 1 : Math.max(...rows) + 1;

  while (logicalCellsForRows(expandedRows, board).length < needed && nextRow >= 0 && nextRow < board.rows) {
    expandedRows.push(nextRow);
    nextRow += owner === 'south' ? -1 : 1;
  }

  return logicalCellsForRows(expandedRows, board);
}

function logicalCellsForRows(rows, board) {
  return rows.flatMap((y) => Array.from({ length: board.cols }, (_, x) => ({ x, y })))
    .filter((cell) => !isHqContinuation(board, cell))
    .map((cell) => canonicalPosition(board, cell));
}

function compareForPreset(typeA, typeB, preset) {
  if (typeA === 'trap' || typeB === 'trap') {
    if (typeA === typeB) return 0;
    return typeA === 'trap' ? -1 : 1;
  }

  const a = strengthScore(typeA);
  const b = strengthScore(typeB);
  if (preset === 'attack') return a - b;
  if (preset === 'defense') return b - a;
  return Math.abs(a - 50) - Math.abs(b - 50);
}

function strengthScore(type) {
  return {
    rank_01: 100,
    rank_02: 94,
    rank_03: 88,
    rank_04: 82,
    rank_05: 76,
    rank_06: 70,
    rank_07: 54,
    rank_08: 48,
    rank_09: 42,
    sp_snake: 64,
    sp_eagle: 68,
    sp_rhino: 62,
    sp_deer: 58,
    sp_mouse: 52,
  }[type] ?? 50;
}

export function revealForViewer(state, viewer) {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({
      ...piece,
      hidden: piece.owner !== viewer && !piece.revealed && piece.alive,
    })),
  };
}

export function swapFormationPieces(formation, indexA, indexB) {
  const newFormation = [...formation];
  if (indexA >= 0 && indexB >= 0 && indexA < newFormation.length && indexB < newFormation.length) {
    const a = newFormation[indexA];
    const b = newFormation[indexB];
    newFormation[indexA] = { ...a, x: b.x, y: b.y };
    newFormation[indexB] = { ...b, x: a.x, y: a.y };
  }
  return newFormation;
}

function keepStaticPiecesOffBridgeEnds(sorted, cells, board) {
  const waterY = waterRowY(board);
  const blocked = new Set(
    bridgeEdges(board)
      .flat()
      .filter((cell) => cell.y !== waterY)
      .map((cell) => `${cell.x},${cell.y}`),
  );
  const isBlocked = (index) => blocked.has(`${cells[index].x},${cells[index].y}`);

  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].type !== 'trap') continue;
    if (!isBlocked(index)) continue;

    const swapIndex = cells.findIndex((cell, candidateIndex) =>
      candidateIndex !== index
      && candidateIndex < sorted.length
      && !isBlocked(candidateIndex)
      && sorted[candidateIndex].type !== 'trap',
    );
    if (swapIndex !== -1) [sorted[index], sorted[swapIndex]] = [sorted[swapIndex], sorted[index]];
  }
}
