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
  REQUEST_ROOM_SYNC: 'REQUEST_ROOM_SYNC', // 訪客主動向房主索取狀態
  ROOM_SYNC_PAYLOAD: 'ROOM_SYNC_PAYLOAD', // 房主回傳完整地圖與成員狀態
  ROOM_SYNC_ACK: 'ROOM_SYNC_ACK',         // 訪客收到同步後回傳 ACK
  HELLO_JOIN: 'HELLO_JOIN',               // 新玩家主動送出加入廣播
  ROOM_SYNC: 'ROOM_SYNC',                 // 規格 3: 房主回應房間同步資訊
  SYNC_STATE: 'SYNC_STATE',               // 房主回送全狀態同步 (地圖配置、機器人起點、變體開關、玩家名單)
  PRESENCE_PING: 'PRESENCE_PING',         // 在線心跳 Ping (每 2 秒一次維護在線玩家名單)
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
  // Node 測試第 4 節特定測試全域變數
  if (window.__SUPABASE_URL__ && window.__SUPABASE_ANON_KEY__) {
    return { url: window.__SUPABASE_URL__, anonKey: window.__SUPABASE_ANON_KEY__ };
  }
  if (window.USE_SUPABASE) {
    const url = window.localStorage?.getItem('SUPABASE_URL');
    const anonKey = window.localStorage?.getItem('SUPABASE_ANON_KEY');
    if (url && anonKey) return { url, anonKey };
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
    this._heartbeatTimer = null;
    this._listeners = new Map();
    this._storageHandler = null;
    this._recentPackets = new Set();
  }

  get channel() {
    return this._channel;
  }

  set channel(ch) {
    this._channel = ch;
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

  /**
   * 連線至房間（可指定是否為房主）。
   */
  async connect(roomId, userName, isHost = false) {
    this.isHost = Boolean(isHost);
    return this._connect(roomId, userName);
  }

  async _connect(roomId, userName) {
    await this.leaveRoom();

    this.roomId = String(roomId).trim();
    if (userName && userName.trim()) this.userName = userName.trim();

    const config = getSupabaseConfig();
    if (config) {
      await this._initSupabase(config);
    } else {
      this._initBroadcastChannel();
    }

    // 綁定 LocalStorage 共享狀態匯流排監聽（同瀏覽器跨分頁 100% 觸發）
    this._bindStorageListener();

    this._emit('connected', {
      roomId: this.roomId,
      userId: this.userId,
      userName: this.userName,
      isHost: this.isHost,
      mode: this.mode,
    });

    // 廣播加入通知 (HELLO_JOIN 與 PLAYER_JOIN 雙發確保相容)
    this.send(MSG_TYPE.HELLO_JOIN, {
      user: {
        id: this.userId,
        name: this.userName,
      },
      player: {
        id: this.userId,
        name: this.userName,
        isHost: this.isHost,
      },
    });
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

    // 啟動在線心跳 Ping (每 2 秒一次維護在線玩家名單)
    this._startHeartbeat();

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
    const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
    const channelName = `rr_room_${cleanRoomId}`;
    if (this._channel) {
      try {
        if (typeof this._channel.close === 'function') this._channel.close();
      } catch (err) {
        // 忽略
      }
      this._channel = null;
    }
    this._channel = new BroadcastChannel(channelName);

    const onMessage = (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== MSG_TYPE.PRESENCE_PING) {
          console.log('[Broadcast Received]', data);
        }
        this._handleIncomingMessage(data);
      } catch (err) {
        console.error('[Broadcast Message Parse Error]', err);
      }
    };

    if (typeof this._channel.addEventListener === 'function') {
      this._channel.addEventListener('message', onMessage);
    } else {
      this._channel.onmessage = onMessage;
    }
  }

  broadcast(msg) {
    const envelope = {
      ...(typeof msg === 'object' && msg !== null ? msg : { payload: msg }),
      _senderId: this.userId,
      _roomId: String(this.roomId || ''),
      _time: Date.now() + Math.random(), // 保證每次寫入 storage 的 value 都不同，強制觸發 storage 事件
    };

    // 1. 寫入 LocalStorage（跨分頁 100% 觸發 storage 事件）
    try {
      if (typeof localStorage !== 'undefined' && this.roomId) {
        const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
        const busKey = `rr_bus_${cleanRoomId}`;
        localStorage.setItem(busKey, JSON.stringify(envelope));
      }
    } catch (e) {
      console.warn('[LocalStorage Bus Write Error]', e);
    }

    // 2. 同步發送 BroadcastChannel 作為雙重保障
    if (this._channel) {
      try {
        const msgType = msg?.type || (typeof msg === 'object' && msg?.payload?.type);
        if (msgType !== MSG_TYPE.PRESENCE_PING) {
          console.log('[DEBUG_CHANNEL_SEND]', msg);
        }
        this._channel.postMessage(typeof msg === 'string' ? msg : JSON.stringify(envelope));
      } catch (err) {
        console.error('[Broadcast Post Error]', err);
      }
    }
  }

  _bindStorageListener() {
    if (typeof window === 'undefined') return;
    this._unbindStorageListener();

    const cleanRoomId = String(this.roomId || '').replace(/[^a-zA-Z0-9]/g, '');
    const targetKey = `rr_bus_${cleanRoomId}`;

    this._storageHandler = (e) => {
      if (!e || e.key !== targetKey || !e.newValue) return;
      try {
        const packet = JSON.parse(e.newValue);
        // 忽略自己發出的訊息
        if (packet._senderId === this.userId) return;
        this._handleIncomingMessage(packet);
      } catch (err) {
        console.error('[Storage Bus Parse Error]', err);
      }
    };

    window.addEventListener('storage', this._storageHandler);
  }

  _unbindStorageListener() {
    if (typeof window !== 'undefined' && this._storageHandler) {
      window.removeEventListener('storage', this._storageHandler);
      this._storageHandler = null;
    }
  }

  setRoomSnapshot(snapshot) {
    if (typeof localStorage === 'undefined' || !this.roomId) return;
    try {
      const clean = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
      localStorage.setItem(`rr_snapshot_${clean}`, JSON.stringify(snapshot));
      localStorage.setItem(`rr_room_state_${clean}`, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[setRoomSnapshot Error]', e);
    }
  }

  getRoomSnapshot(roomId = this.roomId) {
    if (typeof localStorage === 'undefined' || !roomId) return null;
    try {
      const clean = String(roomId).replace(/[^a-zA-Z0-9]/g, '');
      const raw =
        localStorage.getItem(`rr_snapshot_${clean}`) ||
        localStorage.getItem(`rr_room_state_${clean}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[getRoomSnapshot Error]', e);
      return null;
    }
  }

  async _initSupabase(config) {
    try {
      this.mode = NETWORK_MODE.SUPABASE_REALTIME;
      let createClient = typeof window !== 'undefined' ? window.supabase?.createClient : null;
      if (!createClient) {
        try {
          const mod = await import('https://esm.sh/@supabase/supabase-js@2');
          createClient = mod.createClient;
        } catch (e) {
          console.warn('[Supabase SDK Dynamic Import Error]', e);
        }
      }
      if (!createClient) {
        throw new Error('Supabase client SDK not available');
      }

      this._supabase = createClient(config.url, config.anonKey);
      const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
      const channelName = `room_${cleanRoomId}`;
      this._channel = this._supabase.channel(channelName, {
        config: {
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });

      // 1. 監聽廣播訊息 (room_msg 與 room_sync)
      this._channel.on('broadcast', { event: 'room_msg' }, (payload) => {
        this._handleIncomingMessage(payload.payload);
      });
      this._channel.on('broadcast', { event: 'room_sync' }, (payload) => {
        this._handleIncomingMessage(payload.payload);
      });

      // 2. 監聽 Presence 狀態變化 (sync / join / leave)
      this._channel.on('presence', { event: 'sync' }, () => {
        const state = typeof this._channel.presenceState === 'function' ? this._channel.presenceState() : {};
        console.log('[Supabase Presence Sync]', state);
        const members = [];
        for (const [key, presences] of Object.entries(state)) {
          if (Array.isArray(presences) && presences.length > 0) {
            const p = presences[0];
            members.push({
              id: p.id || key,
              name: p.name || '玩家',
              isHost: Boolean(p.isHost),
              score: p.score || 0,
            });
          }
        }
        this._emit('presence_sync', { members, presenceState: state });
      });

      this._channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('[Supabase Presence Join]', key, newPresences);
        if (Array.isArray(newPresences) && newPresences.length > 0) {
          const p = newPresences[0];
          const joinEvent = {
            type: MSG_TYPE.PLAYER_JOIN,
            player: { id: p.id || key, name: p.name || '玩家', isHost: Boolean(p.isHost) },
            user: { id: p.id || key, name: p.name || '玩家' },
          };
          this._handleIncomingMessage(joinEvent);
          this._emit(MSG_TYPE.PLAYER_JOIN, joinEvent);
        }
      });

      this._channel.on('presence', { event: 'leave' }, ({ key }) => {
        console.log('[Supabase Presence Leave]', key);
        const leaveEvent = {
          type: MSG_TYPE.PLAYER_LEAVE,
          payload: { playerId: key },
        };
        this._handleIncomingMessage(leaveEvent);
        this._emit(MSG_TYPE.PLAYER_LEAVE, leaveEvent);
      });

      await new Promise((resolve) => {
        this._channel.subscribe(async (status) => {
          console.log(`[Supabase Channel Status] ${channelName}:`, status);
          if (status === 'SUBSCRIBED') {
            try {
              if (typeof this._channel.track === 'function') {
                await this._channel.track({
                  id: this.userId,
                  name: this.userName,
                  isHost: this.isHost,
                });
              }
            } catch (e) {
              console.warn('[Presence Track Error]', e);
            }
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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

  _startHeartbeat() {
    this._stopHeartbeat();
    if (typeof setInterval === 'undefined') return;
    this._heartbeatTimer = setInterval(() => {
      try {
        if (this.roomId && this._channel) {
          this.send(MSG_TYPE.PRESENCE_PING, {
            player: {
              id: this.userId,
              name: this.userName,
              isHost: this.isHost,
            },
          });
        }
      } catch (e) {
        // 心跳在後台默默維持，不拋出錯誤
      }
    }, 2000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async leaveRoom() {
    this._stopHeartbeat();
    this._unbindStorageListener();
    if (!this.roomId) return;
    try {
      this.send(MSG_TYPE.PLAYER_LEAVE, {
        playerId: this.userId,
      });
    } catch {
      // 忽略
    }

    if (this._channel) {
      if (typeof this._channel.untrack === 'function') {
        try {
          await this._channel.untrack().catch?.(() => {});
        } catch {}
      }
      if (typeof this._channel.unsubscribe === 'function') {
        try {
          await this._channel.unsubscribe().catch?.(() => {});
        } catch {}
      }
      if (typeof this._channel.close === 'function') {
        try {
          this._channel.close();
        } catch {}
      }
      this._channel = null;
    }
    this._emit('disconnected', { roomId: this.roomId });
    this.roomId = null;
  }

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
      ...payload,
    };

    if (type !== MSG_TYPE.PRESENCE_PING) {
      console.log(`[RoomSync] [Send ${type}]`, envelope);
    }

    if (this.mode === NETWORK_MODE.SUPABASE_REALTIME && this._channel.send) {
      const eventName =
        type === MSG_TYPE.ROOM_SYNC || type === MSG_TYPE.ROOM_SYNC_PAYLOAD
          ? 'room_sync'
          : 'room_msg';
      this._channel.send({
        type: 'broadcast',
        event: eventName,
        payload: envelope,
      });
      // 雙保險：本地 LocalStorage 匯流排同步廣播
      this.broadcast(envelope);
    } else {
      this.broadcast(envelope);
    }
  }

  _handleIncomingMessage(msg) {
    if (!msg) return;
    const msgRoom = msg.roomId || msg._roomId;
    if (msgRoom) {
      const cleanMsgRoom = String(msgRoom).replace(/[^a-zA-Z0-9]/g, '');
      const cleanMyRoom = String(this.roomId || '').replace(/[^a-zA-Z0-9]/g, '');
      if (cleanMsgRoom && cleanMyRoom && cleanMsgRoom !== cleanMyRoom) return;
    }
    const senderId =
      msg._senderId ||
      msg.senderId ||
      msg.user?.id ||
      msg.player?.id ||
      msg.sender?.id ||
      msg.hostId ||
      msg.payload?._senderId ||
      msg.payload?.senderId ||
      msg.payload?.user?.id ||
      msg.payload?.player?.id ||
      msg.payload?.sender?.id;

    if (senderId && senderId === this.userId) return;

    // 防重複過濾 (防止 LocalStorage Bus 與 BroadcastChannel 雙重觸發同一訊息)
    const packetUid = msg._time || msg.timestamp;
    if (packetUid && senderId && msg.type) {
      const dedupKey = `${senderId}_${packetUid}_${msg.type}`;
      if (this._recentPackets && this._recentPackets.has(dedupKey)) {
        return;
      }
      if (this._recentPackets) {
        this._recentPackets.add(dedupKey);
        if (this._recentPackets.size > 100) {
          const firstKey = this._recentPackets.keys().next().value;
          this._recentPackets.delete(firstKey);
        }
      }
    }

    if (msg.type !== MSG_TYPE.PRESENCE_PING) {
      console.log(`[RoomSync] [Received ${msg.type}] from ${senderId || 'unknown'}:`, msg);
    }

    const senderName =
      msg.senderName ||
      msg.user?.name ||
      msg.player?.name ||
      msg.sender?.name ||
      msg.payload?.senderName ||
      msg.payload?.user?.name ||
      msg.payload?.player?.name ||
      msg.payload?.sender?.name ||
      '';

    const emitted = {
      type: msg.type,
      senderId: senderId || '',
      senderName,
      timestamp: msg.timestamp || Date.now(),
      payload: msg.payload || msg,
      user: msg.user || msg.payload?.user,
      player: msg.player || msg.payload?.player,
      ...msg,
    };

    this._emit(msg.type, emitted);
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

  /** 房主發送全狀態同步 (SYNC_STATE) */
  sendSyncState(targetPlayerId, syncData) {
    this.send(MSG_TYPE.SYNC_STATE, {
      targetPlayerId,
      hostId: this.userId,
      ...syncData,
      timestamp: Date.now(),
    });
  }

  /** 房主發送全狀態快照同步 (SYNC_RESPONSE) */
  sendSyncResponse(targetPlayerId, snapshotOrData) {
    const payload =
      snapshotOrData && snapshotOrData.snapshot
        ? snapshotOrData
        : { snapshot: snapshotOrData };
    this.send(MSG_TYPE.SYNC_RESPONSE, {
      targetPlayerId,
      ...payload,
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
