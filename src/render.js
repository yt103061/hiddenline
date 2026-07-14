import { pieceById, isWater, isIsland, bridgeEdges } from './rules.js';
import { pieceEmoji, BACK_EMOJI, cellTitle, logLine, moveCountText } from './text.js';

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
  const pos = { x, y };
  const water = isWater(state.board, pos);
  const island = isIsland(state.board, pos);
  const cell = document.createElement('button');

  cell.type = 'button';
  cell.className = `cell ${water ? 'water' : ''} ${island ? 'island' : ''}`.trim();
  cell.dataset.x = x;
  cell.dataset.y = y;
  if (water) cell.tabIndex = -1;

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
      cell.append(tokenEl(piece.owner, BACK_EMOJI, 'back'));
    } else if (piece.type === 'base') {
      cell.classList.add('base-cell');
      cell.textContent = '🪹';
    } else {
      cell.append(tokenEl(piece.owner, pieceEmoji(def)));
    }
  }

  cell.onclick = () => handlers.onCell?.(x, y, piece);
  cell.oncontextmenu = (event) => {
    event.preventDefault();
    handlers.onInspect?.(piece);
  };

  return cell;
}

function tokenEl(owner, emoji, extraClass = '') {
  const token = document.createElement('div');
  token.className = `token ${owner} ${extraClass}`.trim();
  token.innerHTML = `<span class="token-face">${emoji}</span>`;
  return token;
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

export function renderBridges(svgEl, board, viewer) {
  const flip = viewer === 'north';
  const cx = (x) => (flip ? board.cols - (x + 0.5) : x + 0.5);
  const cy = (y) => (flip ? board.rows - (y + 0.5) : y + 0.5);

  svgEl.setAttribute('viewBox', `0 0 ${board.cols} ${board.rows}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  svgEl.innerHTML = bridgeEdges(board)
    .flatMap(({ island, banks }) => banks.map((bank) => {
      const x1 = cx(bank.x), y1 = cy(bank.y), x2 = cx(island.x), y2 = cy(island.y);
      return `
        <line class="bridge-rope" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="bridge-deck" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="bridge-slats" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
    }))
    .join('');
}

export function renderHud(el, state, data, ui) {
  const bottom = ui.viewer;
  const top = bottom === 'south' ? 'north' : 'south';

  for (const [panelEl, owner] of [[el.hudTop, top], [el.hudBottom, bottom]]) {
    if (!panelEl) continue;
    const dead = state.pieces.filter((piece) => piece.owner === owner && !piece.alive);
    const active = state.turn === owner && !state.winner;
    panelEl.className = `hud-player ${owner} ${active ? 'active' : ''}`.trim();
    panelEl.innerHTML = `
      <span class="hud-turn-dot" aria-hidden="true"></span>
      <span class="hud-name">${ui.names[owner]}</span>
      <div class="hud-captured" aria-label="取られた駒">
        ${dead.map((piece) => `<span class="mini-token ${owner}">${pieceEmoji(pieceById(data, piece.type))}</span>`).join('')
          || '<span class="hud-none">まだ取られていません</span>'}
      </div>`;
  }
}

export function message(text) {
  document.querySelector('#status').textContent = text;
}
