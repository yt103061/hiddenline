import { generateLegalMoves } from './rules.js';

const EMOJI = {
  rank_01: '🦁',
  rank_02: '🐯',
  rank_03: '🐻',
  rank_04: '🐺',
  rank_05: '🐆',
  rank_06: '🐗',
  rank_07: '🦊',
  rank_08: '🦝',
  rank_09: '🐰',
  sp_deer: '🦌',
  sp_snake: '🐍',
  sp_eagle: '🦅',
  sp_rhino: '🦏',
  sp_mouse: '🐭',
  trap: '🐝',
  base: '🪹',
};

export function render(root, state, data, handlers = {}) {
  const legal = generateLegalMoves(state, data, 'south');
  root.innerHTML = `
    <section class="top">
      <h1>アニマルライン <span>HIDDEN LINE</span></h1>
      <p>Turn: ${state.turn} / Move ${state.moveCount}${state.winner ? ` / Winner: ${state.winner} (${state.reason})` : ''}</p>
    </section>
    <div class="board ${state.mode}" style="--cols:${state.board.cols};--rows:${state.board.rows}"></div>
    <aside>
      <h2>推理メモ</h2>
      <p>戦闘した敵駒は以後表向き。長押し/右クリックで履歴を確認。</p>
      <ol>${(state.log || []).slice(-6).map((event) => `<li>${event.attacker} vs ${event.defender}: ${event.result}</li>`).join('')}</ol>
    </aside>`;

  const board = root.querySelector('.board');
  for (let y = 0; y < state.board.rows; y += 1) {
    for (let x = 0; x < state.board.cols; x += 1) {
      board.append(createCell(state, x, y, legal, handlers));
    }
  }
}

function createCell(state, x, y, legal, handlers) {
  const piece = state.pieces.find((candidate) => candidate.alive && candidate.x === x && candidate.y === y);
  const river = y === state.board.riverRow - 1;
  const crossing = state.board.crossings.includes(x);
  const cell = document.createElement('button');

  cell.className = `cell ${river ? 'river' : ''} ${crossing ? 'crossing' : ''}`;
  cell.dataset.x = x;
  cell.dataset.y = y;

  if (piece) {
    cell.classList.add(piece.owner);
    cell.dataset.pid = piece.id;
    cell.textContent = piece.owner === 'south' || piece.revealed ? EMOJI[piece.type] : '🍂';
    cell.title = `${piece.owner} ${piece.revealed || piece.owner === 'south' ? piece.type : 'hidden'}`;
  }

  cell.onclick = () => handlers.onCell?.(x, y, piece, legal);
  cell.oncontextmenu = (event) => {
    event.preventDefault();
    handlers.onInspect?.(piece);
  };

  return cell;
}

export function message(text) {
  document.querySelector('#status').textContent = text;
}
