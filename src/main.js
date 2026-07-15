import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import boards from '../data/boards.json' with { type: 'json' };
import { createGame, buildFormation, createGameFromFormations, swapFormationPieces } from './state.js';
import { applyMove, generateMovesForPiece, pieceById } from './rules.js';
import { chooseAiMove } from './ai.js';
import { grantBattlePoints } from './battlepass.js';
import { renderBoard, updateSelection, renderLog, renderInfo, renderOverlay, renderHud, message } from './render.js';
import { animateMove, showBattleCutIn } from './fx.js';
import { openGuide } from './guide.js';
import {
  playerNames, turnMessage, selectMessage, battleMessage,
  inspectMessage, resultTitle, resultReason, opponentOf,
} from './text.js';

const settings = { opponent: 'ai', mode: 'casual', preset: 'balanced', difficulty: 'intermediate' };
let state = null;
const ui = {
  viewer: 'south',
  names: playerNames('ai'),
  selected: null,
  selectedMoves: [],
  lastMove: null,
  busy: false,
  aiTimer: null,
  gameSeq: 0,
};

const setup = {
  active: false,
  formations: {},
  selected: null,
  editingOwner: 'south',
};

const el = {
  board: document.querySelector('#board'),
  fx: document.querySelector('#fx'),
  bridges: document.querySelector('#bridges'),
  hudTop: document.querySelector('#hudTop'),
  hudBottom: document.querySelector('#hudBottom'),
  log: document.querySelector('#battleLog'),
  info: document.querySelector('#moveCount'),
  handover: document.querySelector('#handover'),
  handoverText: document.querySelector('#handoverText'),
  handoverOk: document.querySelector('#handoverOk'),
  resultDialog: document.querySelector('#result-dialog'),
  resultTitle: document.querySelector('#resultTitle'),
  resultReason: document.querySelector('#resultReason'),
  setupBoard: document.querySelector('#setupBoard'),
  setupBridges: document.querySelector('#setupBridges'),
  setupStatus: document.querySelector('#setupStatus'),
};

function show(screen) {
  document.body.dataset.screen = screen;
}

function cancelPendingAi() {
  ui.gameSeq += 1;
  clearTimeout(ui.aiTimer);
  ui.aiTimer = null;
}

function redraw() {
  renderBoard(el.board, state, piecesData, ui, { onCell, onInspect });
  updateSelection(el.board, ui);
  renderOverlay(el.bridges, state.board, ui.viewer);
  renderHud(el, state, piecesData, ui);
  renderLog(el.log, state, piecesData, ui.names);
  renderInfo(el.info, state);
}

function newGame() {
  cancelPendingAi();
  if (settings.opponent === 'ai') {
    startSetupScreen();
  } else {
    state = createGame(settings.mode, settings.preset);
    ui.names = playerNames(settings.opponent);
    ui.viewer = 'south';
    ui.selected = null;
    ui.selectedMoves = [];
    ui.lastMove = null;
    ui.busy = false;
    el.handover.hidden = true;
    show('game');
    redraw();
    message(turnMessage(state, ui.names, settings.opponent));
  }
}

function deselect() {
  ui.selected = null;
  ui.selectedMoves = [];
  updateSelection(el.board, ui);
  message(turnMessage(state, ui.names, settings.opponent));
}

function onCell(x, y, piece) {
  if (!state || state.winner || ui.busy) return;
  if (state.turn !== ui.viewer) return;

  if (piece?.owner === state.turn) {
    if (ui.selected === piece.id) {
      deselect();
      return;
    }
    ui.selected = piece.id;
    ui.selectedMoves = generateMovesForPiece(state, piece, piecesData);
    updateSelection(el.board, ui);
    const def = pieceById(piecesData, piece.type);
    message(def.move === 'none' ? `${def.name}は動かせません` : selectMessage(def));
    return;
  }

  if (!ui.selected) return;

  const move = ui.selectedMoves.find((candidate) => candidate.to.x === x && candidate.to.y === y);
  if (!move) {
    message('そのマスには移動できません');
    return;
  }

  playMove(move);
}

function onInspect(piece) {
  if (!state || ui.busy) return;
  message(inspectMessage(piece, piecesData, ui.viewer, ui.names));
}

async function performMove(move) {
  ui.busy = true;
  ui.selected = null;
  ui.selectedMoves = [];

  const previousLogLength = state.log?.length || 0;
  await animateMove(el.board, el.fx, move);
  state = applyMove(state, move, piecesData, combat);
  ui.lastMove = { from: move.from, to: move.to };

  const battle = (state.log?.length || 0) > previousLogLength ? state.log.at(-1) : null;
  if (battle) await showBattleCutIn(battle, piecesData, ui.names);

  redraw();
  ui.busy = false;
  return battle;
}

async function playMove(move) {
  const battle = await performMove(move);

  if (state.winner) {
    finishGame();
    return;
  }

  if (settings.opponent === 'ai') {
    message('AIが考え中…');
    const seq = ui.gameSeq;
    ui.aiTimer = setTimeout(() => {
      if (seq !== ui.gameSeq) return;
      aiTurn();
    }, 600);
  } else {
    showHandover(battle);
  }
}

async function aiTurn() {
  const move = chooseAiMove(state, piecesData, combat, settings.difficulty);
  if (!move) {
    message(turnMessage(state, ui.names, settings.opponent));
    return;
  }

  const battle = await performMove(move);
  if (state.winner) {
    finishGame();
    return;
  }
  message(battle
    ? `${battleMessage(battle, piecesData, ui.names)}。あなたの番です。`
    : turnMessage(state, ui.names, settings.opponent));
}

function showHandover(battle) {
  message(battle ? battleMessage(battle, piecesData, ui.names) : 'お疲れさまでした');
  el.handoverText.textContent = `${ui.names[state.turn]}の番です。端末を渡してください。`;
  el.handover.hidden = false;
  el.handoverOk.focus();
}

el.handoverOk.onclick = () => {
  el.handover.hidden = true;
  ui.viewer = state.turn;
  redraw();
  message(turnMessage(state, ui.names, settings.opponent));
};

function finishGame() {
  cancelPendingAi();
  if (settings.opponent === 'ai') grantBattlePoints(70);
  message(resultTitle(state, ui.names, settings.opponent));
  el.resultTitle.textContent = resultTitle(state, ui.names, settings.opponent);
  el.resultTitle.className = state.winner === 'draw' ? 'draw' : state.winner === 'south' ? 'win' : 'lose';
  el.resultReason.textContent = resultReason(state);
  el.resultDialog.showModal();
}

document.querySelector('#setup').onsubmit = (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  settings.opponent = form.get('opponent');
  settings.mode = form.get('mode');
  settings.preset = form.get('preset');
  settings.difficulty = form.get('difficulty');
  newGame();
};

for (const radio of document.querySelectorAll('input[name="opponent"]')) {
  radio.onchange = () => {
    document.querySelector('#group-difficulty').hidden = radio.value === 'human' && radio.checked;
  };
}

document.querySelector('#resign').onclick = () => {
  if (!state || state.winner || ui.busy) return;
  const loser = settings.opponent === 'ai' ? 'south' : ui.viewer;
  if (!confirm(`${ui.names[loser]}が投了します。よろしいですか？`)) return;
  state.winner = opponentOf(loser);
  state.reason = 'resign';
  finishGame();
};

document.querySelector('#goHome').onclick = () => {
  if (state && !state.winner && !confirm('対局を中断してホームに戻りますか？')) return;
  cancelPendingAi();
  el.handover.hidden = true;
  show('home');
};

document.querySelector('#rematch').onclick = () => {
  el.resultDialog.close();
  newGame();
  el.board.querySelector('.cell')?.focus();
};

document.querySelector('#resultHome').onclick = () => {
  el.resultDialog.close();
  show('home');
};

document.querySelector('#openHelpHome').onclick = () => openGuide(piecesData);
document.querySelector('#openHelpGame').onclick = () => openGuide(piecesData);
document.querySelector('#closeHelp').onclick = () => document.querySelector('#help-dialog').close();

function startSetupScreen() {
  setup.active = true;
  setup.editingOwner = 'south';
  setup.formations.south = buildFormation(settings.mode, settings.preset, 'south');
  setup.formations.north = buildFormation(settings.mode, 'balanced', 'north');
  setup.selected = null;
  renderSetupBoard();
  show('setup');
}

function renderSetupBoard() {
  const board = boards[settings.mode];
  const mockState = {
    board,
    pieces: setup.formations[setup.editingOwner] || [],
  };
  renderBoard(el.setupBoard, mockState, piecesData, { viewer: setup.editingOwner, selected: setup.selected }, { onCell: onSetupCell });
  renderOverlay(el.setupBridges, board, setup.editingOwner);
}

function onSetupCell(x, y, piece) {
  if (!piece || piece.owner !== setup.editingOwner) return;

  if (setup.selected === piece.id) {
    setup.selected = null;
    renderSetupBoard();
    return;
  }

  if (setup.selected === null) {
    setup.selected = piece.id;
    renderSetupBoard();
    return;
  }

  const formation = setup.formations[setup.editingOwner];
  const indexA = formation.findIndex(p => p.id === setup.selected);
  const indexB = formation.findIndex(p => p.id === piece.id);

  if (indexA >= 0 && indexB >= 0) {
    setup.formations[setup.editingOwner] = swapFormationPieces(formation, indexA, indexB);
    setup.selected = null;
    renderSetupBoard();
  }
}

function applyPreset(preset) {
  setup.formations[setup.editingOwner] = buildFormation(settings.mode, preset, setup.editingOwner);
  setup.selected = null;
  renderSetupBoard();
}

function shuffleFormation() {
  const formation = setup.formations[setup.editingOwner];
  const shuffled = [...formation];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  setup.formations[setup.editingOwner] = shuffled;
  setup.selected = null;
  renderSetupBoard();
}

document.querySelector('#setupHome').onclick = () => {
  setup.active = false;
  show('home');
};

document.querySelector('#setupBalanced').onclick = () => applyPreset('balanced');
document.querySelector('#setupAttack').onclick = () => applyPreset('attack');
document.querySelector('#setupDefense').onclick = () => applyPreset('defense');
document.querySelector('#setupShuffle').onclick = () => shuffleFormation();

document.querySelector('#setupStart').onclick = () => {
  setup.active = false;
  state = createGameFromFormations(settings.mode, setup.formations.south, setup.formations.north);
  ui.names = playerNames(settings.opponent);
  ui.viewer = 'south';
  ui.selected = null;
  ui.selectedMoves = [];
  ui.lastMove = null;
  ui.busy = false;
  el.handover.hidden = true;
  show('game');
  redraw();
  message(turnMessage(state, ui.names, settings.opponent));
};

show('home');
