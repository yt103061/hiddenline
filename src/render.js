import { pieceById } from './rules.js';
import { BACK_ASSET, pieceAsset, cellTitle, logLine, moveCountText } from './text.js';

export function renderBoard(boardEl, state, data, ui, handlers = {}) {
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--cols', state.board.cols);
  boardEl.style.setProperty('--rows', state.board.rows);
  boardEl.classList.toggle('flipped', ui.viewer === 'north');

  const ys = range(state.board.rows, ui.viewer === 'north');
  const xs = range(state.board.cols, ui.viewer === 'north');
  for (const y of ys) {
    for (const x of xs) {
      boardEl.append(createCell(state, data, x, y, ui, handlers));
    }
  }
}

function range(count, reversed) {
  const values = Array.from({ length: count }, (_, index) => index);
  return reversed ? values.reverse() : values;
}

function createCell(state, data, x, y, ui, handlers) {
  const piece = state.pieces.find((candidate) => candidate.alive && candidate.x === x && candidate.y === y);
  const river = y === state.board.riverRow - 1;
  const crossing = state.board.crossings.includes(x);
  const cell = document.createElement('button');

  cell.type = 'button';
  cell.className = `cell ${river ? 'river' : ''} ${crossing ? 'crossing' : ''}`;
  cell.dataset.x = x;
  cell.dataset.y = y;

  if (ui.lastMove) {
    if (ui.lastMove.from.x === x && ui.lastMove.from.y === y) cell.classList.add('last-from');
    if (ui.lastMove.to.x === x && ui.lastMove.to.y === y) cell.classList.add('last-to');
  }

  if (piece) {
    const def = pieceById(data, piece.type);
    const hidden = piece.owner !== ui.viewer && !piece.revealed;

    cell.classList.add(piece.owner);
    cell.dataset.pid = piece.id;
    cell.title = cellTitle(piece, def, ui.viewer, ui.names);

    if (hidden) {
      cell.append(pieceImage(BACK_ASSET, '伏せ駒'));
    } else if (piece.type === 'base') {
      cell.classList.add('base-cell');
      cell.textContent = '🪹';
    } else {
      cell.append(pieceImage(pieceAsset(def), def.name));
    }
  }

  cell.onclick = () => handlers.onCell?.(x, y, piece);
  cell.oncontextmenu = (event) => {
    event.preventDefault();
    handlers.onInspect?.(piece);
  };

  return cell;
}

function pieceImage(src, alt) {
  const img = document.createElement('img');
  img.className = 'piece';
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  return img;
}

export function updateSelection(boardEl, ui) {
  for (const cell of boardEl.querySelectorAll('.sel, .move-dot, .attack-target')) {
    cell.classList.remove('sel', 'move-dot', 'attack-target');
  }

  if (!ui.selected) return;

  boardEl.querySelector(`[data-pid="${ui.selected}"]`)?.classList.add('sel');
  for (const move of ui.selectedMoves) {
    const cell = boardEl.querySelector(`[data-x="${move.to.x}"][data-y="${move.to.y}"]`);
    cell?.classList.add(move.targetId ? 'attack-target' : 'move-dot');
  }
}

export function renderLog(logEl, state, data, names) {
  logEl.innerHTML = (state.log || [])
    .slice(-6)
    .reverse()
    .map((event) => `<li>${logLine(event, data, names)}</li>`)
    .join('');
}

export function renderInfo(infoEl, state) {
  infoEl.textContent = moveCountText(state);
}

export function message(text) {
  document.querySelector('#status').textContent = text;
}
