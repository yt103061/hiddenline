import { pieceById } from './rules.js';
import { pieceAsset, pieceName, opponentOf } from './text.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animateMove(boardEl, fxEl, move) {
  if (reducedMotion()) return Promise.resolve();

  const fromCell = boardEl.querySelector(`[data-x="${move.from.x}"][data-y="${move.from.y}"]`);
  const toCell = boardEl.querySelector(`[data-x="${move.to.x}"][data-y="${move.to.y}"]`);
  const visual = fromCell?.querySelector('.piece');
  if (!fromCell || !toCell || !visual) return Promise.resolve();

  const layerRect = fxEl.getBoundingClientRect();
  const fromRect = fromCell.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();

  const ghost = visual.cloneNode(true);
  ghost.className = 'fx-ghost';
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.transform = `translate(${fromRect.left - layerRect.left}px, ${fromRect.top - layerRect.top}px)`;
  fxEl.append(ghost);
  visual.style.visibility = 'hidden';

  return new Promise((resolve) => {
    const finish = () => {
      ghost.remove();
      visual.style.visibility = '';
      resolve();
    };
    const timer = setTimeout(finish, 400);
    ghost.addEventListener('transitionend', () => {
      clearTimeout(timer);
      finish();
    }, { once: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${toRect.left - layerRect.left}px, ${toRect.top - layerRect.top}px)`;
      });
    });
  });
}

export function showBattleCutIn(event, data, names) {
  const backdrop = document.createElement('div');
  backdrop.className = `cutin-backdrop ${reducedMotion() ? 'no-motion' : ''}`;

  const defenderOwner = opponentOf(event.attackerOwner);
  backdrop.innerHTML = `
    <div class="cutin">
      <div class="cutin-side">
        ${cutInBadge(data, event.attacker)}
        <span class="cutin-owner">${names[event.attackerOwner]}</span>
        <span class="cutin-name">${pieceName(data, event.attacker)}</span>
      </div>
      <div class="cutin-vs">VS</div>
      <div class="cutin-side">
        ${cutInBadge(data, event.defender)}
        <span class="cutin-owner">${names[defenderOwner]}</span>
        <span class="cutin-name">${pieceName(data, event.defender)}</span>
      </div>
      <div class="cutin-result ${event.result.toLowerCase()}">${cutInResult(event, data)}</div>
    </div>`;

  document.body.append(backdrop);

  return new Promise((resolve) => {
    const close = () => {
      clearTimeout(timer);
      backdrop.remove();
      resolve();
    };
    const timer = setTimeout(close, reducedMotion() ? 900 : 1400);
    backdrop.addEventListener('pointerdown', close, { once: true });
  });
}

function cutInResult(event, data) {
  if (event.result === 'WIN') return `${pieceName(data, event.attacker)}の勝ち！`;
  if (event.result === 'LOSE') return `${pieceName(data, event.defender)}の勝ち！`;
  return '相打ち！';
}

function cutInBadge(data, typeId) {
  const def = pieceById(data, typeId);
  const asset = pieceAsset(def);
  if (asset) return `<img class="cutin-piece" src="${asset}" alt="${def.name}" />`;
  return '<span class="cutin-piece cutin-emoji">🪹</span>';
}
