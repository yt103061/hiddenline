import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('create_friend_match', (body) => ({ friend_id: body.friendId || null, requested_mode: body.mode, requested_code: body.code })));
