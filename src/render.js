import { pieceById, isWater, isIsland, bridgeEdges, hqOwnerAt } from './rules.js';
import { pieceEmoji, BACK_EMOJI, cellTitle, hqTitle, logLine, moveCountText } from './text.js';

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

  const hqOwner = hqOwnerAt(state.board, pos);
  if (hqOwner) {
    cell.classList.add('hq', hqOwner);
    cell.title = hqTitle(hqOwner, ui.names);
  }

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

export function renderOverlay(svgEl, board, viewer) {
  const flip = viewer === 'north';
  const cx = (x) => (flip ? board.cols - (x + 0.5) : x + 0.5);
  const cy = (y) => (flip ? board.rows - (y + 0.5) : y + 0.5);

  svgEl.setAttribute('viewBox', `0 0 ${board.cols} ${board.rows}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');

  const bridges = bridgeEdges(board)
    .map(([a, b]) => {
      const x1 = cx(a.x), y1 = cy(a.y), x2 = cx(b.x), y2 = cy(b.y);
      return `
        <line class="bridge-rope" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="bridge-deck" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
        <line class="bridge-slats" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
    })
    .join('');

  svgEl.innerHTML = bridges;
  renderHqLayer(svgEl, board, viewer);
}

function renderHqLayer(svgEl, board, viewer) {
  const parent = svgEl.parentElement;
  if (!parent) return;

  let hqLayer = parent.querySelector(':scope > .hq-layer');
  if (!hqLayer) {
    hqLayer = document.createElement('div');
    hqLayer.className = 'hq-layer';
    hqLayer.setAttribute('aria-hidden', 'true');
    parent.appendChild(hqLayer);
  }

  const hqCols = board.hqCols ?? [];
  if (!hqCols.length) {
    hqLayer.innerHTML = '';
    return;
  }

  const flip = viewer === 'north';
  const colOf = (x) => (flip ? board.cols - 1 - x : x);

  hqLayer.innerHTML = ['south', 'north'].map((owner) => {
    const y = owner === 'south' ? board.rows - 1 : 0;
    const row = flip ? board.rows - 1 - y : y;
    const cols = hqCols.map(colOf).sort((a, b) => a - b);
    const left = (cols[0] / board.cols) * 100;
    const width = ((cols[cols.length - 1] + 1 - cols[0]) / board.cols) * 100;
    const top = (row / board.rows) * 100;
    const height = (1 / board.rows) * 100;
    return `<div class="hq-marker ${owner}" style="left:${left}%; top:${top}%; width:${width}%; height:${height}%">
      <span class="hq-marker-icon">🪺</span>
    </div>`;
  }).join('');
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
