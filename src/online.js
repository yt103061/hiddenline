import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROTOCOL_VERSION = 4;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

let supabasePromise = null;
let clientPromise = null;

function loadSupabase() {
  if (!supabasePromise) {
    supabasePromise = import('https://esm.sh/@supabase/supabase-js@2').catch((error) => {
      supabasePromise = null;
      throw error;
    });
  }
  return supabasePromise;
}

function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = loadSupabase().then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}

export function selectRandomPair(players) {
  return [...players]
    .filter((player) => player?.id)
    .sort((a, b) => (a.joinedAt - b.joinedAt) || a.id.localeCompare(b.id))
    .slice(0, 2);
}

export class RandomMatchmaker {
  constructor() {
    this.channel = null;
    this.clientId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    this.joinedAt = Date.now();
    this.claimed = false;
    this.onMatch = null;
  }

  async join(mode, onMatch) {
    const client = await getSupabaseClient();
    this.onMatch = onMatch;
    this.channel = client.channel(`hiddenline:matchmaking:${PROTOCOL_VERSION}:${mode}`, {
      config: { presence: { key: this.clientId }, broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'match' }, ({ payload }) => {
      if (payload.protocolVersion !== PROTOCOL_VERSION || payload.guestId !== this.clientId || this.claimed) return;
      this.claimed = true;
      this.onMatch?.({ code: payload.code, role: 'guest' });
    });

    this.channel.on('presence', { event: 'sync' }, () => this._pairIfReady());

    await new Promise((resolve, reject) => {
      this.channel.subscribe(async (status, error) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({ id: this.clientId, joinedAt: this.joinedAt });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(error || new Error('マッチングへの接続に失敗しました'));
        }
      });
    });
  }

  async _pairIfReady() {
    if (this.claimed || !this.channel) return;
    const players = Object.values(this.channel.presenceState()).flat().map((entry) => ({
      id: entry.id,
      joinedAt: Number(entry.joinedAt) || 0,
    }));
    const [host, guest] = selectRandomPair(players);
    if (!host || !guest || host.id !== this.clientId) return;

    this.claimed = true;
    const code = generateRoomCode();
    await this.channel.send({
      type: 'broadcast',
      event: 'match',
      payload: { protocolVersion: PROTOCOL_VERSION, guestId: guest.id, code },
    });
    this.onMatch?.({ code, role: 'host' });
  }

  leave() {
    this.channel?.unsubscribe();
    this.channel = null;
    this.onMatch = null;
  }
}

export class OnlineRoom {
  constructor() {
    this.channel = null;
    this.role = null;
    this.handlers = {};
    this.memberCount = 0;
  }

  on(type, handler) {
    this.handlers[type] = handler;
  }

  async host(code) {
    this.role = 'host';
    await this._join(code);
  }

  async guest(code) {
    this.role = 'guest';
    await this._join(code);
  }

  async _join(code) {
    const client = await getSupabaseClient();
    const selfKey = `${this.role}-${Math.random().toString(36).slice(2, 8)}`;

    this.channel = client.channel(`hiddenline:${code}`, {
      config: { presence: { key: selfKey }, broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (payload.protocolVersion !== PROTOCOL_VERSION) {
        this.handlers.protocolError?.({ expected: PROTOCOL_VERSION, received: payload.protocolVersion ?? 1 });
        return;
      }
      this.handlers[payload.type]?.(payload);
    });

    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      this.memberCount = Object.keys(state).length;
      this.handlers.presence?.(this.memberCount);
    });

    this.channel.on('presence', { event: 'leave' }, () => {
      if (this.memberCount > 1) this.handlers.leave?.();
    });

    await new Promise((resolve, reject) => {
      this.channel.subscribe(async (status, error) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({ role: this.role });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(error || new Error('接続に失敗しました'));
        }
      });
    });
  }

  send(type, payload = {}) {
    this.channel?.send({ type: 'broadcast', event: 'msg', payload: { type, protocolVersion: PROTOCOL_VERSION, ...payload } });
  }

  leave() {
    this.channel?.unsubscribe();
    this.channel = null;
    this.handlers = {};
  }
}
