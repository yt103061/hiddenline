const AUTH_HASH_KEYS = ['access_token', 'refresh_token', 'expires_in', 'token_type', 'error', 'error_description'];
const AUTH_QUERY_KEYS = ['code', 'error', 'error_code', 'error_description'];

export function hasAuthCallbackInUrl(locationLike = globalThis.location) {
  if (!locationLike) return false;
  const hash = new URLSearchParams(String(locationLike.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(locationLike.search || '');
  return AUTH_HASH_KEYS.some((key) => hash.has(key)) || AUTH_QUERY_KEYS.some((key) => query.has(key));
}

export function authCallbackError(locationLike = globalThis.location) {
  if (!locationLike) return '';
  const hash = new URLSearchParams(String(locationLike.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(locationLike.search || '');
  return hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error') || '';
}

export function clearAuthCallbackUrl(locationLike = globalThis.location, historyLike = globalThis.history) {
  if (!locationLike || !historyLike || !hasAuthCallbackInUrl(locationLike)) return;
  historyLike.replaceState({ screen: 'home' }, '', locationLike.pathname || '/');
}
