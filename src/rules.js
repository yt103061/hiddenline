export const PLAYERS = ['north', 'south'];

export function pieceById(data, id) {
  const list = Array.isArray(data) ? data : data.pieces;
  return list.find((piece) => piece.id === id);
}

export function cellKey(pos) {
  return `${pos.x},${pos.y}`;
}

export function inBounds(board, pos) {
  return pos.x >= 0 && pos.y >= 0 && pos.x < board.cols && pos.y < board.rows;
}

export function waterRowY(board) {
  return board.riverRow - 1;
}

export function isIsland(board, pos) {
  return pos.y === waterRowY(board) && (board.bridgeIslands ?? []).includes(pos.x);
}

export function isWater(board, pos) {
  return pos.y === waterRowY(board) && !isIsland(board, pos);
}

export function bridgeEdges(board) {
  const waterY = waterRowY(board);
  return (board.bridgeIslands ?? []).map((x) => ({
    island: { x, y: waterY },
    banks: [
      { x: x - 1, y: waterY - 1 },
      { x: x + 1, y: waterY - 1 },
      { x: x - 1, y: waterY + 1 },
      { x: x + 1, y: waterY + 1 },
    ],
  }));
}

function spansWaterRow(board, from, to) {
  if (from.x !== to.x) return false;
  const waterY = waterRowY(board);
  return Math.min(from.y, to.y) < waterY && Math.max(from.y, to.y) > waterY;
}

export function canEnter(board, from, to, moveType) {
  if (!inBounds(board, to)) return false;
  if (moveType === 'flyer') return true;
  if (isWater(board, to)) return false;
  if (isIsland(board, from) || isIsland(board, to)) return false;
  if (spansWaterRow(board, from, to)) return false;
  return true;
}

export function occupantAt(state, pos) {
  return state.pieces.find((piece) => piece.alive && piece.x === pos.x && piece.y === pos.y);
}

export function isPathClear(state, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;

  while (x !== to.x || y !== to.y) {
    if (occupantAt(state, { x, y })) return false;
    x += dx;
    y += dy;
  }

  return true;
}

export function generateMovesForPiece(state, piece, data) {
  if (!piece.alive) return [];

  const definition = pieceById(data, piece.type);
  if (!definition || definition.move === 'none') return [];

  const board = state.board;
  const forward = piece.owner === 'south' ? -1 : 1;
  const moves = [];

  const add = (x, y, slide = false) => {
    const from = { x: piece.x, y: piece.y };
    const to = { x, y };

    if (!inBounds(board, to) || !canEnter(board, from, to, definition.move)) return false;
    if (slide && !isPathClear(state, from, to)) return false;

    const occupant = occupantAt(state, to);
    if (occupant?.owner === piece.owner) return false;

    moves.push({ pieceId: piece.id, from, to, targetId: occupant?.id ?? null });
    return !occupant;
  };

  const addBridge = (x, y) => {
    const to = { x, y };
    if (!inBounds(board, to)) return;
    const occupant = occupantAt(state, to);
    if (occupant?.owner === piece.owner) return;
    moves.push({ pieceId: piece.id, from: { x: piece.x, y: piece.y }, to, targetId: occupant?.id ?? null, via: 'bridge' });
  };

  if (definition.move === 'step1') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(piece.x + dx, piece.y + dy);
  }

  if (definition.move === 'cavalry') {
    for (const [dx, dy] of [[0, 2 * forward], [0, -forward], [1, 0], [-1, 0]]) add(piece.x + dx, piece.y + dy);
  }

  if (definition.move === 'runner' || definition.move === 'flyer') {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (let distance = 1; ; distance += 1) {
        const x = piece.x + dx * distance;
        const y = piece.y + dy * distance;
        if (definition.move === 'flyer' && dx !== 0 && distance > 1) break;
        if (definition.move === 'flyer' && isWater(board, { x, y })) {
          if (!inBounds(board, { x, y })) break;
          continue;
        }
        if (!add(x, y, true)) break;
      }
    }
  }

  for (const bridge of bridgeEdges(board)) {
    if (piece.x === bridge.island.x && piece.y === bridge.island.y) {
      for (const bank of bridge.banks) addBridge(bank.x, bank.y);
    } else {
      const fromBank = bridge.banks.some((bank) => bank.x === piece.x && bank.y === piece.y);
      if (fromBank) addBridge(bridge.island.x, bridge.island.y);
    }
  }

  return moves;
}

export function generateLegalMoves(state, data, owner = state.turn) {
  return state.pieces.filter((piece) => piece.owner === owner).flatMap((piece) => generateMovesForPiece(state, piece, data));
}

export function resolveCombat(combat, attackerType, defenderType) {
  if (defenderType === 'base') {
    return { result: 'BASE', attackerRemoved: false, defenderRemoved: false, trapSelfRemove: false };
  }

  const result = combat.matrix[attackerType]?.[defenderType];
  if (!result) throw new Error(`Missing combat result ${attackerType} vs ${defenderType}`);

  return {
    result,
    attackerRemoved: result !== 'WIN',
    defenderRemoved: result !== 'LOSE' || defenderType === 'trap',
    trapSelfRemove: defenderType === 'trap' && result === 'LOSE',
  };
}

export function applyMove(state, move, data, combat) {
  const next = structuredClone(state);
  const piece = next.pieces.find((candidate) => candidate.id === move.pieceId);
  const target = occupantAt(next, move.to);

  next.log ||= [];
  if (!piece || !piece.alive) throw new Error('Invalid move');

  if (!target) {
    piece.x = move.to.x;
    piece.y = move.to.y;
  } else if (target.type === 'base' && pieceById(data, piece.type).canCapture) {
    piece.x = move.to.x;
    piece.y = move.to.y;
    next.winner = piece.owner;
    next.reason = 'base';
  } else {
    const combatResult = resolveCombat(combat, piece.type, target.type);
    const event = { attacker: piece.type, defender: target.type, result: combatResult.result, attackerOwner: piece.owner };

    target.revealed = true;
    piece.revealed = true;
    piece.history = [...(piece.history || []), `vs ${target.type}: ${combatResult.result}`];
    target.history = [...(target.history || []), `vs ${piece.type}: ${invertResult(combatResult.result)}`];
    next.log.push(event);

    if (combatResult.attackerRemoved) piece.alive = false;
    else {
      piece.x = move.to.x;
      piece.y = move.to.y;
    }

    if (combatResult.defenderRemoved) target.alive = false;
  }

  next.moveCount = (next.moveCount || 0) + 1;
  next.turn = piece.owner === 'south' ? 'north' : 'south';
  return checkVictory(next, data);
}

function invertResult(result) {
  if (result === 'WIN') return 'LOSE';
  if (result === 'LOSE') return 'WIN';
  return result;
}

export function checkVictory(state, data) {
  if (state.winner) return state;

  for (const owner of PLAYERS) {
    const movablePieces = state.pieces.filter((piece) => piece.owner === owner && piece.alive && pieceById(data, piece.type)?.move !== 'none');
    const capturers = state.pieces.filter((piece) => piece.owner === owner && piece.alive && pieceById(data, piece.type)?.canCapture);

    if (!movablePieces.length || !capturers.length) {
      state.winner = owner === 'south' ? 'north' : 'south';
      state.reason = 'surrender';
      return state;
    }
  }

  if ((state.moveCount || 0) >= state.maxMoves) {
    const score = Object.fromEntries(
      PLAYERS.map((owner) => [
        owner,
        state.pieces
          .filter((piece) => piece.owner === owner && piece.alive)
          .reduce((sum, piece) => sum + (state.strength[piece.type] || 0), 0),
      ]),
    );

    state.winner = score.south === score.north ? 'draw' : score.south > score.north ? 'south' : 'north';
    state.reason = 'tiebreak';
  }

  return state;
}
