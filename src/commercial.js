import { supabase, backendConfigured, currentUser, invokeRpc } from './supabase.js';
import { rankForRating } from './rank.js';
import { authCallbackError, clearAuthCallbackUrl, hasAuthCallbackInUrl } from './auth-callback.js';

let dashboard = null;
const CUSTOM_PRESETS_KEY = 'hiddenline-custom-presets-v1';
const analyticsSessionId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

export async function initializeCommercialUI() {
  const authGate = document.querySelector('#authGate');
  const homeShell = document.querySelector('#homeCommercialShell');
  if (!authGate || !homeShell) return null;

  if (!backendConfigured) {
    authGate.hidden = false;
    setText('#authMessage', 'オンライン設定が未完了です。');
    return null;
  }

  document.querySelector('#googleLogin').onclick = signInGoogle;
  document.querySelector('#emailLoginForm').onsubmit = signInEmail;
  document.querySelector('#profileForm').onsubmit = saveProfile;
  document.querySelector('#logoutButton').onclick = () => supabase.auth.signOut();
  document.querySelector('#openAccount').onclick = showAccount;
  document.querySelector('#closeAccount').onclick = () => document.querySelector('#accountDialog').close();
  document.querySelector('#openLeaderboard').onclick = showLeaderboard;
  document.querySelector('#closeLeaderboard').onclick = () => document.querySelector('#leaderboardDialog').close();
  document.querySelector('#openShop').onclick = showShop;
  document.querySelector('#closeShop').onclick = () => document.querySelector('#shopDialog').close();
  document.querySelector('#friendSearchForm').onsubmit = searchFriend;
  document.querySelector('#deleteAccountButton').onclick = deleteAccount;
  for (const button of document.querySelectorAll('[data-pass-tier]')) button.onclick = () => startCheckout(button.dataset.passTier);

  const callbackPending = hasAuthCallbackInUrl();
  const callbackError = authCallbackError();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (callbackError) {
    setText('#authMessage', `Googleログインを完了できませんでした: ${decodeURIComponent(callbackError.replace(/\+/g, ' '))}`);
  }
  if (session && callbackPending) clearAuthCallbackUrl();
  await applySession(session);
  supabase.auth.onAuthStateChange((_event, nextSession) => queueMicrotask(async () => {
    try {
      if (nextSession && hasAuthCallbackInUrl()) clearAuthCallbackUrl();
      await applySession(nextSession);
    } catch (authError) {
      setText('#authMessage', `アカウント情報を読み込めませんでした: ${authError.message}`);
    }
  }));
  return session;
}

async function applySession(session) {
  const authGate = document.querySelector('#authGate');
  const homeShell = document.querySelector('#homeCommercialShell');
  if (!session) {
    authGate.hidden = false;
    homeShell.hidden = true;
    return;
  }
  const profile = await loadProfile(session.user.id);
  if (!profile?.onboarding_complete) {
    authGate.hidden = false;
    homeShell.hidden = true;
    document.querySelector('#loginPanel').hidden = true;
    document.querySelector('#profilePanel').hidden = false;
    return;
  }
  authGate.hidden = true;
  homeShell.hidden = false;
  await refreshDashboard(session.user.id, profile);
  trackEvent('home_authenticated');
}

async function loadProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function refreshDashboard(userId, profile) {
  const { data: season } = await supabase.from('seasons').select('*').eq('active', true).single();
  const [{ data: rating }, { data: wallet }, { data: friends }, { data: loadout }] = await Promise.all([
    supabase.from('ratings').select('*').eq('user_id', userId).eq('season_id', season.id).single(),
    supabase.from('wallets').select('acorns').eq('user_id', userId).single(),
    supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted'),
    supabase.from('loadouts').select('piece_skin_id,board_theme_id').eq('user_id', userId).single(),
  ]);
  dashboard = { profile, season, rating, wallet, friends: friends || [], loadout };
  await applyLoadout(loadout);
  await syncSavedFormations(userId, profile.preset_slots || 3);
  const rank = rankForRating(rating?.rating || 1000);
  const days = Math.max(0, Math.ceil((new Date(season.ends_at) - Date.now()) / 86400000));
  setText('#profileName', profile.display_name);
  setText('#profileHandle', `@${profile.handle}`);
  setText('#rankName', rank.name);
  setText('#rankRating', `${rating?.rating || 1000} RP`);
  setText('#acornBalance', `${wallet?.acorns || 0}`);
  setText('#seasonDays', `あと${days}日`);
  setText('#accountStats', `${rating?.wins || 0}勝 ${rating?.losses || 0}敗 ${rating?.draws || 0}分`);
  await renderFriends(userId);
}

async function syncSavedFormations(userId, slotLimit) {
  let { data: saved } = await supabase.from('saved_formations').select('slot,mode,name,positions').eq('user_id', userId).order('slot');
  if (!saved?.length) {
    try {
      const local = JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || '{}');
      const entries = Object.entries(local).flatMap(([mode, presets]) => (presets || []).map((preset) => ({ mode, ...preset }))).slice(0, slotLimit);
      if (entries.length) {
        const rows = entries.map((preset, index) => ({ user_id: userId, slot: index + 1, mode: preset.mode, name: preset.name, positions: preset.positions }));
        const { error } = await supabase.from('saved_formations').insert(rows);
        if (!error) saved = rows;
      }
    } catch { /* invalid legacy data is ignored */ }
  }
  const local = { casual: [], classic: [] };
  for (const preset of saved || []) local[preset.mode]?.push({ name: preset.name, positions: preset.positions });
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(local));
}

async function signInGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) setText('#authMessage', error.message);
}

async function signInEmail(event) {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get('email');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
  setText('#authMessage', error ? error.message : 'ログイン用メールを送りました。');
}

async function saveProfile(event) {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  if (values.get('termsAccepted') !== 'on') {
    setText('#profileMessage', '利用規約とプライバシーポリシーへの同意が必要です。');
    return;
  }
  try {
    await invokeRpc('complete_profile', { new_handle: values.get('handle').toLowerCase(), new_display_name: values.get('displayName') });
    trackEvent('signup_completed');
    const user = await currentUser();
    if (user) await applySession({ user });
  } catch (error) {
    setText('#profileMessage', error.message.includes('duplicate') ? 'そのユーザーIDは使われています。' : error.message);
  }
}

async function showLeaderboard() {
  trackEvent('leaderboard_opened');
  const user = await currentUser();
  const { data, error } = await supabase.from('leaderboard').select('*').lte('rank_position', 100).order('rating', { ascending: false }).limit(1000);
  if (error) return setText('#leaderboardList', 'ランキングを取得できませんでした。');
  const friendIds = new Set((dashboard?.friends || []).flatMap((friend) => [friend.requester_id, friend.addressee_id]));
  friendIds.delete(user?.id);
  const [{ data: me }, { data: friendEntries }] = await Promise.all([
    supabase.from('leaderboard').select('*').eq('user_id', user.id).maybeSingle(),
    friendIds.size ? supabase.from('leaderboard').select('*').in('user_id', [...friendIds]).order('rating', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const { data: nearby } = me
    ? await supabase.from('leaderboard').select('*').eq('rank_key', me.rank_key)
      .gte('rank_position', Math.max(1, Number(me.rank_position) - 5))
      .lte('rank_position', Number(me.rank_position) + 5).order('rank_position')
    : { data: [] };

  document.querySelector('#nearbyLeaderboardList').innerHTML = renderLeaderboardRows(nearby || [], user.id, false)
    || '<li class="leaderboard-empty">まだ順位がありません</li>';
  document.querySelector('#friendLeaderboardList').innerHTML = renderLeaderboardRows(friendEntries || [], user.id, false)
    || '<li class="leaderboard-empty">フレンドの順位はまだありません</li>';
  document.querySelector('#leaderboardList').innerHTML = renderLeaderboardRows(data, user.id, true, friendIds);
  document.querySelector('#leaderboardDialog').showModal();
}

function renderLeaderboardRows(entries, userId, grouped = false, friendIds = new Set()) {
  let previousRank = '';
  return entries.map((entry) => {
    const rank = rankForRating(entry.rating).name;
    const heading = grouped && rank !== previousRank ? `<li class="leaderboard-heading">${rank}</li>` : '';
    previousRank = rank;
    const friend = friendIds.has(entry.user_id) ? '<em>FRIEND</em>' : '';
    const self = entry.user_id === userId ? ' class="is-self"' : '';
    return `${heading}<li${self}><span><b>${entry.rank_position}</b> ${escapeHtml(entry.display_name)} ${friend}</span><span>${entry.rating} RP · ${entry.wins}勝 ${entry.losses}敗</span></li>`;
  }).join('');
}

async function showShop() {
  trackEvent('shop_opened');
  const { data } = await supabase.from('catalog_items').select('*').eq('active', true).order('sort_order');
  document.querySelector('#shopList').innerHTML = (data || []).map((item) => `
    <article class="shop-item"><div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.description)}</p></div>
    <button class="secondary" type="button" data-buy-item="${item.id}">${item.price_acorns} どんぐり</button></article>`).join('');
  for (const button of document.querySelectorAll('[data-buy-item]')) button.onclick = () => buyItem(button.dataset.buyItem);
  document.querySelector('#shopDialog').showModal();
}

async function showAccount() {
  const user = await currentUser(); if (!user) return;
  const [{ data: inventory }, { data: purchases }] = await Promise.all([
    supabase.from('inventory').select('item_id,acquired_at,catalog_items(name,type,asset_key)').eq('user_id', user.id),
    supabase.from('purchases').select('product_key,amount_jpy,status,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
  ]);
  document.querySelector('#accountInventory').innerHTML = inventory?.length
    ? inventory.map((item) => {
      const type = item.catalog_items?.type;
      const equip = type === 'piece_skin' || type === 'board_theme'
        ? `<button type="button" class="secondary" data-equip-item="${item.item_id}" data-item-type="${type}" data-asset-key="${escapeHtml(item.catalog_items?.asset_key || '')}">装備</button>` : '';
      return `<div><span>${escapeHtml(item.catalog_items?.name || item.item_id)}</span><small>${escapeHtml(type || '')}</small>${equip}</div>`;
    }).join('')
    : '<p class="hint">まだアイテムを持っていません。</p>';
  document.querySelector('#purchaseHistory').innerHTML = purchases?.length
    ? purchases.map((item) => `<div><span>${escapeHtml(item.product_key)}</span><small>${item.amount_jpy}円 · ${escapeHtml(item.status)}</small></div>`).join('')
    : '<p class="hint">購入履歴はありません。</p>';
  for (const button of document.querySelectorAll('[data-equip-item]')) button.onclick = () => equipItem(button);
  document.querySelector('#accountDialog').showModal();
}

async function applyLoadout(loadout) {
  if (!loadout) return;
  const ids = [loadout.piece_skin_id, loadout.board_theme_id].filter(Boolean);
  const { data: items } = ids.length ? await supabase.from('catalog_items').select('id,type,asset_key').in('id', ids) : { data: [] };
  const skin = items?.find((item) => item.type === 'piece_skin');
  const board = items?.find((item) => item.type === 'board_theme');
  document.body.dataset.pieceSkin = skin?.asset_key || '';
  document.body.dataset.boardTheme = board?.asset_key || '';
}

async function equipItem(button) {
  const user = await currentUser(); if (!user) return;
  const column = button.dataset.itemType === 'piece_skin' ? 'piece_skin_id' : 'board_theme_id';
  const { error } = await supabase.from('loadouts').update({ [column]: button.dataset.equipItem, updated_at: new Date().toISOString() }).eq('user_id', user.id);
  if (error) { button.textContent = '装備失敗'; return; }
  document.body.dataset[button.dataset.itemType === 'piece_skin' ? 'pieceSkin' : 'boardTheme'] = button.dataset.assetKey;
  button.textContent = '装備中';
}

async function startCheckout(tier) {
  trackEvent('checkout_started', { tier });
  const { data, error } = await supabase.functions.invoke('create-checkout', { body: { tier } });
  if (error || !data?.url) { setText('#shopMessage', '決済を開始できませんでした。'); return; }
  location.assign(data.url);
}

async function deleteAccount(event) {
  const button = event.currentTarget;
  if (button.dataset.confirmed !== 'true') {
    button.dataset.confirmed = 'true'; button.textContent = 'もう一度押して削除';
    setText('#deleteAccountMessage', '削除すると戦績やアイテムは元に戻せません。'); return;
  }
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) { setText('#deleteAccountMessage', '削除できませんでした。'); return; }
  await supabase.auth.signOut();
  location.reload();
}

async function buyItem(itemId) {
  try {
    const result = await invokeRpc('buy_catalog_item', { requested_item: itemId });
    setText('#shopMessage', `交換しました。残り${result.balance}どんぐり`);
    const user = await currentUser();
    if (user) await refreshDashboard(user.id, await loadProfile(user.id));
  } catch (error) { setText('#shopMessage', error.message); }
}

async function searchFriend(event) {
  event.preventDefault();
  const handle = String(new FormData(event.currentTarget).get('friendHandle') || '').replace(/^@/, '').toLowerCase();
  const { data } = await supabase.from('profiles').select('id,handle,display_name').eq('handle', handle).maybeSingle();
  const area = document.querySelector('#friendSearchResult');
  if (!data) { area.textContent = 'ユーザーが見つかりません。'; return; }
  area.innerHTML = `<span>${escapeHtml(data.display_name)} <small>@${escapeHtml(data.handle)}</small></span><button type="button" class="secondary">申請</button>`;
  area.querySelector('button').onclick = async () => {
    const user = await currentUser();
    const { error } = await supabase.from('friendships').insert({ requester_id: user.id, addressee_id: data.id });
    area.textContent = error ? error.message : 'フレンド申請を送りました。';
  };
}

async function renderFriends(userId) {
  const { data } = await supabase.from('friendships').select('requester_id,addressee_id,status');
  const visible = (data || []).filter((f) => f.status !== 'blocked');
  const ids = visible.map((f) => f.requester_id === userId ? f.addressee_id : f.requester_id);
  const select = document.querySelector('#friendSelect');
  select.innerHTML = '<option value="">誰でも参加できる部屋</option>';
  const list = document.querySelector('#friendList');
  list.innerHTML = '';
  if (!ids.length) return;
  const { data: profiles } = await supabase.from('profiles').select('id,display_name,handle').in('id', ids);
  for (const relation of visible) {
    const friendId = relation.requester_id === userId ? relation.addressee_id : relation.requester_id;
    const profile = profiles?.find((candidate) => candidate.id === friendId); if (!profile) continue;
    if (relation.status === 'accepted') select.insertAdjacentHTML('beforeend', `<option value="${profile.id}">${escapeHtml(profile.display_name)} (@${escapeHtml(profile.handle)})</option>`);
    const incoming = relation.status === 'pending' && relation.addressee_id === userId;
    list.insertAdjacentHTML('beforeend', `<div class="friend-row"><span>${escapeHtml(profile.display_name)} <small>@${escapeHtml(profile.handle)}</small></span><span>${
      incoming ? '<button type="button" class="secondary" data-friend-action="accept">承認</button>' : relation.status === 'accepted' ? '<button type="button" class="text-button" data-friend-action="remove">解除</button>' : '<small>申請中</small>'
    }<button type="button" class="text-button" data-friend-action="block">ブロック</button></span></div>`);
    const row = list.lastElementChild;
    for (const button of row.querySelectorAll('[data-friend-action]')) button.onclick = async () => {
      const action = button.dataset.friendAction;
      let query = supabase.from('friendships');
      if (action === 'accept') query = query.update({ status: 'accepted', updated_at: new Date().toISOString() });
      else if (action === 'block') query = query.update({ status: 'blocked', updated_at: new Date().toISOString() });
      else query = query.delete();
      await query.eq('requester_id', relation.requester_id).eq('addressee_id', relation.addressee_id);
      await renderFriends(userId);
    };
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export function getDashboard() { return dashboard; }

export async function trackEvent(eventName, properties = {}) {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('product_events').insert({ user_id: user.id, session_id: analyticsSessionId, event_name: eventName, properties });
}
