import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import boards from '../data/boards.json' with { type: 'json' };
import { createGame, buildFormation, createGameFromFormations, swapFormationPieces } from './state.js';
import { applyMove, generateMovesForPiece, pieceById } from './rules.js';
import { chooseAiMove } from './ai.js';
import { grantBattlePoints } from './battlepass.js';
import { renderBoard, updateSelection, renderLog, renderInfo, renderOverlay, renderHud, tokenEl } from './render.js';
import { animateMove, showBattleCutIn } from './fx.js';
import { openGuide } from './guide.js';
import { OnlineRoom, generateRoomCode } from './online.js';
import {
  playerNames, turnMessage, selectMessage, battleMessage,
  inspectMessage, resultTitle, resultReason, opponentOf,
  MOVE_TEXT, ROLE_TEXT,
} from './text.js';

const settings = { opponent: 'ai', mode: 'casual', preset: 'balanced', difficulty: 'intermediate' };
const SESSION_KEY = 'hiddenline-session';
const SESSION_VERSION = 2;
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
  awaitingHandover: false,
  activePreset: 'balanced',
  dirty: false,
};

const online = {
  active: false,
  room: null,
  code: null,
  myRole: null,
  isHost: false,
  configSent: false,
  ready: false,
  opponentReady: false,
  myFormation: null,
  opponentFormation: null,
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
  lobbyStatus: document.querySelector('#lobbyStatus'),
  lobbyCode: document.querySelector('#lobbyCode'),
  gameStatus: document.querySelector('#status'),
  onlineStatus: document.querySelector('#onlineStatus'),
  homePrimaryActions: document.querySelector('#homePrimaryActions'),
  difficultySummary: document.querySelector('#difficultySummary'),
  setupSelection: document.querySelector('#setupSelection'),
  setupSelectionEmpty: document.querySelector('#setupSelectionEmpty'),
  setupSelectionToken: document.querySelector('#setupSelectionToken'),
  setupSelectionName: document.querySelector('#setupSelectionName'),
  setupSelectionRole: document.querySelector('#setupSelectionRole'),
  setupSelectionMove: document.querySelector('#setupSelectionMove'),
  classicHint: document.querySelector('#classicHint'),
};

function show(screen, { record = true, replace = false } = {}) {
  document.body.dataset.screen = screen;
  const stateEntry = { screen };
  const url = screen === 'home' ? location.pathname : `#${screen}`;
  if (replace) history.replaceState(stateEntry, '', url);
  else if (record && history.state?.screen !== screen) history.pushState(stateEntry, '', url);
}

function gameMessage(text) {
  el.gameStatus.textContent = text;
}

function persistSession(screen = document.body.dataset.screen) {
  if (online.active || settings.opponent === 'online') return;
  const payload = {
    version: SESSION_VERSION,
    screen,
    settings,
    state,
    setup: {
      active: setup.active,
      formations: setup.formations,
      selected: setup.selected,
      editingOwner: setup.editingOwner,
      awaitingHandover: false,
      activePreset: setup.activePreset,
      dirty: setup.dirty,
    },
    ui: {
      viewer: ui.viewer,
      names: ui.names,
      selected: ui.selected,
      selectedMoves: ui.selectedMoves,
      lastMove: ui.lastMove,
    },
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function restoreSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== SESSION_VERSION || saved.settings?.opponent === 'online') {
      clearSession();
      return false;
    }
    Object.assign(settings, saved.settings);
    if (saved.screen === 'setup' && saved.setup?.active) {
      Object.assign(setup, saved.setup);
      renderSetupBoard();
      show('setup', { replace: true });
      return true;
    }
    if (saved.screen === 'game' && saved.state) {
      state = saved.state;
      Object.assign(ui, saved.ui, { busy: false, aiTimer: null });
      show('game', { replace: true });
      redraw();
      gameMessage(turnMessage(state, ui.names, settings.opponent));
      if (settings.opponent === 'ai' && state.turn === 'north' && !state.winner) {
        ui.aiTimer = setTimeout(aiTurn, 600);
      }
      return true;
    }
  } catch {
    clearSession();
  }
  return false;
}

function homeMessage(text, isError = false) {
  el.onlineStatus.textContent = text;
  el.onlineStatus.classList.toggle('error', isError);
}

function askConfirm(message, title = '確認') {
  const dialog = document.querySelector('#confirm-dialog');
  document.querySelector('#confirmTitle').textContent = title;
  document.querySelector('#confirmMessage').textContent = message;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      resolve(value);
    };
    document.querySelector('#confirmCancel').onclick = () => finish(false);
    document.querySelector('#confirmOk').onclick = () => finish(true);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}

function cancelPendingAi() {
  ui.gameSeq += 1;
  clearTimeout(ui.aiTimer);
  ui.aiTimer = null;
}

function redraw() {
  renderBoard(el.board, state, piecesData, {
    ...ui,
    boardLabel: '対局盤。矢印キーでマスを移動し、Enterキーで駒を選択または移動します。',
  }, { onCell, onInspect });
  updateSelection(el.board, ui);
  renderOverlay(el.bridges, state.board, ui.viewer);
  renderHud(el, state, piecesData, ui);
  renderLog(el.log, state, piecesData, ui.names);
  renderInfo(el.info, state);
}

function newGame() {
  cancelPendingAi();
  startSetupScreen();
}

function deselect() {
  ui.selected = null;
  ui.selectedMoves = [];
  updateSelection(el.board, ui);
  gameMessage(turnMessage(state, ui.names, settings.opponent));
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
    gameMessage(def.move === 'none' ? `${def.name}は動かせません` : selectMessage(def));
    return;
  }

  if (!ui.selected) return;

  const move = ui.selectedMoves.find((candidate) => candidate.to.x === x && candidate.to.y === y);
  if (!move) {
    gameMessage('そのマスには移動できません');
    return;
  }

  playMove(move);
}

function onInspect(piece) {
  if (!state || ui.busy) return;
  gameMessage(inspectMessage(piece, piecesData, ui.viewer, ui.names));
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
  persistSession('game');
  ui.busy = false;
  return battle;
}

async function playMove(move) {
  const battle = await performMove(move);

  if (online.active) {
    online.room.send('move', { move });
  }

  if (state.winner) {
    finishGame();
    return;
  }

  if (settings.opponent === 'ai') {
    gameMessage('AIが考え中...');
    const seq = ui.gameSeq;
    ui.aiTimer = setTimeout(() => {
      if (seq !== ui.gameSeq) return;
      aiTurn();
    }, 600);
  } else if (online.active) {
    gameMessage(battle ? battleMessage(battle, piecesData, ui.names) : turnMessage(state, ui.names, 'online'));
  } else {
    showHandover(battle);
  }
}

async function applyOnlineMove(move) {
  if (!state || state.winner || ui.busy) return;
  const battle = await performMove(move);
  if (state.winner) {
    finishGame();
    return;
  }
  gameMessage(battle ? battleMessage(battle, piecesData, ui.names) : turnMessage(state, ui.names, 'online'));
}

async function aiTurn() {
  const move = chooseAiMove(state, piecesData, combat, settings.difficulty);
  if (!move) {
    gameMessage(turnMessage(state, ui.names, settings.opponent));
    return;
  }

  const battle = await performMove(move);
  if (state.winner) {
    finishGame();
    return;
  }
  gameMessage(battle
    ? `${battleMessage(battle, piecesData, ui.names)}。あなたの番です。`
    : turnMessage(state, ui.names, settings.opponent));
}

function showHandover(battle) {
  gameMessage(battle ? battleMessage(battle, piecesData, ui.names) : 'お疲れさまでした');
  el.handoverText.textContent = `${ui.names[state.turn]}の番です。端末を渡してください。`;
  el.handover.hidden = false;
  el.handoverOk.focus();
}

el.handoverOk.onclick = () => {
  el.handover.hidden = true;
  if (setup.active && setup.awaitingHandover) {
    setup.awaitingHandover = false;
    setup.editingOwner = 'north';
    setup.selected = null;
    setup.activePreset = 'balanced';
    setup.dirty = false;
    renderSetupBoard();
    persistSession('setup');
    return;
  }
  ui.viewer = state.turn;
  redraw();
  gameMessage(turnMessage(state, ui.names, settings.opponent));
  persistSession('game');
};

function finishGame() {
  cancelPendingAi();
  clearSession();
  if (settings.opponent === 'ai') grantBattlePoints(70);
  gameMessage(resultTitle(state, ui.names, settings.opponent));
  el.resultTitle.textContent = resultTitle(state, ui.names, settings.opponent);
  const me = online.active ? online.myRole : 'south';
  el.resultTitle.className = state.winner === 'draw' ? 'draw' : state.winner === me ? 'win' : 'lose';
  el.resultReason.textContent = resultReason(state);
  el.resultDialog.showModal();
}

document.querySelector('#setup').onsubmit = (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  settings.opponent = form.get('opponent');
  settings.mode = form.get('mode');
  settings.difficulty = form.get('difficulty');
  if (settings.opponent === 'online') {
    homeMessage('「部屋を作る」または「部屋に入る」を選んでください。', true);
    return;
  }
  settings.preset = 'balanced';
  newGame();
};

for (const radio of document.querySelectorAll('input[name="opponent"]')) {
  radio.onchange = () => {
    if (!radio.checked) return;
    document.querySelector('#group-difficulty').hidden = radio.value !== 'ai';
    document.querySelector('#group-online').hidden = radio.value !== 'online';
    el.homePrimaryActions.hidden = radio.value === 'online';
    homeMessage('');
  };
}

for (const radio of document.querySelectorAll('input[name="difficulty"]')) {
  radio.onchange = () => {
    if (radio.checked) el.difficultySummary.textContent = radio.closest('.option-card').querySelector('.option-title').textContent;
  };
}

document.querySelector('#resign').onclick = async () => {
  if (!state || state.winner || ui.busy) return;
  const loser = settings.opponent === 'ai' ? 'south' : ui.viewer;
  if (!await askConfirm(`${ui.names[loser]}が投了します。よろしいですか？`, '投了しますか')) return;
  state.winner = opponentOf(loser);
  state.reason = 'resign';
  if (online.active) online.room.send('resign');
  finishGame();
};

document.querySelector('#goHome').onclick = async () => {
  if (state && !state.winner && !await askConfirm('対局を中断してホームに戻りますか？', '対局を中断しますか')) return;
  cancelPendingAi();
  el.handover.hidden = true;
  leaveOnlineRoom();
  clearSession();
  show('home');
};

document.querySelector('#rematch').onclick = () => {
  el.resultDialog.close();
  if (online.active) {
    leaveOnlineRoom();
    show('home');
    return;
  }
  newGame();
  el.board.querySelector('.cell')?.focus();
};

document.querySelector('#resultHome').onclick = () => {
  el.resultDialog.close();
  leaveOnlineRoom();
  clearSession();
  show('home');
};

function leaveOnlineRoom() {
  if (online.room) {
    if (state && !state.winner) online.room.send('resign');
    online.room.leave();
  }
  online.active = false;
  online.room = null;
  online.code = null;
  online.myRole = null;
  online.isHost = false;
  online.configSent = false;
  online.ready = false;
  online.opponentReady = false;
  online.myFormation = null;
  online.opponentFormation = null;
}

document.querySelector('#openHelpHome').onclick = () => openGuide(piecesData);
document.querySelector('#openHelpSetup').onclick = () => openGuide(piecesData);
document.querySelector('#openHelpGame').onclick = () => openGuide(piecesData);
document.querySelector('#closeHelp').onclick = () => document.querySelector('#help-dialog').close();

function startSetupScreen() {
  setup.active = true;
  setup.editingOwner = 'south';
  setup.awaitingHandover = false;
  setup.formations.south = buildFormation(settings.mode, settings.preset, 'south');
  setup.formations.north = buildFormation(settings.mode, 'balanced', 'north');
  setup.selected = null;
  setup.activePreset = settings.preset;
  setup.dirty = false;
  renderSetupBoard();
  show('setup');
  persistSession('setup');
}

function onlineNames() {
  return online.myRole === 'south'
    ? { south: 'あなた', north: '相手' }
    : { south: '相手', north: 'あなた' };
}

function setupPlayerNames() {
  if (online.active) return onlineNames();
  return playerNames(settings.opponent);
}

function updateSetupStatus() {
  const names = setupPlayerNames();
  const startBtn = document.querySelector('#setupStart');

  if (online.active) {
    el.setupStatus.textContent = online.ready
      ? '相手の準備を待っています...'
      : `${names[online.myRole]}の駒を並べてください。駒を2つタップすると入れ替わります。`;
    startBtn.textContent = online.ready ? '待機中...' : '準備完了';
    startBtn.disabled = online.ready;
    return;
  }

  startBtn.disabled = false;
  const who = settings.opponent === 'ai' ? 'あなた' : names[setup.editingOwner];
  el.setupStatus.textContent = `${who}の駒を並べてください。駒を2つタップすると入れ替わります。`;
  startBtn.textContent = settings.opponent === 'human' && setup.editingOwner === 'south' ? '次のプレイヤーへ' : '対局開始';
}

function renderSetupBoard() {
  const board = boards[settings.mode];
  const mockState = {
    board,
    pieces: setup.formations[setup.editingOwner] || [],
  };
  renderBoard(el.setupBoard, mockState, piecesData, {
    viewer: setup.editingOwner,
    selected: setup.selected,
    selectedMoves: [],
    names: setupPlayerNames(),
    boardLabel: '駒の配置盤。矢印キーで移動し、Enterキーで選択します。',
  }, { onCell: onSetupCell, onInspect: onSetupInspect });
  updateSelection(el.setupBoard, { selected: setup.selected, selectedMoves: [] });
  renderOverlay(el.setupBridges, board, setup.editingOwner);
  updateSetupSelection();
  updatePresetButtons();
  el.classicHint.hidden = settings.mode !== 'classic';
  updateSetupStatus();
}

function onSetupInspect(piece) {
  if (!piece) {
    el.setupStatus.textContent = '空きマスです。';
    return;
  }
  const def = pieceById(piecesData, piece.type);
  el.setupStatus.textContent = `${def.name}。${MOVE_TEXT[def.move]}`;
}

function updateSetupSelection() {
  const piece = setup.formations[setup.editingOwner]?.find((candidate) => candidate.id === setup.selected);
  el.setupSelection.hidden = !piece;
  el.setupSelectionEmpty.hidden = Boolean(piece);
  el.setupSelectionToken.replaceChildren();
  if (!piece) return;
  const def = pieceById(piecesData, piece.type);
  el.setupSelectionToken.append(tokenEl(piece.owner, def.asset, def.name));
  el.setupSelectionName.textContent = def.name;
  el.setupSelectionRole.textContent = ROLE_TEXT[def.role];
  el.setupSelectionMove.textContent = MOVE_TEXT[def.move];
}

function updatePresetButtons() {
  const map = {
    balanced: document.querySelector('#setupBalanced'),
    attack: document.querySelector('#setupAttack'),
    defense: document.querySelector('#setupDefense'),
  };
  for (const [preset, button] of Object.entries(map)) button.setAttribute('aria-pressed', String(setup.activePreset === preset));
  document.querySelector('#setupShuffle').setAttribute('aria-pressed', String(setup.activePreset === 'shuffle'));
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
    setup.activePreset = null;
    setup.dirty = true;
    renderSetupBoard();
    persistSession('setup');
  }
}

function applyPreset(preset) {
  setup.formations[setup.editingOwner] = buildFormation(settings.mode, preset, setup.editingOwner);
  setup.selected = null;
  setup.activePreset = preset;
  setup.dirty = true;
  renderSetupBoard();
  persistSession('setup');
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
  setup.activePreset = 'shuffle';
  setup.dirty = true;
  renderSetupBoard();
  persistSession('setup');
}

document.querySelector('#setupHome').onclick = async () => {
  if (setup.dirty && !await askConfirm('変更した配置を破棄してホームに戻りますか？', '配置を破棄しますか')) return;
  setup.active = false;
  leaveOnlineRoom();
  clearSession();
  show('home');
};

document.querySelector('#setupBalanced').onclick = () => applyPreset('balanced');
document.querySelector('#setupAttack').onclick = () => applyPreset('attack');
document.querySelector('#setupDefense').onclick = () => applyPreset('defense');
document.querySelector('#setupShuffle').onclick = () => shuffleFormation();
document.querySelector('#setupReset').onclick = () => {
  setup.formations[setup.editingOwner] = buildFormation(settings.mode, setup.activePreset || 'balanced', setup.editingOwner);
  setup.selected = null;
  setup.dirty = false;
  renderSetupBoard();
  persistSession('setup');
};

document.querySelector('#setupStart').onclick = () => {
  if (online.active) {
    if (online.ready) return;
    online.ready = true;
    online.myFormation = setup.formations[online.myRole];
    online.room.send('ready', { formation: online.myFormation });
    updateSetupStatus();
    maybeStartOnlineGame();
    return;
  }

  if (settings.opponent === 'human' && setup.editingOwner === 'south') {
    setup.awaitingHandover = true;
    const names = setupPlayerNames();
    el.handoverText.textContent = `${names.north}の番です。端末を渡してください。`;
    el.handover.hidden = false;
    el.handoverOk.focus();
    return;
  }
  finishSetupAndStartGame();
};

function finishSetupAndStartGame() {
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
  gameMessage(turnMessage(state, ui.names, settings.opponent));
  persistSession('game');
}

function startOnlineSetup() {
  setup.active = true;
  setup.editingOwner = online.myRole;
  setup.awaitingHandover = false;
  setup.formations[online.myRole] = buildFormation(settings.mode, settings.preset, online.myRole);
  setup.selected = null;
  setup.activePreset = settings.preset;
  setup.dirty = false;
  online.ready = false;
  online.opponentReady = false;
  online.opponentFormation = null;
  online.myFormation = null;
  renderSetupBoard();
  show('setup');
}

function maybeStartOnlineGame() {
  if (!online.ready || !online.opponentReady) return;
  const southFormation = online.myRole === 'south' ? online.myFormation : online.opponentFormation;
  const northFormation = online.myRole === 'north' ? online.myFormation : online.opponentFormation;

  setup.active = false;
  state = createGameFromFormations(settings.mode, southFormation, northFormation);
  ui.names = onlineNames();
  ui.viewer = online.myRole;
  ui.selected = null;
  ui.selectedMoves = [];
  ui.lastMove = null;
  ui.busy = false;
  el.handover.hidden = true;
  show('game');
  redraw();
  gameMessage(turnMessage(state, ui.names, 'online'));
}

function wireOnlineHandlers() {
  online.room.on('protocolError', ({ expected, received }) => {
    const text = `対戦相手の通信形式（${received}）は、この画面（${expected}）と互換性がありません。両方の画面を更新してください。`;
    if (document.body.dataset.screen === 'lobby') el.lobbyStatus.textContent = text;
    else el.setupStatus.textContent = text;
  });

  online.room.on('config', ({ mode }) => {
    settings.mode = mode;
    startOnlineSetup();
  });

  online.room.on('ready', ({ formation }) => {
    online.opponentFormation = formation;
    online.opponentReady = true;
    maybeStartOnlineGame();
  });

  online.room.on('move', ({ move }) => {
    applyOnlineMove(move);
  });

  online.room.on('resign', () => {
    if (!state || state.winner) return;
    state.winner = online.myRole;
    state.reason = 'resign';
    finishGame();
  });

  online.room.on('presence', (count) => {
    if (online.isHost && count >= 2 && !online.configSent) {
      online.configSent = true;
      online.room.send('config', { mode: settings.mode });
      startOnlineSetup();
    }
  });

  online.room.on('leave', () => {
    if (state && !state.winner) {
      state.winner = online.myRole;
      state.reason = 'resign';
      finishGame();
    } else if (!state) {
      el.lobbyStatus.textContent = '相手が退出しました。もう一度お試しください。';
    }
  });
}

document.querySelector('#onlineCodeInput').oninput = (event) => {
  event.target.value = event.target.value.toUpperCase();
};

document.querySelector('#onlineHost').onclick = async () => {
  const form = new FormData(document.querySelector('#setup'));
  settings.opponent = 'online';
  settings.mode = form.get('mode');
  settings.preset = 'balanced';
  homeMessage('部屋を準備しています。');

  online.active = true;
  online.myRole = 'south';
  online.isHost = true;
  online.code = generateRoomCode();
  online.room = new OnlineRoom();

  show('lobby');
  el.lobbyStatus.textContent = '部屋を準備しています…';
  el.lobbyCode.hidden = true;
  wireOnlineHandlers();

  try {
    await online.room.host(online.code);
  } catch {
    el.lobbyStatus.textContent = 'オンライン対戦に接続できません。時間をおいて再度お試しください。';
    return;
  }

  el.lobbyStatus.textContent = '相手を待っています。部屋コードを伝えてください。';
  el.lobbyCode.textContent = online.code;
  el.lobbyCode.hidden = false;
};

document.querySelector('#onlineJoin').onclick = async () => {
  const codeInput = document.querySelector('#onlineCodeInput');
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    homeMessage('4文字の部屋コードを入力してください。', true);
    codeInput.setAttribute('aria-invalid', 'true');
    codeInput.focus();
    return;
  }
  codeInput.removeAttribute('aria-invalid');
  const form = new FormData(document.querySelector('#setup'));
  settings.opponent = 'online';
  settings.preset = 'balanced';
  homeMessage('部屋へ接続しています。');

  online.active = true;
  online.myRole = 'north';
  online.isHost = false;
  online.code = code;
  online.room = new OnlineRoom();

  show('lobby');
  el.lobbyStatus.textContent = '接続しています…';
  el.lobbyCode.hidden = true;
  wireOnlineHandlers();

  try {
    await online.room.guest(code);
  } catch {
    el.lobbyStatus.textContent = 'オンライン対戦に接続できません。部屋コードを確認してください。';
    return;
  }

  el.lobbyStatus.textContent = 'ホストの準備を待っています…';
};

document.querySelector('#lobbyHome').onclick = () => {
  leaveOnlineRoom();
  clearSession();
  show('home');
};

window.addEventListener('popstate', (event) => {
  const target = event.state?.screen || 'home';
  const current = document.body.dataset.screen;
  const hasUnsavedGame = current === 'game' && state && !state.winner;
  const hasUnsavedSetup = current === 'setup' && setup.dirty;
  if ((hasUnsavedGame || hasUnsavedSetup) && target !== current) {
    history.pushState({ screen: current }, '', `#${current}`);
    const prompt = hasUnsavedGame ? '対局を中断して前の画面へ戻りますか？' : '変更した配置を破棄して前の画面へ戻りますか？';
    askConfirm(prompt, hasUnsavedGame ? '対局を中断しますか' : '配置を破棄しますか').then((accepted) => {
      if (accepted) {
        if (hasUnsavedGame) leaveOnlineRoom();
        setup.dirty = false;
        clearSession();
        show(target);
      }
    });
    return;
  }
  if (target === 'home' && current !== 'home') {
    setup.active = false;
    leaveOnlineRoom();
    clearSession();
  }
  show(target, { record: false });
});

if (!restoreSession()) show('home', { replace: true });
