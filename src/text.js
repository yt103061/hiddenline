import { pieceById } from './rules.js';

export const PIECE_EMOJI = {
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
};

export const BACK_EMOJI = '🍂';

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

export function pieceEmoji(def) {
  return PIECE_EMOJI[def?.id] ?? '❓';
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
  return `${def.name}を選択中 — 動き: ${MOVE_TEXT[def.move]}`;
}

export function moveCountText(state) {
  return `${state.moveCount}手目（最大${state.maxMoves}手）`;
}

export function battleMessage(event, data, names) {
  const attacker = `${names[event.attackerOwner]}の${pieceName(data, event.attacker)}`;
  const defenderOwner = opponentOf(event.attackerOwner);

  if (event.defender === 'trap') {
    if (event.result === 'WIN') return `${attacker}がハチの巣を取り除きました`;
    return `${attacker}はハチの巣に返り討ちにされました（ハチの巣も壊れました）`;
  }

  const defender = `${names[defenderOwner]}の${pieceName(data, event.defender)}`;
  if (event.result === 'WIN') return `${attacker}が${defender}を倒しました`;
  if (event.result === 'LOSE') return `${attacker}は${defender}に返り討ちにされました`;
  return `${attacker}と${defender}は相打ちになりました`;
}

export function logLine(event, data, names) {
  const defenderOwner = opponentOf(event.attackerOwner);
  const attacker = `${names[event.attackerOwner]}の${pieceName(data, event.attacker)}`;
  const defender = `${names[defenderOwner]}の${pieceName(data, event.defender)}`;
  return `${attacker} ⚔ ${defender} → ${RESULT_TEXT[event.result] ?? event.result}`;
}

export function hqTitle(owner, names) {
  return `${names[owner]}の巣（本陣）`;
}

export function cellTitle(piece, def, viewer, names) {
  if (!piece) return '';
  const hidden = piece.owner !== viewer && !piece.revealed;
  if (hidden) return `${names[piece.owner]}の駒（正体不明）`;
  return `${names[piece.owner]}の${def.name}`;
}

function parseHistoryEntry(entry, data) {
  const match = /^vs (\S+): (WIN|LOSE|DRAW)$/.exec(entry);
  if (!match) return entry;
  return `対${pieceName(data, match[1])} ${RESULT_TEXT[match[2]]}`;
}

export function inspectMessage(piece, data, viewer, names) {
  if (!piece) return '空きマスです。';
  const hidden = piece.owner !== viewer && !piece.revealed;
  if (hidden) return `${names[piece.owner]}の伏せ駒です。戦闘すると正体が分かります。`;

  const def = pieceById(data, piece.type);
  const history = (piece.history || []).map((entry) => parseHistoryEntry(entry, data));
  const historyText = history.length ? `戦闘履歴: ${history.join('、')}` : '戦闘履歴なし';
  return `${names[piece.owner]}の${def.name} — ${historyText}`;
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
