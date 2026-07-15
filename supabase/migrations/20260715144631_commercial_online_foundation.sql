create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.match_kind as enum ('ranked_pvp', 'ranked_cpu', 'friend');
create type public.match_status as enum ('waiting', 'setup', 'active', 'finished', 'cancelled');
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');
create type public.item_type as enum ('piece_skin', 'board_theme', 'preset_slot');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_valid_range check (ends_at > starts_at)
);
create unique index seasons_one_active on public.seasons (active) where active;

insert into public.seasons (name, starts_at, ends_at, active)
values ('シーズン1', now(), now() + interval '28 days', true);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text,
  avatar_key text not null default 'lion',
  terms_accepted_at timestamptz,
  onboarding_complete boolean not null default false,
  preset_slots smallint not null default 3 check (preset_slots between 3 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_handle check (handle is null or handle ~ '^[a-z0-9_]{3,20}$'),
  constraint valid_display_name check (display_name is null or char_length(display_name) between 1 and 24)
);

create table public.ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  rating integer not null default 1000 check (rating >= 1000),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  peak_rating integer not null default 1000 check (peak_rating >= 1000),
  promoted_thresholds integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
create index ratings_leaderboard_idx on public.ratings (season_id, rating desc, wins desc);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  acorns integer not null default 300 check (acorns >= 0),
  updated_at timestamptz not null default now()
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, reference_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  kind public.match_kind not null,
  status public.match_status not null default 'waiting',
  mode text not null default 'casual' check (mode in ('casual', 'classic')),
  protocol_version integer not null default 5,
  south_user_id uuid references public.profiles(id) on delete set null,
  north_user_id uuid references public.profiles(id) on delete set null,
  cpu_rank_key text,
  room_code text,
  restricted_friend_id uuid references public.profiles(id) on delete set null,
  winner text check (winner is null or winner in ('south', 'north', 'draw')),
  result_reason text,
  rating_finalized boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranked_is_casual check (kind = 'friend' or mode = 'casual')
);
create unique index matches_open_room_code on public.matches (room_code) where status in ('waiting', 'setup', 'active');
create index matches_south_idx on public.matches (south_user_id, created_at desc);
create index matches_north_idx on public.matches (north_user_id, created_at desc);

create table private.match_states (
  match_id uuid primary key references public.matches(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  south_formation jsonb,
  north_formation jsonb,
  sequence integer not null default 0,
  updated_at timestamptz not null default now()
);

create table private.match_connections (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  sequence integer not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, sequence)
);

create table public.ranked_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  rating integer not null,
  joined_at timestamptz not null default now(),
  matched_id uuid references public.matches(id) on delete set null
);
create index ranked_queue_pairing_idx on public.ranked_queue (joined_at, rating) where matched_id is null;

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  constraint no_self_friend check (requester_id <> addressee_id)
);

create table public.catalog_items (
  id text primary key,
  type public.item_type not null,
  name text not null,
  description text not null default '',
  price_acorns integer not null check (price_acorns >= 0),
  asset_key text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table public.inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.catalog_items(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.loadouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  piece_skin_id text references public.catalog_items(id),
  board_theme_id text references public.catalog_items(id),
  updated_at timestamptz not null default now()
);

create table public.saved_formations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 10),
  mode text not null check (mode in ('casual', 'classic')),
  name text not null check (char_length(name) between 1 and 24),
  positions jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, slot),
  unique (user_id, mode, name)
);

create table public.battle_pass_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  tier text not null default 'free' check (tier in ('free', 'basic', 'premium')),
  claimed_levels integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  provider text not null default 'stripe',
  provider_event_id text unique,
  provider_session_id text unique,
  provider_payment_intent text unique,
  product_key text not null,
  amount_jpy integer not null check (amount_jpy >= 0),
  status text not null check (status in ('pending', 'paid', 'refunded', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  session_id uuid not null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.catalog_items (id, type, name, description, price_acorns, asset_key, sort_order) values
  ('skin_forest', 'piece_skin', '森のなかまたち', '木漏れ日カラーの駒スキン', 500, 'forest', 10),
  ('skin_night', 'piece_skin', '星降る夜', '夜空カラーの駒スキン', 800, 'night', 20),
  ('board_spring', 'board_theme', '春の草原', '花が咲く明るい盤面', 650, 'spring', 30),
  ('board_moon', 'board_theme', '月夜の森', '月明かりに包まれた盤面', 900, 'moon', 40),
  ('preset_slot_1', 'preset_slot', '配置保存枠 4つ目', '保存できる配置を1つ増やします', 250, null, 50),
  ('preset_slot_2', 'preset_slot', '配置保存枠 5つ目', '保存できる配置を1つ増やします', 300, null, 51),
  ('preset_slot_3', 'preset_slot', '配置保存枠 6つ目', '保存できる配置を1つ増やします', 350, null, 52),
  ('preset_slot_4', 'preset_slot', '配置保存枠 7つ目', '保存できる配置を1つ増やします', 400, null, 53),
  ('preset_slot_5', 'preset_slot', '配置保存枠 8つ目', '保存できる配置を1つ増やします', 450, null, 54),
  ('preset_slot_6', 'preset_slot', '配置保存枠 9つ目', '保存できる配置を1つ増やします', 500, null, 55),
  ('preset_slot_7', 'preset_slot', '配置保存枠 10個目', '保存できる配置を1つ増やします', 550, null, 56);

create or replace function public.rank_key(value integer)
returns text language sql immutable parallel safe as $$
  select case
    when value >= 1900 then 'divine'
    when value >= 1800 then 'beast_i'
    when value >= 1700 then 'beast_ii'
    when value >= 1600 then 'beast_iii'
    when value >= 1500 then 'forest_i'
    when value >= 1400 then 'forest_ii'
    when value >= 1300 then 'forest_iii'
    when value >= 1200 then 'small_i'
    when value >= 1100 then 'small_ii'
    else 'small_iii'
  end
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare active_season uuid;
begin
  select id into active_season from public.seasons where active limit 1;
  insert into public.profiles (id, handle, display_name)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8), '森のルーキー');
  insert into public.wallets (user_id, acorns) values (new.id, 300);
  insert into public.wallet_transactions (user_id, amount, reason, reference_id)
  values (new.id, 300, 'launch_bonus', 'initial');
  insert into public.ratings (user_id, season_id) values (new.id, active_season);
  insert into public.battle_pass_progress (user_id, season_id) values (new.id, active_season);
  insert into public.loadouts (user_id) values (new.id);
  return new;
end
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure private.handle_new_user();

create view public.leaderboard with (security_invoker = true) as
select r.season_id, r.user_id, p.handle, p.display_name, p.avatar_key,
       r.rating, public.rank_key(r.rating) as rank_key, r.wins, r.losses, r.draws,
       dense_rank() over (partition by r.season_id, public.rank_key(r.rating) order by r.rating desc, r.wins desc) as rank_position
from public.ratings r join public.profiles p on p.id = r.user_id
where p.onboarding_complete;

alter table public.seasons enable row level security;
alter table public.profiles enable row level security;
alter table public.ratings enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.ranked_queue enable row level security;
alter table public.friendships enable row level security;
alter table public.catalog_items enable row level security;
alter table public.inventory enable row level security;
alter table public.loadouts enable row level security;
alter table public.saved_formations enable row level security;
alter table public.battle_pass_progress enable row level security;
alter table public.purchases enable row level security;
alter table public.product_events enable row level security;
alter table public.webhook_events enable row level security;

create policy seasons_read on public.seasons for select to authenticated using (true);
create policy profiles_read on public.profiles for select to authenticated using (onboarding_complete or id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy ratings_read on public.ratings for select to authenticated using (true);
create policy wallets_self on public.wallets for select to authenticated using (user_id = (select auth.uid()));
create policy wallet_transactions_self on public.wallet_transactions for select to authenticated using (user_id = (select auth.uid()));
create policy matches_participants on public.matches for select to authenticated
  using ((select auth.uid()) in (south_user_id, north_user_id));
create policy match_events_participants on public.match_events for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and (select auth.uid()) in (m.south_user_id, m.north_user_id)));
create policy queue_self_read on public.ranked_queue for select to authenticated using (user_id = (select auth.uid()));
create policy queue_self_delete on public.ranked_queue for delete to authenticated using (user_id = (select auth.uid()));
create policy friendships_members on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_request on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and requester_id <> addressee_id and status = 'pending');
create policy friendships_update_members on public.friendships for update to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id))
  with check (
    (status = 'accepted' and addressee_id = (select auth.uid()))
    or (status = 'blocked' and (select auth.uid()) in (requester_id, addressee_id))
  );
create policy friendships_delete_members on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy catalog_read on public.catalog_items for select to authenticated using (active);
create policy inventory_self on public.inventory for select to authenticated using (user_id = (select auth.uid()));
create policy loadouts_self_read on public.loadouts for select to authenticated using (user_id = (select auth.uid()));
create policy loadouts_self_update on public.loadouts for update to authenticated
  using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid())
    and (piece_skin_id is null or exists (
      select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id
      where i.user_id = (select auth.uid()) and i.item_id = piece_skin_id and c.type = 'piece_skin'
    ))
    and (board_theme_id is null or exists (
      select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id
      where i.user_id = (select auth.uid()) and i.item_id = board_theme_id and c.type = 'board_theme'
    ))
  );
create policy saved_formations_self_read on public.saved_formations for select to authenticated using (user_id = (select auth.uid()));
create policy saved_formations_self_insert on public.saved_formations for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and slot <= p.preset_slots)
);
create policy saved_formations_self_update on public.saved_formations for update to authenticated
  using (user_id = (select auth.uid())) with check (
    user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and slot <= p.preset_slots)
  );
create policy saved_formations_self_delete on public.saved_formations for delete to authenticated using (user_id = (select auth.uid()));
create policy battle_pass_self on public.battle_pass_progress for select to authenticated using (user_id = (select auth.uid()));
create policy purchases_self on public.purchases for select to authenticated using (user_id = (select auth.uid()));
create policy events_insert_self on public.product_events for insert to authenticated
  with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.seasons, public.profiles, public.ratings, public.leaderboard, public.catalog_items to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_key) on public.profiles to authenticated;
grant select on public.wallets, public.wallet_transactions, public.matches, public.match_events,
  public.ranked_queue, public.friendships, public.inventory, public.loadouts,
  public.saved_formations, public.battle_pass_progress, public.purchases to authenticated;
grant insert, update, delete on public.friendships to authenticated;
grant delete on public.ranked_queue to authenticated;
grant update on public.loadouts to authenticated;
grant insert, update, delete on public.saved_formations to authenticated;
grant insert on public.product_events to authenticated;

-- Private Realtime topics are scoped to a match participant or the user's own queue topic.
create policy realtime_match_read on realtime.messages for select to authenticated using (
  split_part(realtime.topic(), ':', 1) = 'match' and exists (
    select 1 from public.matches m
    where m.id::text = split_part(realtime.topic(), ':', 2)
      and (select auth.uid()) in (m.south_user_id, m.north_user_id)
  )
  or realtime.topic() = 'queue:' || (select auth.uid())::text
);
create policy realtime_match_write on realtime.messages for insert to authenticated with check (
  split_part(realtime.topic(), ':', 1) = 'match' and exists (
    select 1 from public.matches m
    where m.id::text = split_part(realtime.topic(), ':', 2)
      and (select auth.uid()) in (m.south_user_id, m.north_user_id)
  )
);

create or replace function public.complete_profile(new_handle text, new_display_name text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if new_handle !~ '^[a-z0-9_]{3,20}$' then raise exception 'invalid handle'; end if;
  if char_length(new_display_name) not between 1 and 24 then raise exception 'invalid display name'; end if;
  update public.profiles set handle = new_handle, display_name = new_display_name,
    terms_accepted_at = now(), onboarding_complete = true, updated_at = now()
  where id = auth.uid() returning * into result;
  return result;
end
$$;
revoke all on function public.complete_profile(text, text) from public;
grant execute on function public.complete_profile(text, text) to authenticated;

create or replace function public.join_ranked_queue()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); active_season uuid; my_rating integer; opponent record; new_match uuid; waited integer;
begin
  if me is null then raise exception 'authentication required'; end if;
  select id into active_season from public.seasons where active limit 1;
  select rating into my_rating from public.ratings where user_id = me and season_id = active_season;
  if my_rating is null then raise exception 'rating not found'; end if;
  insert into public.ranked_queue (user_id, season_id, rating, joined_at, matched_id)
  values (me, active_season, my_rating, now(), null)
  on conflict (user_id) do update set season_id = excluded.season_id, rating = excluded.rating, joined_at = now(), matched_id = null;
  waited := 0;
  select q.* into opponent from public.ranked_queue q
  where q.user_id <> me and q.season_id = active_season and q.matched_id is null
    and abs(q.rating - my_rating) <= 100
  order by q.joined_at for update skip locked limit 1;
  if opponent.user_id is null then return jsonb_build_object('status', 'waiting', 'joinedAt', now()); end if;
  insert into public.matches (kind, status, mode, south_user_id, north_user_id)
  values ('ranked_pvp', 'setup', 'casual', opponent.user_id, me) returning id into new_match;
  insert into private.match_states (match_id) values (new_match);
  update public.ranked_queue set matched_id = new_match where user_id in (me, opponent.user_id);
  return jsonb_build_object('status', 'matched', 'matchId', new_match);
end
$$;
revoke all on function public.join_ranked_queue() from public;
grant execute on function public.join_ranked_queue() to authenticated;

create or replace function public.poll_ranked_queue()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); mine record; opponent record; new_match uuid; range_limit integer;
begin
  if me is null then raise exception 'authentication required'; end if;
  select * into mine from public.ranked_queue where user_id = me for update;
  if mine.user_id is null then return jsonb_build_object('status', 'missing'); end if;
  if mine.matched_id is not null then return jsonb_build_object('status', 'matched', 'matchId', mine.matched_id); end if;
  range_limit := 100 + least(300, floor(extract(epoch from now() - mine.joined_at) / 5)::integer * 100);
  select q.* into opponent from public.ranked_queue q
  where q.user_id <> me and q.season_id = mine.season_id and q.matched_id is null
    and abs(q.rating - mine.rating) <= range_limit
  order by q.joined_at for update skip locked limit 1;
  if opponent.user_id is null then return jsonb_build_object('status', 'waiting', 'range', range_limit); end if;
  insert into public.matches (kind, status, mode, south_user_id, north_user_id)
  values ('ranked_pvp', 'setup', 'casual', opponent.user_id, me) returning id into new_match;
  insert into private.match_states (match_id) values (new_match);
  update public.ranked_queue set matched_id = new_match where user_id in (me, opponent.user_id);
  return jsonb_build_object('status', 'matched', 'matchId', new_match);
end
$$;
revoke all on function public.poll_ranked_queue() from public;
grant execute on function public.poll_ranked_queue() to authenticated;

create or replace function public.claim_cpu_fallback()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); mine record; new_match uuid; cpu_key text;
begin
  if me is null then raise exception 'authentication required'; end if;
  select * into mine from public.ranked_queue where user_id = me for update;
  if mine.user_id is null then raise exception 'queue entry not found'; end if;
  if mine.matched_id is not null then return jsonb_build_object('status', 'matched', 'matchId', mine.matched_id); end if;
  if now() < mine.joined_at + interval '20 seconds' then return jsonb_build_object('status', 'waiting'); end if;
  cpu_key := public.rank_key(mine.rating);
  insert into public.matches (kind, status, mode, south_user_id, cpu_rank_key)
  values ('ranked_cpu', 'setup', 'casual', me, cpu_key) returning id into new_match;
  insert into private.match_states (match_id) values (new_match);
  update public.ranked_queue set matched_id = new_match where user_id = me;
  return jsonb_build_object('status', 'cpu', 'matchId', new_match, 'cpuRank', cpu_key);
end
$$;
revoke all on function public.claim_cpu_fallback() from public;
grant execute on function public.claim_cpu_fallback() to authenticated;

create or replace function public.create_friend_match(friend_id uuid, requested_mode text, requested_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); new_match uuid;
begin
  if me is null then raise exception 'authentication required'; end if;
  if requested_mode not in ('casual', 'classic') then raise exception 'invalid mode'; end if;
  if requested_code !~ '^[A-Z2-9]{4}$' then raise exception 'invalid room code'; end if;
  if friend_id is not null and not exists (
    select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester_id = me and f.addressee_id = friend_id) or (f.addressee_id = me and f.requester_id = friend_id))
  ) then raise exception 'accepted friendship required'; end if;
  insert into public.matches (kind, status, mode, south_user_id, restricted_friend_id, room_code)
  values ('friend', 'waiting', requested_mode, me, friend_id, requested_code) returning id into new_match;
  insert into private.match_states (match_id) values (new_match);
  return new_match;
end
$$;
revoke all on function public.create_friend_match(uuid, text, text) from public;
grant execute on function public.create_friend_match(uuid, text, text) to authenticated;

create or replace function public.join_friend_match(requested_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); target public.matches;
begin
  if me is null then raise exception 'authentication required'; end if;
  select * into target from public.matches where room_code = requested_code and status = 'waiting' for update;
  if target.id is null then raise exception 'room not found'; end if;
  if target.south_user_id = me then raise exception 'cannot join own room'; end if;
  if target.restricted_friend_id is not null and target.restricted_friend_id <> me then raise exception 'room is restricted'; end if;
  update public.matches set north_user_id = me, status = 'setup', updated_at = now() where id = target.id;
  return target.id;
end
$$;
revoke all on function public.join_friend_match(text) from public;
grant execute on function public.join_friend_match(text) to authenticated;

create or replace function public.buy_catalog_item(requested_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); item public.catalog_items; balance integer;
begin
  if me is null then raise exception 'authentication required'; end if;
  select * into item from public.catalog_items where id = requested_item and active for update;
  if item.id is null then raise exception 'item not found'; end if;
  if item.type = 'preset_slot' and item.id <> 'preset_slot_' || ((select preset_slots from public.profiles where id = me) - 2)::text
  then raise exception 'purchase preset slots in order'; end if;
  if exists (select 1 from public.inventory where user_id = me and item_id = item.id) then raise exception 'already owned'; end if;
  select acorns into balance from public.wallets where user_id = me for update;
  if balance < item.price_acorns then raise exception 'insufficient acorns'; end if;
  update public.wallets set acorns = acorns - item.price_acorns, updated_at = now() where user_id = me;
  insert into public.wallet_transactions (user_id, amount, reason, reference_id)
  values (me, -item.price_acorns, 'shop_purchase', item.id);
  insert into public.inventory (user_id, item_id) values (me, item.id);
  if item.type = 'preset_slot' then update public.profiles set preset_slots = least(10, preset_slots + 1) where id = me; end if;
  return jsonb_build_object('ok', true, 'balance', balance - item.price_acorns);
end
$$;
revoke all on function public.buy_catalog_item(text) from public;
grant execute on function public.buy_catalog_item(text) to authenticated;

create or replace function public.finalize_match_result(target_match uuid, result_winner text, result_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.matches; season uuid; south_rating integer; north_rating integer; south_score numeric; expected numeric;
  k integer; south_delta integer := 0; north_delta integer := 0; reward_user uuid; reward integer := 0;
  old_rank integer; new_rating integer; north_new integer; threshold integer; promotion_reward integer := 0;
begin
  select * into m from public.matches where id = target_match for update;
  if m.id is null then raise exception 'match not found'; end if;
  if m.rating_finalized then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if result_winner not in ('south', 'north', 'draw') then raise exception 'invalid winner'; end if;
  select id into season from public.seasons where active limit 1;
  select rating into south_rating from public.ratings where user_id = m.south_user_id and season_id = season for update;
  south_score := case result_winner when 'south' then 1 when 'draw' then 0.5 else 0 end;
  if m.kind = 'ranked_cpu' then
    north_rating := case public.rank_key(south_rating)
      when 'small_iii' then 1050 when 'small_ii' then 1150 when 'small_i' then 1250
      when 'forest_iii' then 1350 when 'forest_ii' then 1450 when 'forest_i' then 1550
      when 'beast_iii' then 1650 when 'beast_ii' then 1750 when 'beast_i' then 1850 else 1950 end;
    k := 16;
  elsif m.kind = 'ranked_pvp' then
    select rating into north_rating from public.ratings where user_id = m.north_user_id and season_id = season for update;
    k := 32;
  else
    k := 0;
  end if;
  if k > 0 then
    expected := 1 / (1 + power(10::numeric, (north_rating - south_rating)::numeric / 400));
    south_delta := round(k * (south_score - expected));
    old_rank := south_rating;
    new_rating := greatest(1000, south_rating + south_delta);
    update public.ratings set rating = new_rating, peak_rating = greatest(peak_rating, new_rating),
      wins = wins + case when result_winner = 'south' then 1 else 0 end,
      losses = losses + case when result_winner = 'north' then 1 else 0 end,
      draws = draws + case when result_winner = 'draw' then 1 else 0 end, updated_at = now()
    where user_id = m.south_user_id and season_id = season;
    foreach threshold in array array[1100,1200,1300,1400,1500,1600,1700,1800,1900] loop
      if old_rank < threshold and new_rating >= threshold and not exists (
        select 1 from public.wallet_transactions where user_id = m.south_user_id and reason = 'rank_promotion'
          and reference_id = season::text || ':' || threshold::text
      ) then
        insert into public.wallet_transactions (user_id, amount, reason, reference_id)
        values (m.south_user_id, 100, 'rank_promotion', season::text || ':' || threshold::text);
        update public.wallets set acorns = acorns + 100 where user_id = m.south_user_id;
        promotion_reward := promotion_reward + 100;
      end if;
    end loop;
    if m.kind = 'ranked_pvp' then
      north_delta := -south_delta;
      north_new := greatest(1000, north_rating + north_delta);
      update public.ratings set rating = north_new,
        peak_rating = greatest(peak_rating, north_new),
        wins = wins + case when result_winner = 'north' then 1 else 0 end,
        losses = losses + case when result_winner = 'south' then 1 else 0 end,
        draws = draws + case when result_winner = 'draw' then 1 else 0 end, updated_at = now()
      where user_id = m.north_user_id and season_id = season;
      foreach threshold in array array[1100,1200,1300,1400,1500,1600,1700,1800,1900] loop
        if north_rating < threshold and north_new >= threshold and not exists (
          select 1 from public.wallet_transactions where user_id = m.north_user_id and reason = 'rank_promotion'
            and reference_id = season::text || ':' || threshold::text
        ) then
          insert into public.wallet_transactions (user_id, amount, reason, reference_id)
          values (m.north_user_id, 100, 'rank_promotion', season::text || ':' || threshold::text);
          update public.wallets set acorns = acorns + 100 where user_id = m.north_user_id;
          promotion_reward := promotion_reward + 100;
        end if;
      end loop;
    end if;
  end if;
  if result_winner in ('south', 'north') then
    reward_user := case result_winner when 'south' then m.south_user_id else m.north_user_id end;
    reward := case m.kind when 'ranked_pvp' then 30 when 'ranked_cpu' then 15 else 0 end;
    if m.kind = 'friend' and (
      select count(*) from public.wallet_transactions where user_id = reward_user and reason = 'friend_win'
        and created_at >= date_trunc('day', now())
    ) < 3 then reward := 10; end if;
    if reward > 0 and reward_user is not null then
      insert into public.wallet_transactions (user_id, amount, reason, reference_id)
      values (reward_user, reward, case when m.kind = 'friend' then 'friend_win' else 'ranked_win' end, m.id::text)
      on conflict do nothing;
      if found then update public.wallets set acorns = acorns + reward, updated_at = now() where user_id = reward_user; end if;
    end if;
  end if;
  update public.matches set status = 'finished', winner = result_winner, result_reason = result_reason,
    rating_finalized = true, finished_at = now(), updated_at = now() where id = m.id;
  update public.battle_pass_progress set points = points + case when result_winner = 'draw' then 25 else 50 end, updated_at = now()
  where season_id = season and user_id in (m.south_user_id, m.north_user_id);
  delete from public.ranked_queue where matched_id = m.id;
  return jsonb_build_object('ok', true, 'southDelta', south_delta, 'northDelta', north_delta,
    'reward', reward, 'promotionReward', promotion_reward);
end
$$;
revoke all on function public.finalize_match_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finalize_match_result(uuid, text, text) to service_role;

create or replace function public.server_store_formation(target_match uuid, actor uuid, formation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.matches; role_key text; next_sequence integer;
begin
  select * into m from public.matches where id = target_match for update;
  if actor = m.south_user_id then role_key := 'south'; elsif actor = m.north_user_id then role_key := 'north'; else raise exception 'not a participant'; end if;
  if m.status not in ('setup', 'waiting') then raise exception 'formation phase closed'; end if;
  update private.match_states set south_formation = case when role_key = 'south' then formation else south_formation end,
    north_formation = case when role_key = 'north' then formation else north_formation end,
    sequence = sequence + 1, updated_at = now() where match_id = target_match returning sequence into next_sequence;
  insert into public.match_events (match_id, sequence, actor_user_id, event_type, public_payload)
  values (target_match, next_sequence, actor, 'formation_ready', jsonb_build_object('role', role_key));
  if exists (select 1 from private.match_states where match_id = target_match and south_formation is not null and (north_formation is not null or m.kind = 'ranked_cpu'))
  then update public.matches set status = 'active', started_at = coalesce(started_at, now()), updated_at = now() where id = target_match; end if;
  select * into m from public.matches where id = target_match;
  return (select jsonb_build_object('sequence', next_sequence, 'kind', m.kind, 'mode', m.mode,
    'cpuRank', m.cpu_rank_key, 'southFormation', south_formation, 'northFormation', north_formation,
    'ready', south_formation is not null and (north_formation is not null or m.kind = 'ranked_cpu'))
    from private.match_states where match_id = target_match);
end
$$;
revoke all on function public.server_store_formation(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.server_store_formation(uuid, uuid, jsonb) to service_role;

create or replace function public.server_start_match(target_match uuid, actor uuid, first_turn text)
returns integer language plpgsql security definer set search_path = '' as $$
declare m public.matches; next_sequence integer;
begin
  select * into m from public.matches where id = target_match for update;
  if actor <> m.south_user_id then raise exception 'only host can start'; end if;
  if first_turn not in ('south', 'north') then raise exception 'invalid first turn'; end if;
  if not exists (select 1 from private.match_states where match_id = target_match and south_formation is not null
    and (north_formation is not null or m.kind = 'ranked_cpu'))
  then raise exception 'formations incomplete'; end if;
  update private.match_states set sequence = sequence + 1,
    state = jsonb_set(state, '{turn}', to_jsonb(first_turn), true), updated_at = now()
  where match_id = target_match returning sequence into next_sequence;
  update public.matches set status = 'active', started_at = coalesce(started_at, now()), updated_at = now() where id = target_match;
  insert into public.match_events (match_id, sequence, actor_user_id, event_type, public_payload)
  values (target_match, next_sequence, actor, 'start', jsonb_build_object('firstTurn', first_turn));
  return next_sequence;
end
$$;
revoke all on function public.server_start_match(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.server_start_match(uuid, uuid, text) to service_role;

create or replace function public.server_set_initial_state(target_match uuid, initialized_state jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.match_states set state = initialized_state, updated_at = now() where match_id = target_match;
end
$$;
revoke all on function public.server_set_initial_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.server_set_initial_state(uuid, jsonb) to service_role;

create or replace function public.server_get_game_state(target_match uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('state', s.state, 'sequence', s.sequence, 'kind', m.kind, 'cpuRank', m.cpu_rank_key,
    'southUserId', m.south_user_id, 'northUserId', m.north_user_id, 'status', m.status)
  from private.match_states s join public.matches m on m.id = s.match_id where s.match_id = target_match
$$;
revoke all on function public.server_get_game_state(uuid) from public, anon, authenticated;
grant execute on function public.server_get_game_state(uuid) to service_role;

create or replace function public.server_commit_game_state(target_match uuid, expected_sequence integer,
  committed_state jsonb, actor uuid, event_payload jsonb, event_name text default 'move')
returns integer language plpgsql security definer set search_path = '' as $$
declare next_sequence integer;
begin
  update private.match_states set state = committed_state, sequence = sequence + 1, updated_at = now()
  where match_id = target_match and sequence = expected_sequence returning sequence into next_sequence;
  if next_sequence is null then raise exception 'stale sequence'; end if;
  insert into public.match_events (match_id, sequence, actor_user_id, event_type, public_payload)
  values (target_match, next_sequence, actor, event_name, event_payload);
  return next_sequence;
end
$$;
revoke all on function public.server_commit_game_state(uuid, integer, jsonb, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.server_commit_game_state(uuid, integer, jsonb, uuid, jsonb, text) to service_role;

create or replace function public.server_match_heartbeat(target_match uuid, actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.matches where id = target_match and actor in (south_user_id, north_user_id))
  then raise exception 'not a participant'; end if;
  insert into private.match_connections (match_id, user_id, last_seen) values (target_match, actor, now())
  on conflict (match_id, user_id) do update set last_seen = excluded.last_seen;
end
$$;
revoke all on function public.server_match_heartbeat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_match_heartbeat(uuid, uuid) to service_role;

create or replace function public.server_claim_disconnect(target_match uuid, actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.matches; opponent uuid; seen timestamptz; winner_role text; result jsonb;
begin
  select * into m from public.matches where id = target_match for update;
  if actor = m.south_user_id then opponent := m.north_user_id; winner_role := 'south';
  elsif actor = m.north_user_id then opponent := m.south_user_id; winner_role := 'north';
  else raise exception 'not a participant'; end if;
  if m.status in ('finished', 'cancelled') then return jsonb_build_object('status', m.status); end if;
  select last_seen into seen from private.match_connections where match_id = target_match and user_id = opponent;
  if coalesce(seen, m.started_at, m.created_at) > now() - interval '60 seconds'
  then return jsonb_build_object('status', 'waiting'); end if;
  if m.status in ('waiting', 'setup') then
    update public.matches set status = 'cancelled', result_reason = 'setup_disconnect', updated_at = now() where id = target_match;
    delete from public.ranked_queue where matched_id = target_match;
    return jsonb_build_object('status', 'cancelled', 'rated', false);
  end if;
  result := public.finalize_match_result(target_match, winner_role, 'disconnect');
  return jsonb_build_object('status', 'finished', 'winner', winner_role, 'rated', m.kind in ('ranked_pvp', 'ranked_cpu'), 'result', result);
end
$$;
revoke all on function public.server_claim_disconnect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.server_claim_disconnect(uuid, uuid) to service_role;

create or replace function public.rollover_season(next_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous uuid; created uuid;
begin
  select id into previous from public.seasons where active for update;
  update public.seasons set active = false where id = previous;
  insert into public.seasons (name, starts_at, ends_at, active)
  values (next_name, now(), now() + interval '28 days', true) returning id into created;
  insert into public.ratings (user_id, season_id, rating, peak_rating)
  select p.id, created, greatest(1000, round(1000 + (coalesce(r.rating, 1000) - 1000) * 0.5)),
    greatest(1000, round(1000 + (coalesce(r.rating, 1000) - 1000) * 0.5))
  from public.profiles p left join public.ratings r on r.user_id = p.id and r.season_id = previous;
  insert into public.battle_pass_progress (user_id, season_id) select id, created from public.profiles;
  return created;
end
$$;
revoke all on function public.rollover_season(text) from public, anon, authenticated;
grant execute on function public.rollover_season(text) to service_role;
