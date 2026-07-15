---
name: verify
description: Build-free static site — serve locally and drive the game UI with Playwright against the preinstalled Chromium.
---

# Verifying hiddenline

No build step. Logic tests: `node test/combat.test.js`.

## Launch

```bash
python3 -m http.server 8000 &   # serve repo root
```

## Drive (Playwright)

Install `playwright` (npm) in a scratch dir and launch with the preinstalled
browser — do NOT run `playwright install`:

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

Gotchas:

- Home-screen options are hidden radios inside `label.option-card`; click the
  label (`page.click('label.option-card:has(input[name="mode"][value="classic"])')`),
  not the input — `page.check()` times out on pointer-events interception.
- Native `confirm()` is used for resign/quit: register `page.on('dialog', d => d.accept())`.
- Board cells are `#board .cell[data-x][data-y]`; own pieces carry `.south`
  (or `.north` for P2 in PvP), selection state is `.sel` / `.move-dot` /
  `.attack-target`, last move is `.last-from` / `.last-to`.
- Battle cut-in (`.cutin-backdrop`) auto-dismisses after ~1.4s; wait for it
  with a short timeout inside try/catch since not every move fights.
- Status line `#status` holds the current turn message ("…の番です") — poll it
  to know when the AI finished thinking.

## Flows worth driving

home setup → start game → select/deselect piece → move → AI reply →
battle log Japanese-only sweep (`/rank_\d|WIN|LOSE|Turn:/` must not match
`document.body.innerText`) → resign → result dialog → rematch →
PvP: move → handover overlay → viewer switch (board flips, opponent pieces
show `piece_back.svg`) → 375px viewport for mobile.
