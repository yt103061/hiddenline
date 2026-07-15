import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('join_ranked_queue'));
