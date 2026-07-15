import boards from '../../../data/boards.json' with { type: 'json' };
import piecesData from '../../../data/pieces.json' with { type: 'json' };
import combat from '../../../data/combat_matrix.json' with { type: 'json' };
import { chooseAiMove } from '../../../src/ai.js';
import { applyMove, bridgeEdges, canonicalPosition, generateMovesForPiece, hqOwnerAt, waterRowY } from '../../../src/rules.js';
import { buildFormation, createGameFromFormations } from '../../../src/state.js';
import { ResponseError } from './server.ts';

type Owner = 'south' | 'north';
type Position = { x: number; y: number };
type GamePiece = Position & { id: string; owner: Owner; type: string; alive: boolean; history?: string[] };
type Move = { pieceId: string; from: Position; to: Position; targetId?: string | null };
type GameState = any;

function fail(message: string): never {
  throw new ResponseError(400, message);
}

function validPosition(position: Position) {
  return Number.isInteger(position?.x) && Number.isInteger(position?.y);
}

function expectedCounts(mode: string) {
  return new Map<string, number>(piecesData.pieces.map((piece: any) => [piece.id, Number(piece[`count_${mode}`] || 0)]));
}

function trapRestricted(board: any, position: Position) {
  if (hqOwnerAt(board, position)) return true;
  const waterY = waterRowY(board);
  return bridgeEdges(board).flat().some((cell) => cell.y !== waterY && cell.x === position.x && cell.y === position.y);
}

export function validateFormation(mode: string, formation: GamePiece[], owner: Owner) {
  const board = (boards as Record<string, any>)[mode];
  if (!board || !Array.isArray(formation)) fail('配置データが不正です。');

  const expected = expectedCounts(mode);
  const expectedTotal = [...expected.values()].reduce((sum, count) => sum + count, 0);
  if (formation.length !== expectedTotal) fail('駒数がルールと一致しません。');

  const actual = new Map<string, number>();
  const occupied = new Set<string>();
  const pieceIds = new Set<string>();
  const allowedRows = new Set(owner === 'south' ? board.deployRows : board.deployRows.map((row) => board.rows - 1 - row));

  for (const piece of formation) {
    if (!piece || typeof piece.id !== 'string' || piece.owner !== owner || !expected.has(piece.type) || !validPosition(piece)) fail('配置に不正な駒があります。');
    if (pieceIds.has(piece.id)) fail('同じ駒IDが重複しています。');
    if (!allowedRows.has(piece.y) || piece.x < 0 || piece.x >= board.cols) fail('配置可能エリアの外です。');
    const canonical = canonicalPosition(board, piece);
    if (canonical.x !== piece.x || canonical.y !== piece.y) fail('本陣の右半分は独立したマスではありません。');
    const key = `${piece.x},${piece.y}`;
    if (occupied.has(key)) fail('同じマスに複数の駒があります。');
    if (piece.type === 'trap' && trapRestricted(board, piece)) fail('ハチの巣（罠）は本陣または橋の入口へ配置できません。');
    occupied.add(key);
    pieceIds.add(piece.id);
    actual.set(piece.type, (actual.get(piece.type) || 0) + 1);
  }

  for (const [type, count] of expected) if ((actual.get(type) || 0) !== count) fail('駒の種類と枚数がルールと一致しません。');

  return formation.map((piece) => ({
    id: piece.id,
    owner,
    type: piece.type,
    x: piece.x,
    y: piece.y,
    alive: true,
    history: [],
  }));
}

export function initialState(mode: string, southFormation: GamePiece[], northFormation: GamePiece[]) {
  const south = validateFormation(mode, southFormation, 'south');
  const north = validateFormation(mode, northFormation, 'north');
  return createGameFromFormations(mode, south, north, 'south') as GameState;
}

export function cpuFormation(mode: string) {
  return buildFormation(mode, 'balanced', 'north') as GamePiece[];
}

export function applyAuthorizedMove(state: GameState, move: Move, owner: Owner) {
  if (!state || state.winner) fail('この対局はすでに終了しています。');
  if (state.turn !== owner) fail('あなたの手番ではありません。');
  if (!move || !validPosition(move.from) || !validPosition(move.to) || typeof move.pieceId !== 'string') fail('移動データが不正です。');

  const piece = state.pieces.find((candidate: GamePiece) => candidate.id === move.pieceId && candidate.owner === owner && candidate.alive);
  if (!piece) fail('移動できる駒ではありません。');
  const legalMove = generateMovesForPiece(state, piece, piecesData).find((candidate) => (
    candidate.from.x === move.from.x && candidate.from.y === move.from.y
    && candidate.to.x === move.to.x && candidate.to.y === move.to.y
  ));
  if (!legalMove) fail('ルール上移動できない手です。');
  return { state: applyMove(state, legalMove, piecesData, combat) as GameState, move: legalMove as Move };
}

export function chooseCpuMove(state: GameState, cpuRank = 'small_iii') {
  return chooseAiMove(state, piecesData, combat, cpuRank) as Move | null;
}

export function publicMove(move: Move) {
  return { from: move.from, to: move.to, attacked: Boolean(move.targetId) };
}

export function projectState(state: GameState, viewer: Owner) {
  return {
    ...state,
    pieces: state.pieces.map((piece: GamePiece, index: number) => piece.owner === viewer ? piece : {
      ...piece,
      id: `hidden_${piece.owner}_${index}`,
      type: 'hidden',
      history: (piece.history || []).map((entry) => entry.replace(/vs\s+\S+:/, 'vs hidden:')),
    }),
    log: (state.log || []).map((event: any) => ({
      ...event,
      attacker: event.attackerOwner === viewer ? event.attacker : 'hidden',
      defender: event.attackerOwner === viewer ? 'hidden' : event.defender,
    })),
  };
}
