import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import { createGame } from './state.js';
import { applyMove } from './rules.js';
import { chooseAiMove } from './ai.js';
import { grantBattlePoints } from './battlepass.js';
import { render, message } from './render.js';

let state;
let selected = null;
let difficulty = 'intermediate';

function newGame() {
  state = createGame(document.querySelector('#mode').value, document.querySelector('#preset').value);
  selected = null;
  draw();
}

function draw() {
  render(document.querySelector('#app'), state, piecesData, {
    onCell,
    onInspect: (piece) => message(piece ? `${piece.id}: ${(piece.history || []).join(', ') || '履歴なし'}` : '空きマス'),
  });
}

function onCell(x, y, piece, legal) {
  if (state.winner || state.turn !== 'south') return;

  if (piece?.owner === 'south') {
    selected = piece.id;
    message(`${piece.type}を選択`);
    return;
  }

  if (!selected) return;

  const move = legal.find((candidate) => candidate.pieceId === selected && candidate.to.x === x && candidate.to.y === y);
  if (!move) {
    message('そのマスには移動できません');
    return;
  }

  state = applyMove(state, move, piecesData, combat);
  selected = null;
  draw();

  if (state.winner) {
    grantBattlePoints(70);
    return;
  }

  setTimeout(aiTurn, 350);
}

function aiTurn() {
  const move = chooseAiMove(state, piecesData, combat, difficulty);
  if (move) state = applyMove(state, move, piecesData, combat);
  if (state.winner) grantBattlePoints(70);
  draw();
}

document.querySelector('#newGame').onclick = newGame;
document.querySelector('#difficulty').onchange = (event) => {
  difficulty = event.target.value;
};
newGame();
