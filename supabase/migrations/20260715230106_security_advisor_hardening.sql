alter function public.rank_key(integer) set search_path = '';

revoke all on function public.complete_profile(text, text) from anon;
revoke all on function public.join_ranked_queue() from anon;
revoke all on function public.poll_ranked_queue() from anon;
revoke all on function public.claim_cpu_fallback() from anon;
revoke all on function public.create_friend_match(uuid, text, text) from anon;
revoke all on function public.join_friend_match(text) from anon;
revoke all on function public.buy_catalog_item(text) from anon;
