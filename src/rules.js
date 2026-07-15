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

export function hqCell(board, owner) {
  if (!board.hq) return null;
  return {
    x: board.hq.anchorX,
    y: owner === 'south' ? board.rows - 1 : 0,
    span: board.hq.span || 1,
  };
}

export function hqFootprint(board, owner) {
  const hq = hqCell(board, owner);
  if (!hq) return [];
  return Array.from({ length: hq.span }, (_, offset) => ({ x: hq.x + offset, y: hq.y }));
}

export function canonicalPosition(board, pos) {
  for (const owner of PLAYERS) {
    const hq = hqCell(board, owner);
    if (hq && pos.y === hq.y && pos.x >= hq.x && pos.x < hq.x + hq.span) {
      return { x: hq.x, y: hq.y };
    }
  }
  return { x: pos.x, y: pos.y };
}

export function isHqContinuation(board, pos) {
  const canonical = canonicalPosition(board, pos);
  return canonical.x !== pos.x || canonical.y !== pos.y;
}

export function waterRowY(board) {
  return board.riverRow - 1;
}

export function isIsland(board, pos) {
  return pos.y === waterRowY(board) && (board.bridges ?? []).some((bridge) => bridge.island === pos.x);
}

export function isWater(board, pos) {
  return pos.y === waterRowY(board) && !isIsland(board, pos);
}

export function bridgeEdges(board) {
  const waterY = waterRowY(board);
  const bridges = board.bridges ?? [];
  const edges = [];

  for (const bridge of bridges) {
    const island = { x: bridge.island, y: waterY };
    for (const bank of bridge.banks) {
      edges.push([{ x: bank, y: waterY - 1 }, island]);
      edges.push([{ x: bank, y: waterY + 1 }, island]);
    }
  }

  for (const a of bridges) {
    for (const b of bridges) {
      if (b.island - a.island === 1) edges.push([{ x: a.island, y: waterY }, { x: b.island, y: waterY }]);
    }
  }

  return edges;
}

export function bridgeNeighbors(board, pos) {
  const neighbors = [];
  for (const [a, b] of bridgeEdges(board)) {
    if (a.x === pos.x && a.y === pos.y) neighbors.push(b);
    else if (b.x === pos.x && b.y === pos.y) neighbors.push(a);
  }
  return neighbors;
}

export function hqOwnerAt(board, pos) {
  for (const owner of PLAYERS) {
    const hq = hqCell(board, owner);
    if (hq && pos.y === hq.y && pos.x >= hq.x && pos.x < hq.x + hq.span) return owner;
  }
  return null;
}

export function logicalNeighbors(board, pos) {
  const canonical = canonicalPosition(board, pos);
  const owner = hqOwnerAt(board, canonical);
  const sources = owner ? hqFootprint(board, owner) : [canonical];
  const neighbors = new Map();

  for (const source of sources) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const physical = { x: source.x + dx, y: source.y + dy };
      if (!inBounds(board, physical)) continue;
      const target = canonicalPosition(board, physical);
      if (target.x === canonical.x && target.y === canonical.y) continue;
      neighbors.set(cellKey(target), target);
    }
  }

  return [...neighbors.values()];
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
  const target = canonicalPosition(state.board, pos);
  return state.pieces.find((piece) => {
    const piecePos = canonicalPosition(state.board, piece);
    return piece.alive && piecePos.x === target.x && piecePos.y === target.y;
  });
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
  const moveKeys = new Set();
  const from = canonicalPosition(board, piece);
  const fromHqOwner = hqOwnerAt(board, from);
  const sources = fromHqOwner ? hqFootprint(board, fromHqOwner) : [from];

  const add = (x, y, slide = false, pathFrom = from) => {
    const physicalTo = { x, y };
    if (!inBounds(board, physicalTo)) return false;
    if (isWater(board, physicalTo)) return false;
    const to = canonicalPosition(board, physicalTo);
    if (to.x === from.x && to.y === from.y) return true;

    if (!canEnter(board, pathFrom, physicalTo, definition.move)) return false;
    if (slide && !isPathClear(state, pathFrom, physicalTo)) return false;

    const destinationHq = hqOwnerAt(board, to);
    if (destinationHq && destinationHq !== piece.owner && !definition.canCapture) return false;

    const occupant = occupantAt(state, to);
    if (occupant?.owner === piece.owner) return false;

    const key = cellKey(to);
    if (moveKeys.has(key)) return !occupant;
    moveKeys.add(key);

    moves.push({ pieceId: piece.id, from, to, targetId: occupant?.id ?? null });
    return !occupant;
  };

  const addBridge = (x, y) => {
    const to = { x, y };
    if (!inBounds(board, to)) return;
    if (moves.some((move) => move.to.x === x && move.to.y === y)) return;
    const occupant = occupantAt(state, to);
    if (occupant?.owner === piece.owner) return;
    const destinationHq = hqOwnerAt(board, to);
    if (destinationHq && destinationHq !== piece.owner && !definition.canCapture) return;
    const key = cellKey(to);
    if (moveKeys.has(key)) return;
    moveKeys.add(key);
    moves.push({ pieceId: piece.id, from, to, targetId: occupant?.id ?? null, via: 'bridge' });
  };

  if (definition.move === 'step1') {
    for (const target of logicalNeighbors(board, from)) add(target.x, target.y);
  }

  if (definition.move === 'cavalry') {
    for (const source of sources) {
      for (const [dx, dy] of [[0, 2 * forward], [0, -forward], [1, 0], [-1, 0]]) {
        add(source.x + dx, source.y + dy, false, source);
      }
    }
  }

  if (definition.move === 'runner') {
    for (const source of sources) {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        for (let distance = 1; ; distance += 1) {
          const x = source.x + dx * distance;
          const y = source.y + dy * distance;
          if (!add(x, y, true, source)) break;
        }
      }
    }
  }

  if (definition.move === 'flyer') {
    for (const source of sources) {
      for (const dy of [1, -1]) {
        for (let distance = 1; ; distance += 1) {
          const physicalTo = { x: source.x, y: source.y + dy * distance };
          if (!inBounds(board, physicalTo)) break;
          if (isWater(board, physicalTo)) continue;

          const to = canonicalPosition(board, physicalTo);
          const destinationHq = hqOwnerAt(board, to);
          if (destinationHq && destinationHq !== piece.owner && !definition.canCapture) continue;

          const occupant = occupantAt(state, to);
          if (occupant?.owner === piece.owner) continue;
          const key = cellKey(to);
          if (moveKeys.has(key)) continue;
          moveKeys.add(key);
          moves.push({ pieceId: piece.id, from, to, targetId: occupant?.id ?? null });
        }
      }
      add(source.x + 1, source.y, false, source);
      add(source.x - 1, source.y, false, source);
    }
  }

  for (const source of sources) {
    for (const neighbor of bridgeNeighbors(board, source)) addBridge(neighbor.x, neighbor.y);
  }

  return moves;
}

export function generateLegalMoves(state, data, owner = state.turn) {
  return state.pieces.filter((piece) => piece.owner === owner).flatMap((piece) => generateMovesForPiece(state, piece, data));
}

export function resolveCombat(combat, attackerType, defenderType) {
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
  const destination = canonicalPosition(next.board, move.to);
  const target = occupantAt(next, destination);

  next.log ||= [];
  if (!piece || !piece.alive) throw new Error('Invalid move');

  if (!target) {
    piece.x = destination.x;
    piece.y = destination.y;
  } else {
    const combatResult = resolveCombat(combat, piece.type, target.type);
    const event = { attacker: piece.type, defender: target.type, result: combatResult.result, attackerOwner: piece.owner };

    piece.history = [...(piece.history || []), `combat: ${combatResult.result}`];
    target.history = [...(target.history || []), `combat: ${invertResult(combatResult.result)}`];
    next.log.push(event);

    if (combatResult.attackerRemoved) piece.alive = false;
    else {
      piece.x = destination.x;
      piece.y = destination.y;
    }

    if (combatResult.defenderRemoved) target.alive = false;
  }

  const hqOwner = hqOwnerAt(next.board, piece);
  const definition = pieceById(data, piece.type);
  if (!next.winner && piece.alive && definition?.canCapture && hqOwner && hqOwner !== piece.owner) {
    next.winner = piece.owner;
    next.reason = 'hq';
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

  const capturersByOwner = Object.fromEntries(PLAYERS.map((owner) => [
    owner,
    state.pieces.filter((piece) => piece.owner === owner && piece.alive && pieceById(data, piece.type)?.canCapture),
  ]));
  if (!capturersByOwner.north.length && !capturersByOwner.south.length) {
    state.winner = 'draw';
    state.reason = 'noCapturers';
    return state;
  }

  for (const owner of PLAYERS) {
    const movablePieces = state.pieces.filter((piece) => piece.owner === owner && piece.alive && pieceById(data, piece.type)?.move !== 'none');
    const capturers = capturersByOwner[owner];

    if (!movablePieces.length || !capturers.length) {
      state.winner = owner === 'south' ? 'north' : 'south';
      state.reason = capturers.length ? 'surrender' : 'noCapturer';
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
