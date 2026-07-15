import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('server_match_heartbeat', (body, userId) => ({ target_match: body.matchId, actor: userId })));
