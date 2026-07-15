import { pieceById } from './rules.js';
import { pieceName, opponentOf } from './text.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animateMove(boardEl, fxEl, move) {
  if (reducedMotion()) return Promise.resolve();

  const fromCell = boardEl.querySelector(`[data-x="${move.from.x}"][data-y="${move.from.y}"]`);
  const toCell = boardEl.querySelector(`[data-x="${move.to.x}"][data-y="${move.to.y}"]`);
  const visual = fromCell?.querySelector('.token');
  if (!fromCell || !toCell || !visual) return Promise.resolve();

  const layerRect = fxEl.getBoundingClientRect();
  const fromRect = fromCell.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.className = 'fx-ghost';
  ghost.append(visual.cloneNode(true));
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

export function showBattleCutIn(event, data, names, viewer) {
  const backdrop = document.createElement('div');
  backdrop.className = `cutin-backdrop battle-${event.result.toLowerCase()} ${reducedMotion() ? 'no-motion' : ''}`;
  backdrop.setAttribute('role', 'status');
  backdrop.setAttribute('aria-live', 'assertive');

  const defenderOwner = opponentOf(event.attackerOwner);
  backdrop.innerHTML = `
    <div class="cutin">
      <div class="cutin-side cutin-attacker">
        ${cutInBadge(data, event.attacker, event.attackerOwner, event.attackerOwner !== viewer)}
        <span class="cutin-owner">${names[event.attackerOwner]}</span>
        <span class="cutin-name">${event.attackerOwner === viewer ? pieceName(data, event.attacker) : '正体不明'}</span>
      </div>
      <div class="cutin-vs" aria-hidden="true">VS</div>
      <div class="cutin-impact" aria-hidden="true">✦</div>
      <div class="cutin-side cutin-defender">
        ${cutInBadge(data, event.defender, defenderOwner, defenderOwner !== viewer)}
        <span class="cutin-owner">${names[defenderOwner]}</span>
        <span class="cutin-name">${defenderOwner === viewer ? pieceName(data, event.defender) : '正体不明'}</span>
      </div>
      <div class="cutin-result ${event.result.toLowerCase()}">${cutInResult(event, names)}</div>
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

function cutInResult(event, names) {
  if (event.result === 'WIN') return `${names[event.attackerOwner]}の勝ち！`;
  if (event.result === 'LOSE') return `${names[opponentOf(event.attackerOwner)]}の勝ち！`;
  return '相打ち！';
}

function cutInBadge(data, typeId, owner, hidden) {
  const def = pieceById(data, typeId);
  const asset = hidden ? data.backAsset : def.asset;
  return `<div class="token cutin-token ${owner}${hidden ? ' back' : ''}"><img class="token-face" src="${asset}" alt="" /></div>`;
}
