import { pieceById } from './rules.js';

export const RESULT_TEXT = {
  WIN: '勝ち',
  LOSE: '負け',
  DRAW: '相打ち',
};

export const REASON_TEXT = {
  hq: '相手の巣に突入しました',
  surrender: '相手に動ける駒がいなくなりました',
  tiebreak: '規定手数に到達し、残り戦力で判定しました',
  resign: '投了により決着しました',
  noGeneral: '本陣を落とせる将官がいなくなりました',
};

export const MOVE_TEXT = {
  step1: '前後左右に1マス',
  cavalry: '前に2マス、または横・後ろに1マス',
  runner: '縦横にまっすぐ何マスでも（駒は飛び越えられない）',
  flyer: '縦に何マスでも＋横に1マス。川をまっすぐ飛び越えられる',
  none: '動けない',
};

export const ROLE_TEXT = {
  general: '将官',
  officer: '士官',
  special: '特殊',
  trap: 'ワナ',
};

export function playerNames(opponent) {
  return opponent === 'human'
    ? { south: 'プレイヤー1', north: 'プレイヤー2' }
    : { south: 'あなた', north: 'AI' };
}

export function pieceName(data, typeId) {
  return pieceById(data, typeId)?.name ?? typeId;
}

export function opponentOf(owner) {
  return owner === 'south' ? 'north' : 'south';
}

export function turnMessage(state, names, opponent) {
  if (opponent === 'ai' && state.turn === 'north') return 'AIが考え中…';
  const who = opponent === 'ai' ? 'あなた' : names[state.turn];
  return `${who}の番です。駒を選んでください。`;
}

export function selectMessage(def) {
  return `${def.name}を選択中。動き: ${MOVE_TEXT[def.move]}`;
}

export function moveCountText(state) {
  return `${state.moveCount}手目（最大${state.maxMoves}手）`;
}

function battlePieceLabel(type, owner, viewer, data, names) {
  return `${names[owner]}の${owner === viewer ? pieceName(data, type) : '伏せ駒'}`;
}

export function battleMessage(event, data, names, viewer) {
  const attacker = battlePieceLabel(event.attacker, event.attackerOwner, viewer, data, names);
  const defenderOwner = opponentOf(event.attackerOwner);
  const defender = battlePieceLabel(event.defender, defenderOwner, viewer, data, names);
  if (event.result === 'WIN') return `${attacker}が${defender}との戦闘に勝ちました`;
  if (event.result === 'LOSE') return `${attacker}は${defender}との戦闘に負けました`;
  return `${attacker}と${defender}は相打ちになりました`;
}

export function logLine(event, data, names, viewer) {
  const defenderOwner = opponentOf(event.attackerOwner);
  const attacker = battlePieceLabel(event.attacker, event.attackerOwner, viewer, data, names);
  const defender = battlePieceLabel(event.defender, defenderOwner, viewer, data, names);
  return `${attacker} 対 ${defender}: ${RESULT_TEXT[event.result] ?? event.result}`;
}

export function hqTitle(owner, names) {
  return `${names[owner]}の本陣（巣）`;
}

export function cellTitle(piece, def, viewer, names) {
  if (!piece) return '';
  const hidden = piece.owner !== viewer;
  if (hidden) return `${names[piece.owner]}の駒（正体不明）`;
  return `${names[piece.owner]}の${def.name}`;
}

function parseHistoryEntry(entry, data) {
  const resultOnly = /^combat: (WIN|LOSE|DRAW)$/.exec(entry);
  if (resultOnly) return RESULT_TEXT[resultOnly[1]] ?? resultOnly[1];
  const match = /^vs (\S+): (WIN|LOSE|DRAW)$/.exec(entry);
  if (!match) return entry;
  return RESULT_TEXT[match[2]] ?? match[2];
}

export function inspectMessage(piece, data, viewer, names) {
  if (!piece) return '空きマスです。';
  const hidden = piece.owner !== viewer;
  if (hidden) return `${names[piece.owner]}の伏せ駒です。戦闘結果から正体を推理してください。`;

  const def = pieceById(data, piece.type);
  const history = (piece.history || []).map((entry) => parseHistoryEntry(entry, data));
  const historyText = history.length ? `戦闘履歴: ${history.join('、')}` : '戦闘履歴なし';
  return `${names[piece.owner]}の${def.name}。${historyText}`;
}

export function resultTitle(state, names, opponent) {
  if (state.winner === 'draw') return '引き分け';
  if (opponent === 'ai') return state.winner === 'south' ? 'あなたの勝ち！' : 'あなたの負け…';
  return `${names[state.winner]}の勝ち！`;
}

export function resultReason(state) {
  if (state.winner === 'draw') return '規定手数に到達し、残り戦力が同点でした';
  return REASON_TEXT[state.reason] ?? '';
}
