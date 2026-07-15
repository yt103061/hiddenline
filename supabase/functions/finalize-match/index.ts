import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const { matchId } = await request.json();
    const { data: snapshot, error: snapshotError } = await admin.rpc('server_get_game_state', { target_match: matchId });
    if (snapshotError) throw snapshotError;
    if (!snapshot || ![snapshot.southUserId, snapshot.northUserId].includes(user.id)) throw new ResponseError(403, '対局参加者ではありません。');
    if (!snapshot.state?.winner) throw new ResponseError(409, 'サーバー上で勝敗が確定していません。');
    const { data, error } = await admin.rpc('finalize_match_result', {
      target_match: matchId,
      result_winner: snapshot.state.winner,
      result_reason: snapshot.state.reason || 'hq',
    });
    if (error) throw error;
    return json(data);
  } catch (error) { return handleError(error); }
});
