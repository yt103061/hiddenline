import { admin, handleError, json, preflight, requireUser } from '../_shared/server.ts';
Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request);
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    await admin.auth.admin.signOut(token, 'global');
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return json({ ok: true });
  }
  catch (error) { return handleError(error); }
});
