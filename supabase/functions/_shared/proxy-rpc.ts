import { admin, handleError, json, preflight, requireUser } from './server.ts';

export function rpcHandler(rpc: string, buildArgs: (body: Record<string, unknown>, userId: string) => Record<string, unknown> = (body) => body) {
  return async (request: Request) => {
    const early = preflight(request); if (early) return early;
    try {
      const user = await requireUser(request);
      const body = request.headers.get('content-type')?.includes('json') ? await request.json() : {};
      const { data, error } = await admin.rpc(rpc, buildArgs(body, user.id));
      if (error) throw error;
      return json(data);
    } catch (error) { return handleError(error); }
  };
}
