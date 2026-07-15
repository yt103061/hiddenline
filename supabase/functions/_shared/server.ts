import { createClient, type User } from 'npm:@supabase/supabase-js@2.100.0';

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function keyFromJson(name: string, fallback: string) {
  const raw = Deno.env.get(name);
  if (!raw) return Deno.env.get(fallback) || '';
  try { return JSON.parse(raw).default || Object.values(JSON.parse(raw))[0] || ''; } catch { return raw; }
}

export const url = Deno.env.get('SUPABASE_URL') || '';
export const publishableKey = keyFromJson('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
export const secretKey = keyFromJson('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
export const admin = createClient(url, secretKey, { auth: { persistSession: false } });

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function preflight(request: Request) {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export async function requireUser(request: Request): Promise<User> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new ResponseError(401, 'ログインが必要です。');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ResponseError(401, 'セッションが無効です。');
  return data.user;
}

export class ResponseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function handleError(error: unknown) {
  if (error instanceof ResponseError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: error instanceof Error ? error.message : 'サーバーエラーが発生しました。' }, 500);
}
