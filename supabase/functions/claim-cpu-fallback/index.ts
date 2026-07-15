import { rpcHandler } from '../_shared/proxy-rpc.ts';
Deno.serve(rpcHandler('claim_cpu_fallback'));
