import { supabase, invokeRpc, currentUser } from './supabase.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROTOCOL_VERSION = 5;

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function selectRandomPair(players) {
  return [...players]
    .filter((player) => player?.id)
    .sort((a, b) => (a.joinedAt - b.joinedAt) || a.id.localeCompare(b.id))
    .slice(0, 2);
}

export class RandomMatchmaker {
  constructor() {
    this.timer = null;
    this.startedAt = 0;
    this.onMatch = null;
  }

  async join(_mode, onMatch, onTick = null) {
    this.onMatch = onMatch;
    this.startedAt = Date.now();
    const initial = await invokeRpc('join_ranked_queue');
    if (initial.status === 'matched') return this._resolveMatch(initial.matchId);
    this.timer = setInterval(async () => {
      try {
        const elapsed = Date.now() - this.startedAt;
        onTick?.(Math.max(0, 20 - Math.floor(elapsed / 1000)));
        const result = elapsed >= 20000
          ? await invokeRpc('claim_cpu_fallback')
          : await invokeRpc('poll_ranked_queue');
        if (result.status === 'matched') await this._resolveMatch(result.matchId);
        if (result.status === 'cpu') {
          this._stopTimer();
          this.onMatch?.({ matchId: result.matchId, cpu: true, cpuRank: result.cpuRank });
        }
      } catch (error) {
        this._stopTimer();
        onTick?.(null, error);
      }
    }, 1000);
  }

  async _resolveMatch(matchId) {
    this._stopTimer();
    const user = await currentUser();
    const { data, error } = await supabase.from('matches').select('south_user_id,north_user_id').eq('id', matchId).single();
    if (error) throw error;
    this.onMatch?.({ matchId, role: data.south_user_id === user.id ? 'host' : 'guest' });
  }

  _stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async leave() {
    this._stopTimer();
    const user = await currentUser();
    if (user) await supabase.from('ranked_queue').delete().eq('user_id', user.id);
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
    const client = supabase;
    const selfKey = `${this.role}-${Math.random().toString(36).slice(2, 8)}`;

    this.channel = client.channel(`match:${code}`, {
      config: { private: true, presence: { key: selfKey }, broadcast: { self: false } },
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
