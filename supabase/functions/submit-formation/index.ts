import { cpuFormation, initialState } from '../_shared/game-engine.ts';
import { admin, handleError, json, preflight, requireUser } from '../_shared/server.ts';

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const { data, error } = await admin.rpc('server_store_formation', {
      target_match: body.matchId,
      actor: user.id,
      formation: body.formation,
    });
    if (error) throw error;

    if (data?.ready) {
      const north = data.kind === 'ranked_cpu' ? cpuFormation(data.mode) : data.northFormation;
      const state = initialState(data.mode, data.southFormation, north);
      const { error: stateError } = await admin.rpc('server_set_initial_state', {
        target_match: body.matchId,
        initialized_state: state,
      });
      if (stateError) throw stateError;
    }
    return json({ sequence: data?.sequence, ready: Boolean(data?.ready) });
  } catch (error) { return handleError(error); }
});
