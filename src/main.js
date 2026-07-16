import piecesData from '../data/pieces.json' with { type: 'json' };
import combat from '../data/combat_matrix.json' with { type: 'json' };
import boards from '../data/boards.json' with { type: 'json' };
import { createGame, buildFormation, createGameFromFormations, swapFormationPieces, shuffleFormationPieces, chooseFirstTurn } from './state.js';
import { applyMove, generateMovesForPiece, pieceById } from './rules.js';
import { chooseAiMove } from './ai.js';
import { renderBoard, updateSelection, renderLog, renderInfo, renderOverlay, renderHud, tokenEl } from './render.js';
import { animateMove, showBattleCutIn } from './fx.js';
import { openGuide } from './guide.js';
import { OnlineRoom, RandomMatchmaker, generateRoomCode } from './online.js';
import { initializeCommercialUI, trackEvent } from './commercial.js';
import { supabase, invokeFunction, invokeRpc } from './supabase.js';
import { hasAuthCallbackInUrl } from './auth-callback.js';
import {
  playerNames, turnMessage, selectMessage, battleMessage,
  inspectMessage, resultTitle, resultReason, opponentOf,
  MOVE_TEXT, roleText,
} from './text.js';

const settings = { opponent: 'ranked', mode: 'casual', preset: 'balanced', difficulty: 'small_iii' };
const SESSION_KEY = 'hiddenline-session';
const SESSION_VERSION = 2;
const CUSTOM_PRESETS_KEY = 'hiddenline-custom-presets-v1';
const ONLINE_RECONNECT_KEY = 'hiddenline-online-reconnect-v1';
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
  startSent: false,
  pendingFirstTurn: null,
  matcher: null,
  matchId: null,
  isCpu: false,
  sequence: 0,
  heartbeatTimer: null,
  reconnectTimer: null,
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
  heroStart: document.querySelector('#rankedHeroStart'),
  setupSelection: document.querySelector('#setupSelection'),
  setupSelectionEmpty: document.querySelector('#setupSelectionEmpty'),
  setupSelectionToken: document.querySelector('#setupSelectionToken'),
  setupSelectionName: document.querySelector('#setupSelectionName'),
  setupSelectionRole: document.querySelector('#setupSelectionRole'),
  setupSelectionMove: document.querySelector('#setupSelectionMove'),
  classicHint: document.querySelector('#classicHint'),
  coinToss: document.querySelector('#coinToss'),
  coin: document.querySelector('#coin'),
  coinTossStatus: document.querySelector('#coinTossStatus'),
  customPresetName: document.querySelector('#customPresetName'),
  customPresetSelect: document.querySelector('#customPresetSelect'),
  customPresetStatus: document.querySelector('#customPresetStatus'),
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCoinToss(firstTurn, names) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.coinToss.hidden = false;
  el.coinTossStatus.textContent = 'コインを投げます…';
  el.coin.classList.remove('is-tossing', 'is-north');
  el.coin.style.setProperty('--coin-end', firstTurn === 'north' ? '1260deg' : '1080deg');
  void el.coin.offsetWidth;
  el.coin.classList.add('is-tossing');
  await wait(reduced ? 180 : 1450);
  el.coin.classList.remove('is-tossing');
  el.coin.classList.toggle('is-north', firstTurn === 'north');
  el.coinTossStatus.textContent = `${names[firstTurn]}が先攻です！`;
  await wait(reduced ? 350 : 900);
  el.coinToss.hidden = true;
}

function scheduleOpeningAiTurn() {
  if (settings.opponent !== 'ai' || state?.turn !== 'north' || state.winner) return;
  clearTimeout(ui.aiTimer);
  ui.aiTimer = setTimeout(aiTurn, 500);
}

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

function readCustomPresets() {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeCustomPresets(presets) {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

function normalizedFormation(formation, owner, board) {
  return formation.map((piece) => ({
    key: piece.id.slice(owner.length + 1),
    x: piece.x,
    y: owner === 'north' ? board.rows - 1 - piece.y : piece.y,
  }));
}

function formationFromPreset(preset, owner, mode) {
  const board = boards[mode];
  const positions = new Map(preset.positions.map((position) => [position.key, position]));
  return buildFormation(mode, 'balanced', owner).map((piece) => {
    const position = positions.get(piece.id.slice(owner.length + 1));
    if (!position) return piece;
    return { ...piece, x: position.x, y: owner === 'north' ? board.rows - 1 - position.y : position.y };
  });
}

function updateCustomPresetOptions(selected = '') {
  const presets = readCustomPresets()[settings.mode] || [];
  el.customPresetSelect.replaceChildren(new Option('選択してください', ''));
  for (const preset of presets) el.customPresetSelect.append(new Option(preset.name, preset.name));
  el.customPresetSelect.value = selected;
}

function applyCustomPreset(name) {
  const preset = (readCustomPresets()[settings.mode] || []).find((candidate) => candidate.name === name);
  if (!preset) return false;
  setup.formations[setup.editingOwner] = formationFromPreset(preset, setup.editingOwner, settings.mode);
  setup.selected = null;
  setup.activePreset = `custom:${name}`;
  setup.dirty = true;
  renderSetupBoard();
  persistSession('setup');
  return true;
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
  renderLog(el.log, state, piecesData, ui.names, ui.viewer);
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
  if (battle) await showBattleCutIn(battle, piecesData, ui.names, ui.viewer);

  redraw();
  persistSession('game');
  ui.busy = false;
  return battle;
}

async function applyServerMove(move, nextState) {
  ui.busy = true;
  ui.selected = null;
  ui.selectedMoves = [];
  const previousLogLength = state?.log?.length || 0;
  await animateMove(el.board, el.fx, move);
  state = nextState;
  ui.lastMove = { from: move.from, to: move.to };
  const battle = (state.log?.length || 0) > previousLogLength ? state.log.at(-1) : null;
  if (battle) await showBattleCutIn(battle, piecesData, ui.names, ui.viewer);
  redraw();
  ui.busy = false;
  return battle;
}

async function fetchMatchView() {
  const { data, error } = await invokeFunction('get-match-view', { body: { matchId: online.matchId } });
  if (error) throw error;
  online.sequence = Number(data.sequence) || online.sequence;
  return data;
}

async function playMove(move) {
  if (online.matchId) {
    const { data, error } = await invokeFunction('submit-move', {
      body: { matchId: online.matchId, sequence: online.sequence, move },
    });
    if (error) {
      gameMessage('手をサーバーで確認できませんでした。もう一度お試しください。');
      return;
    }
    online.sequence = Number(data.sequence) || online.sequence + 1;
    const battle = await applyServerMove(data.move || move, data.playerState);
    if (online.active) online.room.send('move', { move: data.move || move, sequence: online.sequence });
    if (data.cpuMove && data.state) {
      gameMessage('CPUが考えています…');
      await wait(450);
      await applyServerMove(data.cpuMove, data.state);
    }
    if (state.winner) finishGame();
    else gameMessage(battle ? battleMessage(battle, piecesData, ui.names, ui.viewer) : turnMessage(state, ui.names, settings.opponent));
    return;
  }
  const battle = await performMove(move);

  if (online.active) {
    online.room.send('move', { move, sequence: online.sequence });
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
    gameMessage(battle ? battleMessage(battle, piecesData, ui.names, ui.viewer) : turnMessage(state, ui.names, 'online'));
  } else {
    showHandover(battle);
  }
}

async function applyOnlineMove(move) {
  if (!state || state.winner || ui.busy) return;
  let view;
  try { view = await fetchMatchView(); } catch {
    gameMessage('対局状態を同期できませんでした。再接続してください。');
    return;
  }
  const battle = await applyServerMove(move, view.state);
  if (state.winner) {
    finishGame();
    return;
  }
  gameMessage(battle ? battleMessage(battle, piecesData, ui.names, ui.viewer) : turnMessage(state, ui.names, 'online'));
}

async function aiTurn() {
  if (!state || state.winner || state.turn !== 'north' || ui.busy) return;
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
    ? `${battleMessage(battle, piecesData, ui.names, ui.viewer)}。あなたの番です。`
    : turnMessage(state, ui.names, settings.opponent));
}

function showHandover(battle) {
  gameMessage(battle ? battleMessage(battle, piecesData, ui.names, ui.viewer) : 'お疲れさまでした');
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
  gameMessage(resultTitle(state, ui.names, settings.opponent));
  el.resultTitle.textContent = resultTitle(state, ui.names, settings.opponent);
  const me = online.active ? online.myRole : 'south';
  el.resultTitle.className = state.winner === 'draw' ? 'draw' : state.winner === me ? 'win' : 'lose';
  el.resultReason.textContent = resultReason(state);
  el.resultDialog.showModal();
  trackEvent('match_completed', { opponent: settings.opponent, result: state.winner === 'draw' ? 'draw' : state.winner === ui.viewer ? 'win' : 'loss' });
  localStorage.removeItem(ONLINE_RECONNECT_KEY);
  if (online.matchId) {
    invokeFunction('finalize-match', {
      body: { matchId: online.matchId },
    }).catch(() => {});
  }
}

document.querySelector('#setup').onsubmit = (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  settings.opponent = form.get('opponent');
  settings.mode = form.get('mode');
  homeMessage('ランクマッチまたはフレンドマッチを選んでください。', true);
};

function updateHomeLauncher() {
  const opponent = document.querySelector('input[name="opponent"]:checked')?.value || 'ranked';
  el.heroStart.textContent = 'ランクマッチを始める';
  el.heroStart.type = 'button';
  el.heroStart.onclick = () => document.querySelector('#onlineRandom').click();
}

for (const radio of document.querySelectorAll('input[name="opponent"]')) {
  radio.onchange = () => {
    if (!radio.checked) return;
    document.querySelector('#group-online').hidden = radio.value !== 'friend';
    document.querySelector('#group-ranked').hidden = radio.value !== 'ranked';
    homeMessage('');
    updateHomeLauncher();
  };
}

updateHomeLauncher();

document.querySelector('#resign').onclick = async () => {
  if (!state || state.winner || ui.busy) return;
  const loser = settings.opponent === 'ai' || settings.opponent === 'ranked_cpu' ? 'south' : ui.viewer;
  if (!await askConfirm(`${ui.names[loser]}が投了します。よろしいですか？`, '投了しますか')) return;
  if (online.matchId) {
    const { error } = await invokeFunction('resign-match', { body: { matchId: online.matchId } });
    if (error) {
      gameMessage('投了をサーバーへ送信できませんでした。もう一度お試しください。');
      return;
    }
  }
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
  online.matcher?.leave();
  online.matcher = null;
  if (online.room) {
    if (state && !state.winner) {
      online.room.send('resign');
      if (online.matchId) invokeFunction('resign-match', { body: { matchId: online.matchId } }).catch(() => {});
    }
    online.room.leave();
  }
  clearInterval(online.heartbeatTimer);
  clearTimeout(online.reconnectTimer);
  online.active = false;
  online.room = null;
  online.code = null;
  online.matchId = null;
  online.isCpu = false;
  online.myRole = null;
  online.isHost = false;
  online.configSent = false;
  online.ready = false;
  online.opponentReady = false;
  online.myFormation = null;
  online.opponentFormation = null;
  online.startSent = false;
  online.sequence = 0;
  online.pendingFirstTurn = null;
  online.heartbeatTimer = null;
  online.reconnectTimer = null;
  localStorage.removeItem(ONLINE_RECONNECT_KEY);
}

function rememberOnlineMatch(extra = {}) {
  if (!online.matchId) return;
  localStorage.setItem(ONLINE_RECONNECT_KEY, JSON.stringify({
    matchId: online.matchId,
    role: online.myRole,
    cpu: online.isCpu,
    cpuRank: settings.difficulty,
    ...extra,
  }));
}

async function resumeOnlineMatch() {
  if (online.matchId || document.body.dataset.screen !== 'home') return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(ONLINE_RECONNECT_KEY) || 'null'); } catch { return; }
  if (!saved?.matchId) return;
  const { data: match, error } = await supabase.from('matches')
    .select('id,mode,kind,status,cpu_rank_key,south_user_id,north_user_id')
    .eq('id', saved.matchId).maybeSingle();
  if (error || !match || ['finished', 'cancelled'].includes(match.status)) {
    localStorage.removeItem(ONLINE_RECONNECT_KEY);
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  online.matchId = match.id;
  online.isCpu = match.kind === 'ranked_cpu';
  online.myRole = match.south_user_id === user.id ? 'south' : 'north';
  online.isHost = online.myRole === 'south';
  online.configSent = match.status !== 'waiting';
  settings.mode = match.mode;
  settings.opponent = online.isCpu ? 'ranked_cpu' : match.kind === 'friend' ? 'friend' : 'ranked';
  settings.difficulty = match.cpu_rank_key || saved.cpuRank || 'small_iii';
  settings.preset = 'balanced';

  if (!online.isCpu) {
    online.active = true;
    online.code = match.id;
    online.room = new OnlineRoom();
    wireOnlineHandlers();
    show('lobby');
    el.lobbyStatus.textContent = '対局へ再接続しています…';
    try {
      if (online.isHost) await online.room.host(match.id); else await online.room.guest(match.id);
      startMatchHeartbeat();
    } catch {
      el.lobbyStatus.textContent = '再接続できませんでした。通信状態を確認してください。';
      return;
    }
  }

  if (match.status === 'active') {
    try {
      const view = await fetchMatchView();
      state = view.state;
      ui.names = online.isCpu ? playerNames('ranked_cpu') : onlineNames();
      ui.viewer = online.myRole;
      ui.selected = null;
      ui.selectedMoves = [];
      ui.lastMove = null;
      ui.busy = false;
      show('game');
      redraw();
      gameMessage(`対局へ再接続しました。${turnMessage(state, ui.names, settings.opponent)}`);
    } catch {
      el.lobbyStatus.textContent = '対局状態を復元できませんでした。';
    }
  } else if (online.isCpu) {
    newGame();
  } else if (match.status === 'setup') {
    const { data: lastEvent } = await supabase.from('match_events').select('sequence')
      .eq('match_id', match.id).order('sequence', { ascending: false }).limit(1).maybeSingle();
    startOnlineSetup();
    online.sequence = Number(lastEvent?.sequence) || 0;
  }
}

function startMatchHeartbeat() {
  clearInterval(online.heartbeatTimer);
  const send = () => online.matchId && invokeFunction('match-heartbeat', { body: { matchId: online.matchId } }).catch(() => {});
  send();
  online.heartbeatTimer = setInterval(send, 15000);
}

function waitForOpponentReconnect() {
  if (online.reconnectTimer || !online.matchId) return;
  const status = state ? el.gameStatus : el.lobbyStatus;
  status.textContent = '相手との接続が切れました。60秒間、再接続を待ちます…';
  online.reconnectTimer = setTimeout(async () => {
    online.reconnectTimer = null;
    const { data, error } = await invokeFunction('claim-disconnect', { body: { matchId: online.matchId } });
    if (error || data?.status === 'waiting') {
      status.textContent = '相手の再接続を引き続き待っています…';
      waitForOpponentReconnect();
      return;
    }
    if (data.status === 'cancelled') {
      el.lobbyStatus.textContent = '配置完了前の切断のため、レート変動なしで対局を終了しました。';
      if (document.body.dataset.screen !== 'lobby') show('lobby');
      return;
    }
    if (state && data.status === 'finished') {
      state.winner = online.myRole;
      state.reason = 'disconnect';
      finishGame();
    }
  }, 60000);
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
  updateCustomPresetOptions();
  el.customPresetStatus.textContent = '';
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
  el.setupSelectionRole.textContent = roleText(def);
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
    const swapped = swapFormationPieces(formation, indexA, indexB, boards[settings.mode]);
    if (swapped === formation) {
      setup.selected = null;
      renderSetupBoard();
      el.setupStatus.textContent = 'ハチの巣（罠）は本陣や突入口には置けません。';
      return;
    }
    setup.formations[setup.editingOwner] = swapped;
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
  setup.formations[setup.editingOwner] = shuffleFormationPieces(formation, boards[settings.mode]);
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
async function savePresetToAccount(name, saved) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインが必要です。');
  const [{ data: rows, error: rowsError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('saved_formations').select('slot,mode,name').eq('user_id', user.id),
    supabase.from('profiles').select('preset_slots').eq('id', user.id).single(),
  ]);
  if (rowsError || profileError) throw rowsError || profileError;
  const existing = rows.find((row) => row.mode === settings.mode && row.name === name);
  if (!existing && rows.length >= profile.preset_slots) throw new Error(`保存枠は${profile.preset_slots}個です。交換所で増やせます。`);
  const used = new Set(rows.map((row) => row.slot));
  const slot = existing?.slot || Array.from({ length: profile.preset_slots }, (_, index) => index + 1).find((candidate) => !used.has(candidate));
  const { error } = await supabase.from('saved_formations').upsert({
    user_id: user.id, slot, mode: settings.mode, name, positions: saved.positions, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,mode,name' });
  if (error) throw error;
}

async function deletePresetFromAccount(name) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('saved_formations').delete().eq('user_id', user.id).eq('mode', settings.mode).eq('name', name);
  if (error) throw error;
}

document.querySelector('#customPresetSave').onclick = async () => {
  const name = el.customPresetName.value.trim();
  if (!name) {
    el.customPresetStatus.textContent = 'プリセット名を入力してください。';
    el.customPresetName.focus();
    return;
  }
  const all = readCustomPresets();
  const presets = all[settings.mode] || [];
  const saved = {
    name,
    positions: normalizedFormation(setup.formations[setup.editingOwner], setup.editingOwner, boards[settings.mode]),
  };
  const existing = presets.findIndex((preset) => preset.name === name);
  try {
    await savePresetToAccount(name, saved);
  } catch (error) {
    el.customPresetStatus.textContent = error.message || 'アカウントへ保存できませんでした。';
    return;
  }
  if (existing >= 0) presets[existing] = saved;
  else presets.push(saved);
  all[settings.mode] = presets;
  writeCustomPresets(all);
  setup.activePreset = `custom:${name}`;
  el.customPresetName.value = '';
  updateCustomPresetOptions(name);
  updatePresetButtons();
  el.customPresetStatus.textContent = existing >= 0 ? `「${name}」を上書きしました。` : `「${name}」を保存しました。`;
};
document.querySelector('#customPresetLoad').onclick = () => {
  const name = el.customPresetSelect.value;
  if (!name || !applyCustomPreset(name)) {
    el.customPresetStatus.textContent = '適用するプリセットを選んでください。';
    return;
  }
  el.customPresetStatus.textContent = `「${name}」を適用しました。`;
};
document.querySelector('#customPresetDelete').onclick = async () => {
  const name = el.customPresetSelect.value;
  if (!name) {
    el.customPresetStatus.textContent = '削除するプリセットを選んでください。';
    return;
  }
  try {
    await deletePresetFromAccount(name);
  } catch {
    el.customPresetStatus.textContent = 'アカウントから削除できませんでした。';
    return;
  }
  const all = readCustomPresets();
  all[settings.mode] = (all[settings.mode] || []).filter((preset) => preset.name !== name);
  writeCustomPresets(all);
  updateCustomPresetOptions();
  if (setup.activePreset === `custom:${name}`) setup.activePreset = null;
  updatePresetButtons();
  el.customPresetStatus.textContent = `「${name}」を削除しました。`;
};
document.querySelector('#setupReset').onclick = () => {
  const customName = setup.activePreset?.startsWith('custom:') ? setup.activePreset.slice(7) : null;
  if (customName && applyCustomPreset(customName)) {
    setup.dirty = false;
    el.customPresetStatus.textContent = `「${customName}」の保存状態に戻しました。`;
    return;
  }
  setup.formations[setup.editingOwner] = buildFormation(settings.mode, setup.activePreset || 'balanced', setup.editingOwner);
  setup.selected = null;
  setup.dirty = false;
  renderSetupBoard();
  persistSession('setup');
};

document.querySelector('#setupStart').onclick = async () => {
  if (online.active) {
    if (online.ready) return;
    online.myFormation = setup.formations[online.myRole];
    const { data, error } = await invokeFunction('submit-formation', {
      body: { matchId: online.matchId, formation: online.myFormation },
    });
    if (error) {
      el.setupStatus.textContent = '配置をサーバーへ保存できませんでした。';
      return;
    }
    online.sequence = Number(data?.sequence ?? data) || online.sequence + 1;
    online.ready = true;
    online.room.send('ready', { sequence: online.sequence });
    updateSetupStatus();
    maybeStartOnlineGame();
    return;
  }

  if (online.isCpu && online.matchId) {
    const { data, error } = await invokeFunction('submit-formation', {
      body: { matchId: online.matchId, formation: setup.formations.south },
    });
    if (error) {
      el.setupStatus.textContent = '配置をサーバーへ保存できませんでした。';
      return;
    }
    online.sequence = Number(data?.sequence ?? data) || online.sequence + 1;
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

async function finishSetupAndStartGame() {
  setup.active = false;
  const firstTurn = chooseFirstTurn();
  if (online.isCpu && online.matchId) {
    const { data, error } = await invokeFunction('start-match', { body: { matchId: online.matchId, firstTurn } });
    if (error) {
      el.setupStatus.textContent = 'CPU対局を開始できませんでした。';
      setup.active = true;
      return;
    }
    online.sequence = Number(data) || online.sequence + 1;
    try {
      state = (await fetchMatchView()).state;
    } catch {
      el.setupStatus.textContent = 'CPU対局の状態を取得できませんでした。';
      setup.active = true;
      return;
    }
  } else {
    state = createGameFromFormations(settings.mode, setup.formations.south, setup.formations.north, firstTurn);
  }
  ui.names = playerNames(settings.opponent);
  ui.viewer = settings.opponent === 'human' ? firstTurn : 'south';
  ui.selected = null;
  ui.selectedMoves = [];
  ui.lastMove = null;
  ui.busy = true;
  el.handover.hidden = true;
  show('game');
  redraw();
  gameMessage('コイントスで先攻を決めています…');
  await runCoinToss(firstTurn, ui.names);
  ui.busy = false;
  gameMessage(turnMessage(state, ui.names, settings.opponent));
  persistSession('game');
  if (online.isCpu && state.turn === 'north') {
    const { data, error } = await invokeFunction('cpu-move', { body: { matchId: online.matchId, sequence: online.sequence } });
    if (error) gameMessage('CPUの初手を取得できませんでした。再接続してください。');
    else {
      online.sequence = Number(data.sequence) || online.sequence + 1;
      await applyServerMove(data.cpuMove, data.state);
      if (state.winner) finishGame();
      else gameMessage(turnMessage(state, ui.names, settings.opponent));
    }
  } else scheduleOpeningAiTurn();
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
  online.startSent = false;
  online.sequence = 0;
  online.pendingFirstTurn = null;
  updateCustomPresetOptions();
  el.customPresetStatus.textContent = '';
  renderSetupBoard();
  show('setup');
}

async function maybeStartOnlineGame() {
  if (!online.ready || !online.opponentReady) return;
  if (online.pendingFirstTurn) {
    const firstTurn = online.pendingFirstTurn;
    online.pendingFirstTurn = null;
    startOnlineGame(firstTurn);
    return;
  }
  if (!online.isHost || online.startSent) return;
  online.startSent = true;
  const firstTurn = chooseFirstTurn();
  const { data, error } = await invokeFunction('start-match', { body: { matchId: online.matchId, firstTurn } });
  if (error) {
    online.startSent = false;
    el.setupStatus.textContent = '対局を開始できませんでした。';
    return;
  }
  online.sequence = Number(data) || online.sequence + 1;
  online.room.send('start', { firstTurn, sequence: online.sequence });
  startOnlineGame(firstTurn);
}

async function startOnlineGame(firstTurn) {
  if (state || !online.ready || !online.opponentReady) return;
  setup.active = false;
  try {
    state = (await fetchMatchView()).state;
  } catch {
    el.setupStatus.textContent = '対局状態を安全に取得できませんでした。';
    setup.active = true;
    return;
  }
  ui.names = onlineNames();
  ui.viewer = online.myRole;
  ui.selected = null;
  ui.selectedMoves = [];
  ui.lastMove = null;
  ui.busy = true;
  el.handover.hidden = true;
  show('game');
  redraw();
  gameMessage('コイントスで先攻を決めています…');
  await runCoinToss(firstTurn, ui.names);
  ui.busy = false;
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

  online.room.on('ready', ({ sequence }) => {
    online.opponentReady = true;
    online.sequence = Math.max(online.sequence, Number(sequence) || 0);
    maybeStartOnlineGame();
  });

  online.room.on('start', ({ firstTurn, sequence }) => {
    if (firstTurn !== 'south' && firstTurn !== 'north') return;
    online.sequence = Math.max(online.sequence, Number(sequence) || 0);
    online.pendingFirstTurn = firstTurn;
    maybeStartOnlineGame();
  });

  online.room.on('move', ({ move, sequence }) => {
    online.sequence = Math.max(online.sequence, Number(sequence) || 0);
    applyOnlineMove(move);
  });

  online.room.on('resign', () => {
    if (!state || state.winner) return;
    state.winner = online.myRole;
    state.reason = 'resign';
    finishGame();
  });

  online.room.on('presence', (count) => {
    if (count >= 2 && online.reconnectTimer) {
      clearTimeout(online.reconnectTimer);
      online.reconnectTimer = null;
      if (state && !state.winner) gameMessage(turnMessage(state, ui.names, 'online'));
    }
    if (online.isHost && count >= 2 && !online.configSent) {
      online.configSent = true;
      online.room.send('config', { mode: settings.mode });
      startOnlineSetup();
    }
  });

  online.room.on('leave', () => {
    waitForOpponentReconnect();
  });
}

document.querySelector('#onlineCodeInput').oninput = (event) => {
  event.target.value = event.target.value.toUpperCase();
};

async function enterMatchedRoom({ matchId, role, cpu = false, cpuRank = 'small_iii' }) {
  trackEvent('ranked_match_found', { cpu });
  online.matcher?.leave();
  online.matcher = null;
  online.matchId = matchId;
  online.isCpu = cpu;
  if (cpu) {
    online.active = false;
    online.myRole = 'south';
    settings.opponent = 'ranked_cpu';
    settings.mode = 'casual';
    settings.difficulty = cpuRank;
    settings.preset = 'balanced';
    rememberOnlineMatch();
    newGame();
    return;
  }
  online.myRole = role === 'host' ? 'south' : 'north';
  online.isHost = role === 'host';
  online.code = matchId;
  online.room = new OnlineRoom();
  wireOnlineHandlers();
  el.lobbyStatus.textContent = '対戦相手が見つかりました。対局へ接続しています…';
  try {
    if (role === 'host') await online.room.host(matchId);
    else await online.room.guest(matchId);
    startMatchHeartbeat();
    rememberOnlineMatch();
    el.lobbyStatus.textContent = role === 'host' ? '相手の接続を待っています…' : 'ホストの準備を待っています…';
  } catch {
    el.lobbyStatus.textContent = '対局ルームへの接続に失敗しました。もう一度お試しください。';
  }
}

document.querySelector('#onlineRandom').onclick = async () => {
  trackEvent('ranked_queue_joined');
  settings.opponent = 'ranked';
  settings.mode = 'casual';
  settings.preset = 'balanced';
  state = null;
  online.active = true;
  online.matcher = new RandomMatchmaker();
  show('lobby');
  el.lobbyCode.hidden = true;
  el.lobbyStatus.textContent = '同じ実力の対戦相手を探しています… 残り20秒';
  try {
    await online.matcher.join(settings.mode, (match) => enterMatchedRoom(match), (remaining, error) => {
      if (remaining === 0) trackEvent('ranked_cpu_fallback');
      el.lobbyStatus.textContent = error
        ? 'マッチングに接続できませんでした。'
        : remaining > 0 ? `同じ実力の対戦相手を探しています… 残り${remaining}秒` : '同ランクのCPUを準備しています…';
    });
  } catch {
    el.lobbyStatus.textContent = 'ランダムマッチに接続できません。時間をおいて再度お試しください。';
  }
};

document.querySelector('#onlineHost').onclick = async () => {
  settings.opponent = 'friend';
  settings.mode = document.querySelector('input[name="friendMode"]:checked')?.value || 'casual';
  settings.preset = 'balanced';
  homeMessage('部屋を準備しています。');
  state = null;

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
    online.matchId = await invokeRpc('create_friend_match', {
      friend_id: document.querySelector('#friendSelect').value || null,
      requested_mode: settings.mode,
      requested_code: online.code,
    });
    await online.room.host(online.matchId);
    startMatchHeartbeat();
    rememberOnlineMatch();
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
  settings.opponent = 'friend';
  settings.preset = 'balanced';
  homeMessage('部屋へ接続しています。');
  state = null;

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
    online.matchId = await invokeRpc('join_friend_match', { requested_code: code });
    const { data: match } = await supabase.from('matches').select('mode').eq('id', online.matchId).single();
    settings.mode = match.mode;
    await online.room.guest(online.matchId);
    startMatchHeartbeat();
    rememberOnlineMatch();
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

if (!restoreSession()) {
  // Supabase reads OAuth credentials from the callback URL asynchronously.
  // Replacing the URL here would erase them before the session is persisted.
  if (hasAuthCallbackInUrl()) document.body.dataset.screen = 'home';
  else show('home', { replace: true });
}
initializeCommercialUI().then((session) => {
  if (session) resumeOnlineMatch();
}).catch((error) => {
  const message = document.querySelector('#authMessage');
  if (message) message.textContent = `アカウント情報を読み込めませんでした: ${error.message}`;
});
