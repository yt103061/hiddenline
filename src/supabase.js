import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL as LEGACY_URL, SUPABASE_ANON_KEY as LEGACY_KEY } from './config.js';

const env = import.meta.env || {};
const configuredUrl = env.VITE_SUPABASE_URL || LEGACY_URL;
const configuredKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || LEGACY_KEY;
const url = configuredUrl || 'https://example.supabase.co';
const key = configuredKey || 'sb_publishable_local_placeholder';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

export const backendConfigured = Boolean(configuredUrl && configuredKey);

export async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function invokeRpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
