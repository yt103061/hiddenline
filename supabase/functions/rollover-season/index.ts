import { admin, handleError, json, preflight, ResponseError } from '../_shared/server.ts';
Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) throw new ResponseError(401, 'unauthorized');
    const { name } = await request.json();
    const { data, error } = await admin.rpc('rollover_season', { next_name: name });
    if (error) throw error; return json({ seasonId: data });
  } catch (error) { return handleError(error); }
});
