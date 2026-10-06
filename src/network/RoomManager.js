/**
 * RoomManager.js
 * 多人連線網路傳輸層封裝（支援 2 分鐘同步競賽、PB 解法廣播、雙模切換）。
 *
 * 雙模式切換機制：
 * 1. 若設定有 SUPABASE_URL 與 SUPABASE_ANON_KEY（可從 localStorage 或 window.SUPABASE_CONFIG 讀取），
 *    則使用 Supabase Realtime Channel 的 broadcast 廣播事件。
 * 2. 若無設定 Key（預設狀態），自動回退使用瀏覽器 / Node.js 原生的 BroadcastChannel API。
 *    允許同台電腦開啟多個瀏覽器分頁無縫測試連線、同步競速、回報個人最佳解法！
 */

export const NETWORK_MODE = Object.freeze({
  BROADCAST_CHANNEL: 'BroadcastChannel (Local Tabs)',
  SUPABASE_REALTIME: 'Supabase Realtime (Cloud)',
});

export const MSG_TYPE = Object.freeze({
  PLAYER_JOIN: 'PLAYER_JOIN',
  PLAYER_LEAVE: 'PLAYER_LEAVE',
  SYNC_REQUEST: 'SYNC_REQUEST',
  SYNC_RESPONSE: 'SYNC_RESPONSE',
  START_GAME: 'START_GAME',         // 房主啟動遊戲（第 1 題開跑）
  LOBBY_UPDATE: 'LOBBY_UPDATE',     // 大廳設定同步（變體開關等）
  NEW_ROUND: 'NEW_ROUND',
  REPORT_PB: 'REPORT_PB',           // 回報個人最佳解 (PB)
  ROUND_END_SYNC: 'ROUND_END_SYNC', // 回合結算同步
  GAME_OVER_SYNC: 'GAME_OVER_SYNC', // 17 題完賽終局同步
  GAME_RESTART: 'GAME_RESTART',     // 重新開局
  // 保持向後相容
  BID: 'BID',
  COUNTDOWN_START: 'COUNTDOWN_START',
  COUNTDOWN_END: 'COUNTDOWN_END',
  DEMO_MOVE: 'DEMO_MOVE',
  DEMO_FORFEIT: 'DEMO_FORFEIT',
  DEMO_RESET: 'DEMO_RESET',
  ROUND_END: 'ROUND_END',
  CHAT: 'CHAT',
});

function generateId() {
  return 'p_' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).substring(4);
}

function getSupabaseConfig() {
  if (typeof window === 'undefined') return null;
  const url =
    window.__SUPABASE_URL__ ||
    window.SUPABASE_CONFIG?.url ||
    window.localStorage?.getItem('SUPABASE_URL');
  const anonKey =
    window.__SUPABASE_ANON_KEY__ ||
    window.SUPABASE_CONFIG?.anonKey ||
    window.localStorage?.getItem('SUPABASE_ANON_KEY');
  if (url && anonKey) {
    return { url, anonKey };
  }
  return null;
}

export class RoomManager {
  constructor() {
    this.roomId = null;
    this.userId = generateId();
    this.userName = 'Player';
    this.isHost = false;
    this.mode = getSupabaseConfig() ? NETWORK_MODE.SUPABASE_REALTIME : NETWORK_MODE.BROADCAST_CHANNEL;

    this._channel = null;
    this._supabase = null;
    this._listeners = new Map();
  }

  getEffectiveMode() {
    const config = getSupabaseConfig();
    return config ? NETWORK_MODE.SUPABASE_REALTIME : NETWORK_MODE.BROADCAST_CHANNEL;
  }

  async reconfigure() {
    if (this.roomId) {
      const room = this.roomId;
      const name = this.userName;
      return this._connect(room, name);
    }
    this.mode = this.getEffectiveMode();
    return { mode: this.mode };
  }

  // ---------- 事件監聽模式 ----------

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
  }

  _emit(event, data) {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
    // 通用訊息監聽器
    if (event !== '*') {
      const all = this._listeners.get('*');
      if (all) {
        for (const fn of all) {
          try {
            fn(event, data);
          } catch (err) {
            console.error(`Error in wildcard listener for ${event}:`, err);
          }
        }
      }
    }
  }

  // ---------- 建立與加入房間 ----------

  /**
   * 建立房間（建立者預設為房主 isHost = true）。
   */
  async createRoom(roomId, userName) {
    this.isHost = true;
    return this._connect(roomId, userName);
  }

  /**
   * 加入已存在的房間。
   */
  async joinRoom(roomId, userName) {
    this.isHost = false;
    return this._connect(roomId, userName);
  }

  async _connect(roomId, userName) {
    this.roomId = String(roomId).trim();
    if (userName && userName.trim()) this.userName = userName.trim();

    await this.leaveRoom();

    const config = getSupabaseConfig();
    if (config) {
      await this._initSupabase(config);
    } else {
      this._initBroadcastChannel();
    }

    this._emit('connected', {
      roomId: this.roomId,
      userId: this.userId,
      userName: this.userName,
      isHost: this.isHost,
      mode: this.mode,
    });

    // 廣播加入通知
    this.send(MSG_TYPE.PLAYER_JOIN, {
      player: {
        id: this.userId,
        name: this.userName,
        isHost: this.isHost,
      },
    });

    // 若非房主，主動向房主索取當前房間狀態快照
    if (!this.isHost) {
      this.send(MSG_TYPE.SYNC_REQUEST, {
        requesterId: this.userId,
      });
    }

    return {
      roomId: this.roomId,
      userId: this.userId,
      userName: this.userName,
      isHost: this.isHost,
      mode: this.mode,
    };
  }

  _initBroadcastChannel() {
    this.mode = NETWORK_MODE.BROADCAST_CHANNEL;
    const channelName = `ricochet_robots_room_${this.roomId}`;
    this._channel = new BroadcastChannel(channelName);
    this._channel.onmessage = (event) => {
      this._handleIncomingMessage(event.data);
    };
  }

  async _initSupabase(config) {
    try {
      this.mode = NETWORK_MODE.SUPABASE_REALTIME;
      let createClient = typeof window !== 'undefined' ? window.supabase?.createClient : null;
      if (!createClient) {
        const mod = await import('https://esm.sh/@supabase/supabase-js@2');
        createClient = mod.createClient;
      }
      this._supabase = createClient(config.url, config.anonKey);
      const channelName = `room_${this.roomId}`;
      this._channel = this._supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });

      this._channel.on('broadcast', { event: 'room_msg' }, (payload) => {
        this._handleIncomingMessage(payload.payload);
      });

      await new Promise((resolve, reject) => {
        this._channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`Supabase subscribe status ${status}, falling back to BroadcastChannel`);
            this._initBroadcastChannel();
            resolve();
          }
        });
      });
    } catch (err) {
      console.warn('Failed to initialize Supabase, fallback to BroadcastChannel:', err);
      this._initBroadcastChannel();
    }
  }

  async leaveRoom() {
    if (!this.roomId) return;
    try {
      this.send(MSG_TYPE.PLAYER_LEAVE, {
        playerId: this.userId,
      });
    } catch {
      // 忽略
    }

    if (this._channel) {
      if (typeof this._channel.close === 'function') {
        this._channel.close();
      } else if (typeof this._channel.unsubscribe === 'function') {
        this._channel.unsubscribe();
      }
      this._channel = null;
    }
    this._emit('disconnected', { roomId: this.roomId });
    this.roomId = null;
  }

  // ---------- 訊息發送與接收 ----------

  /**
   * 發送訊息封包給同房間所有其他玩家。
   */
  send(type, payload = {}) {
    if (!this._channel) return;

    const envelope = {
      type,
      roomId: this.roomId,
      senderId: this.userId,
      senderName: this.userName,
      timestamp: Date.now(),
      payload,
    };

    if (this.mode === NETWORK_MODE.SUPABASE_REALTIME && this._channel.send) {
      this._channel.send({
        type: 'broadcast',
        event: 'room_msg',
        payload: envelope,
      });
    } else if (this._channel.postMessage) {
      this._channel.postMessage(envelope);
    }
  }

  _handleIncomingMessage(msg) {
    if (!msg || msg.roomId !== this.roomId) return;
    if (msg.senderId === this.userId) return;

    this._emit(msg.type, {
      type: msg.type,
      senderId: msg.senderId,
      senderName: msg.senderName,
      timestamp: msg.timestamp,
      payload: msg.payload || {},
    });
  }

  // ---------- 語意化動作介面 ----------

  /** 回報個人最佳解 (PB) */
  sendSolution(moves, extra = {}) {
    this.send(MSG_TYPE.REPORT_PB, {
      playerId: this.userId,
      playerName: this.userName,
      moves: Number(moves),
      timestamp: Date.now(),
      ...extra,
    });
  }

  /** 相容舊版下注發送 */
  sendBid(moves) {
    this.send(MSG_TYPE.BID, {
      playerId: this.userId,
      playerName: this.userName,
      moves: Number(moves),
      timestamp: Date.now(),
    });
  }

  /** 房主發送回合結束結算同步 */
  sendRoundEndSync(data) {
    this.send(MSG_TYPE.ROUND_END_SYNC, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /** 房主發送重新開局同步 */
  sendGameRestart(data) {
    this.send(MSG_TYPE.GAME_RESTART, {
      ...data,
      timestamp: Date.now(),
    });
  }

  /** 展示者發送滑動移動 (相容舊版) */
  sendMove(robotColor, direction) {
    this.send(MSG_TYPE.DEMO_MOVE, {
      playerId: this.userId,
      robotColor,
      direction,
      timestamp: Date.now(),
    });
  }

  /** 展示者發送放棄展示 (相容舊版) */
  forfeit() {
    this.send(MSG_TYPE.DEMO_FORFEIT, {
      playerId: this.userId,
      timestamp: Date.now(),
    });
  }

  /** 房主發送新回合開局資料 */
  sendNewRound(roundData) {
    this.send(MSG_TYPE.NEW_ROUND, {
      ...roundData,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  /** 房主發送開始遊戲通知（第 1 題開跑） */
  sendStartGame(roundData) {
    this.send(MSG_TYPE.START_GAME, {
      ...roundData,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  /** 房主發送大廳設定變更廣播（變體開關等） */
  sendLobbyUpdate(data) {
    this.send(MSG_TYPE.LOBBY_UPDATE, {
      ...data,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  /** 房主發送全狀態快照同步 */
  sendSyncResponse(targetPlayerId, snapshot) {
    this.send(MSG_TYPE.SYNC_RESPONSE, {
      targetPlayerId,
      snapshot,
      timestamp: Date.now(),
    });
  }

  /** 發送倒數計時開始 */
  sendCountdownStart(countdownEnd, durationSec = 120) {
    this.send(MSG_TYPE.COUNTDOWN_START, {
      countdownEnd,
      durationSec,
      timestamp: Date.now(),
    });
  }

  /** 發送倒數結束 */
  sendCountdownEnd() {
    this.send(MSG_TYPE.COUNTDOWN_END, {
      timestamp: Date.now(),
    });
  }
}
