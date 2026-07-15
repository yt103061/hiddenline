import { MOVE_TEXT, roleText } from './text.js';

const MOVE_DOTS = {
  step1: [[0, -1], [0, 1], [-1, 0], [1, 0]],
  cavalry: [[0, -2], [0, 1], [-1, 0], [1, 0]],
  runner: [[0, -1], [0, -2], [0, 1], [0, 2], [-1, 0], [-2, 0], [1, 0], [2, 0]],
  flyer: [[0, -1], [0, -2], [0, 1], [0, 2], [-1, 0], [1, 0]],
  none: [],
};

let built = false;

export function openGuide(data) {
  const dialog = document.querySelector('#help-dialog');
  if (!built) {
    document.querySelector('#helpContent').innerHTML = buildGuide(data);
    built = true;
  }
  dialog.showModal();
  dialog.scrollTop = 0;
}

function buildGuide(data) {
  return `
    <h2>あそびかた</h2>
    <section class="guide-section">
      <h3>ゲームの目的</h3>
      <ul>
        <li>相手の駒は戦闘後も裏向きです。勝ち・負け・相打ちの結果から正体を推理します。</li>
        <li>少佐以上の駒で相手の<strong>本陣（巣）</strong>に入れば勝ちです。</li>
        <li>相手に動ける駒、または本陣を占領できる駒がいなくなっても勝ちです。</li>
      </ul>
    </section>
    <section class="guide-section">
      <h3>川と突入口</h3>
      <ul>
        <li>盤の中央には<strong>川</strong>が流れていて、そのままでは渡れません。</li>
        <li>左右2か所に<strong>中州（飛び石）</strong>があります。岸のマスから中州へ、中州から対岸の岸へ、ななめに1マスずつ進むことで渡れます。</li>
        <li>どの動物も、この突入口を使えば川を渡れます。</li>
        <li>ワシだけは突入口を使わず、川と途中の駒をまっすぐ飛び越えられます。</li>
      </ul>
    </section>
    <section class="guide-section">
      <h3>強さの要点</h3>
      <ul>
        <li>将官（ライオン〜イノシシ）は番号が小さいほど強く、格下に勝ちます。同じ駒同士は相打ちです。</li>
        <li><strong>ヘビはライオンにだけ勝てます。</strong>ほかの相手には負けます。</li>
        <li><strong>ハチの巣（罠）</strong>は動けませんが、触れた駒を返り討ちにします（自分も壊れます）。</li>
        <li><strong>ワシとネズミ</strong>だけがハチの巣（罠）を無傷で取り除けます。</li>
        <li>本陣（巣）に入れるのは少佐以上（ライオン〜イノシシ）の駒です。</li>
      </ul>
    </section>
    <section class="guide-section">
      <h3>駒ずかん</h3>
      <p class="guide-note">移動図は自分視点（上が前）です。「カジュアル」はカジュアルモードにも登場する駒です。</p>
      <div class="guide-pieces">${data.pieces.map((def) => pieceCard(def, data)).join('')}</div>
    </section>`;
}

function pieceCard(def, data) {
  const badge = `<div class="token guide-badge"><img class="token-face" src="${def.asset}" alt="" /></div>`;
  const casual = data.casualPieceSet.includes(def.id) ? '<span class="guide-casual">カジュアル</span>' : '';
  const rank = def.role === 'general' ? `<span class="guide-rank">強さ${def.rankOrder}</span>` : '';

  return `
    <div class="guide-piece">
      ${badge}
      <div class="guide-piece-info">
        <strong>${def.name}${casual}</strong>
        <span class="guide-role">${roleText(def)}${rank ? ' ・ ' : ''}${rank}</span>
        <span class="guide-move">${MOVE_TEXT[def.move]}</span>
      </div>
      ${miniGrid(def.move)}
    </div>`;
}

function miniGrid(move) {
  const dots = new Set(MOVE_DOTS[move].map(([dx, dy]) => `${dx + 2},${dy + 2}`));
  let cells = '';
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const cls = x === 2 && y === 2 ? 'center' : dots.has(`${x},${y}`) ? 'dot' : '';
      cells += `<i class="${cls}"></i>`;
    }
  }
  return `<div class="mini-grid" aria-hidden="true">${cells}</div>`;
}
