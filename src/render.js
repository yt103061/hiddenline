import {
  pieceById, isWater, isIsland, bridgeEdges, hqOwnerAt, hqCell, isHqContinuation,
} from './rules.js';
import { cellTitle, hqTitle, logLine, moveCountText } from './text.js';

export function renderBoard(boardEl, state, data, ui, handlers = {}) {
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--cols', state.board.cols);
  boardEl.style.setProperty('--rows', state.board.rows);
  boardEl.classList.toggle('flipped', ui.viewer === 'north');
  boardEl.setAttribute('role', 'grid');
  boardEl.setAttribute('aria-label', ui.boardLabel || '対局盤');

  const ys = range(state.board.rows, ui.viewer === 'north');
  const xs = range(state.board.cols, ui.viewer === 'north');
  for (const y of ys) {
    for (const x of xs) {
      if (isHqContinuation(state.board, { x, y })) continue;
      boardEl.append(createCell(state, data, x, y, ui, handlers));
    }
  }


  const focusTarget = boardEl.querySelector(`[data-pid="${ui.selected || ''}"]`)
    || boardEl.querySelector('.cell:not(.water)');
  if (focusTarget) focusTarget.tabIndex = 0;
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
  cell.tabIndex = -1;
  cell.setAttribute('role', 'gridcell');
  if (water) cell.disabled = true;

  const hqOwner = hqOwnerAt(state.board, pos);
  if (hqOwner) {
    cell.classList.add('hq', hqOwner);
    cell.title = hqTitle(hqOwner, ui.names);
    const hq = hqCell(state.board, hqOwner);
    cell.style.gridColumn = `span ${hq.span}`;
    cell.dataset.span = hq.span;
  }

  if (ui.lastMove) {
    if (ui.lastMove.from.x === x && ui.lastMove.from.y === y) cell.classList.add('last-from');
    if (ui.lastMove.to.x === x && ui.lastMove.to.y === y) cell.classList.add('last-to');
  }

  if (piece) {
    const def = pieceById(data, piece.type);
    const hidden = piece.owner !== ui.viewer;

    cell.classList.add(piece.owner);
    cell.dataset.pid = piece.id;
    cell.title = cellTitle(piece, def, ui.viewer, ui.names);

    if (hidden) {
      cell.append(tokenEl(piece.owner, data.backAsset, '伏せ駒', 'back'));
    } else {
      cell.append(tokenEl(piece.owner, def.asset, def.name));
    }
  }


  const label = accessibleCellLabel(state, data, pos, piece, ui, hqOwner);
  cell.dataset.baseLabel = label;
  cell.setAttribute('aria-label', label);
  cell.setAttribute('aria-selected', 'false');
  if (water) cell.setAttribute('aria-disabled', 'true');

  cell.onclick = () => handlers.onCell?.(x, y, piece);
  cell.oncontextmenu = (event) => {
    event.preventDefault();
    handlers.onInspect?.(piece);
  };
  cell.onkeydown = (event) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      focusByDirection(boardElFor(cell), cell, event.key);
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      handlers.onInspect?.(piece);
    }
  };

  return cell;
}

export function tokenEl(owner, asset, label, extraClass = '') {
  const token = document.createElement('div');
  token.className = `token ${owner} ${extraClass}`.trim();
  const image = document.createElement('img');
  image.className = 'token-face';
  image.src = asset;
  image.alt = '';
  image.draggable = false;
  const fallback = document.createElement('span');
  fallback.className = 'token-fallback';
  fallback.textContent = label.slice(0, 1);
  image.onerror = () => token.classList.add('asset-error');
  token.append(image, fallback);
  return token;
}

function boardElFor(cell) {
  return cell.closest('.board');
}

function focusByDirection(boardEl, current, key) {
  if (!boardEl) return;
  const currentRect = current.getBoundingClientRect();
  const from = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 };
  const candidates = [...boardEl.querySelectorAll('.cell:not(.water)')]
    .filter((cell) => cell !== current)
    .map((cell) => {
      const rect = cell.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - from.x;
      const dy = rect.top + rect.height / 2 - from.y;
      return { cell, dx, dy };
    })
    .filter(({ dx, dy }) => (
      (key === 'ArrowRight' && dx > 1)
      || (key === 'ArrowLeft' && dx < -1)
      || (key === 'ArrowDown' && dy > 1)
      || (key === 'ArrowUp' && dy < -1)
    ))
    .sort((a, b) => {
      const vertical = key === 'ArrowUp' || key === 'ArrowDown';
      const aScore = (vertical ? Math.abs(a.dy) : Math.abs(a.dx)) + (vertical ? Math.abs(a.dx) : Math.abs(a.dy)) * 3;
      const bScore = (vertical ? Math.abs(b.dy) : Math.abs(b.dx)) + (vertical ? Math.abs(b.dx) : Math.abs(b.dy)) * 3;
      return aScore - bScore;
    });
  const next = candidates[0]?.cell;
  if (!next) return;
  for (const cell of boardEl.querySelectorAll('.cell')) cell.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

function coordinateLabel(board, pos, hqOwner) {
  const start = String.fromCharCode(97 + pos.x);
  const row = pos.y + 1;
  if (!hqOwner) return `${start}${row}`;
  const hq = hqCell(board, hqOwner);
  const end = String.fromCharCode(97 + pos.x + hq.span - 1);
  return `${start}${row}から${end}${row}`;
}

function accessibleCellLabel(state, data, pos, piece, ui, hqOwner) {
  const parts = [coordinateLabel(state.board, pos, hqOwner)];
  if (hqOwner) parts.push(hqTitle(hqOwner, ui.names));
  if (piece) parts.push(cellTitle(piece, pieceById(data, piece.type), ui.viewer, ui.names));
  else if (!isWater(state.board, pos)) parts.push('空きマス');
  return parts.join('、');
}

export function updateSelection(boardEl, ui) {
  for (const cell of boardEl.querySelectorAll('.sel, .move-dot, .attack-target')) {
    cell.classList.remove('sel', 'move-dot', 'attack-target');
  }
  for (const cell of boardEl.querySelectorAll('.cell')) {
    cell.setAttribute('aria-selected', 'false');
    if (cell.dataset.baseLabel) cell.setAttribute('aria-label', cell.dataset.baseLabel);
  }

  if (!ui.selected) return;

  const selectedCell = boardEl.querySelector(`[data-pid="${ui.selected}"]`);
  selectedCell?.classList.add('sel');
  selectedCell?.setAttribute('aria-selected', 'true');
  if (selectedCell) selectedCell.setAttribute('aria-label', `${selectedCell.dataset.baseLabel}、選択中`);
  for (const move of ui.selectedMoves) {
    const cell = boardEl.querySelector(`[data-x="${move.to.x}"][data-y="${move.to.y}"]`);
    cell?.classList.add(move.targetId ? 'attack-target' : 'move-dot');
    if (cell) cell.setAttribute('aria-label', `${cell.dataset.baseLabel}、${move.targetId ? '攻撃可能' : '移動可能'}`);
  }
}

export function renderLog(logEl, state, data, names, viewer) {
  logEl.innerHTML = (state.log || [])
    .slice(-6)
    .reverse()
    .map((event) => `<li>${logLine(event, data, names, viewer)}</li>`)
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
        ${dead.map((piece) => {
          const def = pieceById(data, piece.type);
          return `<span class="mini-token ${owner}" title="${def.name}"><img src="${def.asset}" alt="" /></span>`;
        }).join('')
          || '<span class="hud-none">まだ取られていません</span>'}
      </div>`;
  }
}
