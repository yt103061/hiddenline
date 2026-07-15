import { projectState } from '../_shared/game-engine.ts';
import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const { matchId } = await request.json();
    const { data: snapshot, error } = await admin.rpc('server_get_game_state', { target_match: matchId });
    if (error) throw error;
    const viewer = snapshot?.southUserId === user.id ? 'south' : snapshot?.northUserId === user.id ? 'north' : null;
    if (!viewer) throw new ResponseError(403, '対局参加者ではありません。');
    if (!snapshot.state?.pieces) throw new ResponseError(409, '対局状態を準備しています。');
    return json({ sequence: snapshot.sequence, state: projectState(snapshot.state, viewer), viewer, status: snapshot.status });
  } catch (error) { return handleError(error); }
});
