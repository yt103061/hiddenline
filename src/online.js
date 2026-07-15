import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

let supabasePromise = null;

function loadSupabase() {
  if (!supabasePromise) {
    supabasePromise = import('https://esm.sh/@supabase/supabase-js@2').catch((error) => {
      supabasePromise = null;
      throw error;
    });
  }
  return supabasePromise;
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
    const { createClient } = await loadSupabase();
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const selfKey = `${this.role}-${Math.random().toString(36).slice(2, 8)}`;

    this.channel = client.channel(`hiddenline:${code}`, {
      config: { presence: { key: selfKey }, broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
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
    this.channel?.send({ type: 'broadcast', event: 'msg', payload: { type, ...payload } });
  }

  leave() {
    this.channel?.unsubscribe();
    this.channel = null;
    this.handlers = {};
  }
}
