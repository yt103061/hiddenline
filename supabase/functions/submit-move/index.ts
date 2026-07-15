import { applyAuthorizedMove, chooseCpuMove, projectState, publicMove } from '../_shared/game-engine.ts';
import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

async function finalizeIfFinished(matchId: string, state: Record<string, unknown>) {
  if (!state.winner) return null;
  const { data, error } = await admin.rpc('finalize_match_result', {
    target_match: matchId,
    result_winner: state.winner,
    result_reason: state.reason || 'hq',
  });
  if (error) throw error;
  return data;
}

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const body = await request.json();
    const { data: snapshot, error: snapshotError } = await admin.rpc('server_get_game_state', { target_match: body.matchId });
    if (snapshotError) throw snapshotError;
    if (!snapshot || snapshot.status !== 'active') throw new ResponseError(409, '対局が開始されていません。');

    const owner = snapshot.southUserId === user.id ? 'south' : snapshot.northUserId === user.id ? 'north' : null;
    if (!owner) throw new ResponseError(403, '対局参加者ではありません。');
    if (Number(body.sequence) !== Number(snapshot.sequence)) throw new ResponseError(409, '対局状態が更新されています。');

    const applied = applyAuthorizedMove(snapshot.state, body.move, owner);
    const { data: sequence, error: commitError } = await admin.rpc('server_commit_game_state', {
      target_match: body.matchId,
      expected_sequence: snapshot.sequence,
      committed_state: applied.state,
      actor: user.id,
      event_payload: publicMove(applied.move),
      event_name: 'move',
    });
    if (commitError) throw commitError;

    const playerState = applied.state;
    let currentState = playerState;
    let currentSequence = sequence;
    let cpuMove = null;
    if (snapshot.kind === 'ranked_cpu' && !currentState.winner && currentState.turn === 'north') {
      cpuMove = chooseCpuMove(currentState, snapshot.cpuRank);
      if (cpuMove) {
        const cpuApplied = applyAuthorizedMove(currentState, cpuMove, 'north');
        const { data: cpuSequence, error: cpuError } = await admin.rpc('server_commit_game_state', {
          target_match: body.matchId,
          expected_sequence: currentSequence,
          committed_state: cpuApplied.state,
          actor: null,
          event_payload: publicMove(cpuApplied.move),
          event_name: 'cpu_move',
        });
        if (cpuError) throw cpuError;
        currentState = cpuApplied.state;
        currentSequence = cpuSequence;
      }
    }

    const result = await finalizeIfFinished(body.matchId, currentState);
    return json({
      sequence: currentSequence,
      move: publicMove(applied.move),
      cpuMove: cpuMove ? publicMove(cpuMove) : null,
      playerState: projectState(playerState, owner),
      state: projectState(currentState, owner),
      winner: currentState.winner || null,
      reason: currentState.reason || null,
      result,
    });
  } catch (error) { return handleError(error); }
});
