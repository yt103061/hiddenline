import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('server_start_match', (body, userId) => ({ target_match: body.matchId, actor: userId, first_turn: body.firstTurn })));
