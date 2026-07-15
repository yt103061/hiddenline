import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('server_claim_disconnect', (body, userId) => ({ target_match: body.matchId, actor: userId })));
