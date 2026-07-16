import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { authCallbackError, hasAuthCallbackInUrl } from '../src/auth-callback.js';

const [html, migration, config, packageJson] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260715144631_commercial_online_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/config.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
]);

assert.match(html, /value="ranked"/);
assert.match(html, /value="friend"/);
assert.doesNotMatch(html, /value="ai"/);
assert.doesNotMatch(html, /value="human"/);
assert.match(html, /id="authGate"/);

const tables = ['profiles', 'seasons', 'ratings', 'matches', 'match_events', 'friendships', 'wallets', 'wallet_transactions', 'catalog_items', 'inventory', 'loadouts', 'saved_formations', 'battle_pass_progress', 'purchases', 'webhook_events'];
for (const table of tables) {
  assert.match(migration, new RegExp(`create table public\\.${table} \\(`, 'i'), `${table} is created`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} enables RLS`);
}

const functions = ['join-ranked-queue', 'claim-cpu-fallback', 'create-friend-room', 'submit-formation', 'start-match', 'submit-move', 'cpu-move', 'get-match-view', 'match-heartbeat', 'claim-disconnect', 'resign-match', 'finalize-match', 'create-checkout', 'stripe-webhook', 'delete-account', 'rollover-season'];
for (const name of functions) await access(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url));

const [main, engine, submitMove, finalizeMatch] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/_shared/game-engine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/submit-move/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/finalize-match/index.ts', import.meta.url), 'utf8'),
]);
assert.doesNotMatch(main, /send\('ready',\s*\{\s*formation/, 'formations are not broadcast to opponents');
assert.match(engine, /type:\s*'hidden'/, 'opponent piece types are removed from client projections');
assert.match(submitMove, /applyAuthorizedMove/, 'moves are checked by the server game engine');
assert.match(submitMove, /finalize_match_result/, 'server-confirmed victories are finalized server-side');
assert.doesNotMatch(finalizeMatch, /const\s*\{[^}]*winner/, 'finalization does not trust a client winner');
assert.match(migration, /server_commit_game_state/, 'server state commits use an atomic sequence check');
assert.match(migration, /interval '60 seconds'/, 'disconnect forfeits require a 60 second reconnect window');

assert.doesNotMatch(config, /eyJ[a-zA-Z0-9_-]{20,}/, 'legacy JWT is not committed');
assert.equal(packageJson.dependencies['@supabase/supabase-js'], '2.100.0');
assert.equal(packageJson.devDependencies.vite, '8.1.4');

assert.equal(hasAuthCallbackInUrl({ hash: '#access_token=test', search: '' }), true, 'OAuth hash callbacks are preserved');
assert.equal(hasAuthCallbackInUrl({ hash: '', search: '?code=pkce-code' }), true, 'PKCE callbacks are preserved');
assert.equal(hasAuthCallbackInUrl({ hash: '#home', search: '' }), false, 'normal screen hashes are not treated as auth callbacks');
assert.equal(authCallbackError({ hash: '#error_description=Access+denied', search: '' }), 'Access denied');
assert.match(main, /hasAuthCallbackInUrl\(\)/, 'initial navigation does not erase an OAuth callback');

console.log('commercial auth, ranked, economy, RLS, and Edge Function contracts passed');
