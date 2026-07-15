import { applyAuthorizedMove, chooseCpuMove, projectState, publicMove } from '../_shared/game-engine.ts';
import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const { data: snapshot, error } = await admin.rpc('server_get_game_state', { target_match: body.matchId });
    if (error) throw error;
    if (!snapshot || snapshot.kind !== 'ranked_cpu' || snapshot.southUserId !== user.id) throw new ResponseError(403, 'CPU対局ではありません。');
    if (snapshot.status !== 'active' || snapshot.state?.turn !== 'north') throw new ResponseError(409, 'CPUの手番ではありません。');
    if (Number(body.sequence) !== Number(snapshot.sequence)) throw new ResponseError(409, '対局状態が更新されています。');
    const move = chooseCpuMove(snapshot.state, snapshot.cpuRank);
    if (!move) throw new ResponseError(409, 'CPUに合法手がありません。');
    const applied = applyAuthorizedMove(snapshot.state, move, 'north');
    const { data: sequence, error: commitError } = await admin.rpc('server_commit_game_state', {
      target_match: body.matchId,
      expected_sequence: snapshot.sequence,
      committed_state: applied.state,
      actor: null,
      event_payload: publicMove(applied.move),
      event_name: 'cpu_move',
    });
    if (commitError) throw commitError;
    if (applied.state.winner) {
      const { error: finalError } = await admin.rpc('finalize_match_result', {
        target_match: body.matchId,
        result_winner: applied.state.winner,
        result_reason: applied.state.reason || 'hq',
      });
      if (finalError) throw finalError;
    }
    return json({
      sequence,
      cpuMove: publicMove(move),
      state: projectState(applied.state, 'south'),
      winner: applied.state.winner || null,
      reason: applied.state.reason || null,
    });
  } catch (error) { return handleError(error); }
});
