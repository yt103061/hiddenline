import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request); const { matchId } = await request.json();
    const { data: match } = await admin.from('matches').select('*').eq('id', matchId).single();
    if (!match || ![match.south_user_id, match.north_user_id].includes(user.id)) throw new ResponseError(403, '対局参加者ではありません。');
    if (match.status !== 'active') {
      const { error: cancelError } = await admin.from('matches').update({ status: 'cancelled', result_reason: 'setup_resign' }).eq('id', matchId);
      if (cancelError) throw cancelError;
      await admin.from('ranked_queue').delete().eq('matched_id', matchId);
      return json({ ok: true, rated: false });
    }
    const winner = match.south_user_id === user.id ? 'north' : 'south';
    const { data, error } = await admin.rpc('finalize_match_result', { target_match: matchId, result_winner: winner, result_reason: 'resign' });
    if (error) throw error; return json({ ...data, rated: match.kind.startsWith('ranked_') });
  } catch (error) { return handleError(error); }
});
