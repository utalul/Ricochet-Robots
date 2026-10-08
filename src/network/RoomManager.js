/**
 * RoomManager.js
 * 多人連線網路傳輸層封裝（支援 2 分鐘同步競賽、PB 解法廣播、雙模切換）。
 *
 * 支援模式：
 * 1. Firebase Realtime Database (雲端跨裝置、手機與電腦連線、永不休眠)
 * 2. Supabase / Mock (相容模擬測試)
 * 3. BroadcastChannel (本地多分頁免連網測試)
 */
import { getFirebaseConfig, FIREBASE_CONFIG } from '../config.js';

export const NETWORK_MODE = Object.freeze({
  BROADCAST_CHANNEL: 'BroadcastChannel (Local Tabs)',
  FIREBASE_REALTIME: 'Firebase Realtime (Cloud)',
  SUPABASE_REALTIME: 'Firebase Realtime (Cloud)', // 相容別名
});

export const MSG_TYPE = Object.freeze({
  REQUEST_ROOM_SYNC: 'REQUEST_ROOM_SYNC', // 訪客主動向房主索取狀態
  ROOM_SYNC_PAYLOAD: 'ROOM_SYNC_PAYLOAD', // 房主回傳完整地圖與成員狀態
  ROOM_SYNC_ACK: 'ROOM_SYNC_ACK',         // 訪客收到同步後回傳 ACK
  HELLO_JOIN: 'HELLO_JOIN',               // 新玩家主動送出加入廣播
  ROOM_SYNC: 'ROOM_SYNC',                 // 房主回應房間同步資訊
  SYNC_STATE: 'SYNC_STATE',               // 房主回送全狀態同步
  PRESENCE_PING: 'PRESENCE_PING',         // 在線心跳 Ping
  PLAYER_JOIN: 'PLAYER_JOIN',
  PLAYER_LEAVE: 'PLAYER_LEAVE',
  PLAYER_COLOR_REQUEST: 'PLAYER_COLOR_REQUEST',
  PLAYER_KICK: 'PLAYER_KICK',
  ROOM_PLAYERS_SYNC: 'ROOM_PLAYERS_SYNC',
  ROOM_LEADERBOARD_SYNC: 'ROOM_LEADERBOARD_SYNC',
  ROOM_CLOSED: 'ROOM_CLOSED',
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
  const storageKey = 'ricochet_player_id';
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage?.getItem(storageKey) : null;
    if (saved) return saved;
  } catch {}

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'p_' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).substring(4);
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(storageKey, id);
  } catch {}
  return id;
}

const isRealtimeDebugEnabled = () =>
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

function realtimeLog(...args) {
  if (isRealtimeDebugEnabled()) console.info('[Ricochet Realtime]', ...args);
}

export class RoomManager {
  constructor() {
    this.roomId = null;
    this.userId = generateId();
    this.userName = 'Player';
    this.isHost = false;
    this.mode = this.getEffectiveMode();

    this._channel = null;
    this._fb = null;
    this._fbListeners = [];
    this._heartbeatTimer = null;
    this._listeners = new Map();
    this._storageHandler = null;
    this._recentPackets = new Set();
    this.connectionStatus = 'CLOSED';
    this.connectionError = null;
  }

  get channel() {
    return this._channel;
  }

  set channel(ch) {
    this._channel = ch;
  }

  getEffectiveMode() {
    if (typeof window !== 'undefined') {
      if (window.__SUPABASE_URL__ && window.supabase) {
        return NETWORK_MODE.SUPABASE_REALTIME;
      }
      const fbConfig = getFirebaseConfig();
      if (fbConfig) return NETWORK_MODE.FIREBASE_REALTIME;
    }
    return NETWORK_MODE.BROADCAST_CHANNEL;
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

  async createRoom(roomId, userName) {
    this.isHost = true;
    return this._connect(roomId, userName);
  }

  async joinRoom(roomId, userName) {
    this.isHost = false;
    return this._connect(roomId, userName);
  }

  async connect(roomId, userName, isHost = false) {
    this.isHost = Boolean(isHost);
    return this._connect(roomId, userName);
  }

  async _connect(roomId, userName) {
    await this.leaveRoom();

    this.roomId = String(roomId).trim();
    if (userName && userName.trim()) this.userName = userName.trim();

    // 判斷連線驅動
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (typeof window !== 'undefined' && window.__SUPABASE_URL__ && window.supabase) {
      // 支援 Mock / Supabase 測試環境
      await this._initSupabase({
        url: window.__SUPABASE_URL__,
        anonKey: window.__SUPABASE_ANON_KEY__,
      });
    } else if (isBrowser) {
      const fbConfig = getFirebaseConfig();
      if (fbConfig) {
        const ok = await this._initFirebase(fbConfig);
        if (!ok) this._initBroadcastChannel();
      } else {
        this._initBroadcastChannel();
      }
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

    // 廣播加入通知
    this.send(MSG_TYPE.HELLO_JOIN, {
      user: { id: this.userId, name: this.userName },
      player: { id: this.userId, name: this.userName, isHost: this.isHost },
    });
    this.send(MSG_TYPE.PLAYER_JOIN, {
      player: { id: this.userId, name: this.userName, isHost: this.isHost },
    });

    if (!this.isHost) {
      this.send(MSG_TYPE.SYNC_REQUEST, { requesterId: this.userId });
    }

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
      } catch (err) {}
      this._channel = null;
    }
    if (typeof BroadcastChannel !== 'undefined') {
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
  }

  broadcast(msg) {
    const envelope = {
      ...(typeof msg === 'object' && msg !== null ? msg : { payload: msg }),
      _senderId: this.userId,
      _roomId: String(this.roomId || ''),
      _time: Date.now() + Math.random(),
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

    // 2. 同步發送 BroadcastChannel
    if (this._channel && typeof this._channel.postMessage === 'function') {
      try {
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
        if (packet._senderId === this.userId) return;
        this._handleIncomingMessage(packet);
      } catch (err) {
        console.error('[Storage Bus Parse Error]', err);
      }
    };

    window.addEventListener('storage', this._storageHandler);
  }

  _unbindStorageListener() {
    if (this._storageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this._storageHandler);
      this._storageHandler = null;
    }
  }

  // ---------- 快照存取 (Firebase + LocalStorage) ----------

  setRoomSnapshot(snapshot) {
    this.saveRoomSnapshot(snapshot);
  }

  async saveRoomSnapshot(snapshot) {
    if (!this.roomId || !snapshot) return;
    const clean = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`rr_snapshot_${clean}`, JSON.stringify(snapshot));
        localStorage.setItem(`rr_room_state_${clean}`, JSON.stringify(snapshot));
      }
    } catch (e) {
      console.warn('[saveRoomSnapshot localStorage Error]', e);
    }

    // 同步寫入 Firebase Realtime Database
    if (this._fb && this._fb.db) {
      try {
        const snapRef = this._fb.ref(this._fb.db, `rooms/${clean}/snapshot`);
        await this._fb.set(snapRef, snapshot);
      } catch (e) {
        console.warn('[saveRoomSnapshot Firebase Error]', e);
      }
    } else {
      // 支援純 REST 背景寫入
      const fbConfig = getFirebaseConfig();
      if (fbConfig?.databaseURL && typeof fetch === 'function') {
        fetch(`${fbConfig.databaseURL}/rooms/${clean}/snapshot.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        }).catch((err) => console.warn('[REST saveRoomSnapshot Error]', err));
      }
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

  async fetchRoomSnapshot(roomId = this.roomId) {
    if (!roomId) return null;
    const clean = String(roomId).replace(/[^a-zA-Z0-9]/g, '');

    // 1. 先查本地快照 (同瀏覽器秒開)
    const local = this.getRoomSnapshot(clean);
    if (local && Array.isArray(local.boardConfig) && local.boardConfig.length === 4) {
      return local;
    }

    // 2. 查 Firebase Realtime Database (跨電腦、跨手機雲端同步)
    const fbConfig = getFirebaseConfig();
    if (fbConfig?.databaseURL && typeof fetch === 'function') {
      try {
        const res = await fetch(`${fbConfig.databaseURL}/rooms/${clean}/snapshot.json`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.boardConfig) && data.boardConfig.length === 4) {
            // 同步寫入本地快照加速後續讀取
            this.setRoomSnapshot(data);
            return data;
          }
        }
      } catch (err) {
        console.warn('[fetchRoomSnapshot Error]', err);
      }
    }
    return null;
  }

  // ---------- Firebase Realtime Database 初始化 ----------

  async _initFirebase(config) {
    try {
      this.mode = NETWORK_MODE.FIREBASE_REALTIME;
      this.connectionStatus = 'CONNECTING';
      this.connectionError = null;

      let fb = typeof window !== 'undefined' ? window._fbInstance : null;
      if (!fb && typeof window !== 'undefined') {
        const [appMod, dbMod] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js'),
        ]);
        const app = appMod.getApps?.().length ? appMod.getApps()[0] : appMod.initializeApp(config);
        const db = dbMod.getDatabase(app);
        fb = { ...appMod, ...dbMod, app, db };
        window._fbInstance = fb;
      }
      this._fb = fb;

      if (!fb) {
        throw new Error('Firebase SDK unavailable');
      }

      const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
      this.channelName = `room_${cleanRoomId}`;
      const db = fb.db;

      // 1. 登記在線玩家 (Presence)
      const playerRef = fb.ref(db, `rooms/${cleanRoomId}/players/${this.userId}`);
      await fb.set(playerRef, {
        id: this.userId,
        name: this.userName,
        isHost: Boolean(this.isHost),
        score: 0,
        robotColor: this.robotColor || null,
        online: true,
        joinedAt: Date.now(),
      });
      fb.onDisconnect(playerRef).remove();

      // 2. 監聽在線玩家變動
      const playersRef = fb.ref(db, `rooms/${cleanRoomId}/players`);
      const unsubPlayers = fb.onValue(playersRef, (snapshot) => {
        const val = snapshot.val() || {};
        const members = Object.values(val).map((p) => ({
          id: p.id,
          name: p.name || '玩家',
          isHost: Boolean(p.isHost),
          score: p.score || 0,
          robotColor: p.robotColor || null,
        }));
        this._emit('presence_sync', { members });
        this._emit(MSG_TYPE.ROOM_PLAYERS_SYNC, { players: members });
      });
      this._fbListeners.push({ ref: playersRef, unsub: unsubPlayers });

      // 3. 監聽房間廣播事件
      const eventsRef = fb.ref(db, `rooms/${cleanRoomId}/events`);
      const connectTime = Date.now() - 2500;
      const unsubEvents = fb.onChildAdded(eventsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        if (data.senderId === this.userId || data._senderId === this.userId) return;
        if (data.timestamp && data.timestamp < connectTime) return;
        this._handleIncomingMessage(data);
      });
      this._fbListeners.push({ ref: eventsRef, unsub: unsubEvents });

      // 4. 監聽快照異動
      const snapshotRef = fb.ref(db, `rooms/${cleanRoomId}/snapshot`);
      const unsubSnapshot = fb.onValue(snapshotRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        if (data.hostId === this.userId && this.isHost) return;
        this._handleIncomingMessage({
          type: MSG_TYPE.ROOM_SYNC,
          payload: data,
          ...data,
        });
      });
      this._fbListeners.push({ ref: snapshotRef, unsub: unsubSnapshot });

      this.connectionStatus = 'SUBSCRIBED';
      this._emit('connection_status', { status: 'SUBSCRIBED', channelName: this.channelName });
      realtimeLog('Firebase channel ready:', this.channelName);
      return true;
    } catch (err) {
      console.warn('[Firebase Init Error, fallback to broadcast]', err);
      this.connectionError = err;
      this.connectionStatus = 'CHANNEL_ERROR';
      return false;
    }
  }

  // ---------- Supabase / Mock 初始化 (相容單元測試) ----------

  async _initSupabase(config) {
    try {
      this.mode = NETWORK_MODE.SUPABASE_REALTIME;
      this.connectionStatus = 'CONNECTING';
      this.connectionError = null;
      let createClient = typeof window !== 'undefined' ? window.supabase?.createClient : null;
      if (!createClient) {
        throw new Error('Supabase client SDK not available');
      }

      this._supabase = createClient(config.url, config.anonKey);
      const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
      const channelName = `room_${cleanRoomId}`;
      this.channelName = channelName;
      this._channel = this._supabase.channel(channelName, {
        config: {
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });

      this._channel.on('broadcast', { event: 'room_msg' }, (payload) => {
        this._handleIncomingMessage(payload.payload);
      });
      this._channel.on('broadcast', { event: 'room_sync' }, (payload) => {
        this._handleIncomingMessage(payload.payload);
      });

      this._channel.on('presence', { event: 'sync' }, () => {
        const state = typeof this._channel.presenceState === 'function' ? this._channel.presenceState() : {};
        const members = [];
        for (const [key, presences] of Object.entries(state)) {
          if (Array.isArray(presences) && presences.length > 0) {
            const p = presences[0];
            members.push({
              id: p.id || key,
              name: p.name || '玩家',
              isHost: Boolean(p.isHost),
              score: p.score || 0,
              robotColor: p.robotColor || null,
            });
          }
        }
        this._emit('presence_sync', { members, presenceState: state });
      });

      await new Promise((resolve) => {
        let settled = false;
        this._channel.subscribe(async (status) => {
          this.connectionStatus = status;
          this._emit('connection_status', { status, channelName });
          if (status === 'SUBSCRIBED') {
            try {
              if (typeof this._channel.track === 'function') {
                await this._channel.track({
                  id: this.userId,
                  name: this.userName,
                  isHost: this.isHost,
                  robotColor: null,
                });
              }
            } catch (e) {
              this.connectionError = e;
            }
            if (!settled) {
              settled = true;
              resolve();
            }
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !settled) {
            settled = true;
            this.connectionError = new Error(`Supabase channel ${status}`);
            this._initBroadcastChannel();
            resolve();
          }
        });
      });
    } catch (err) {
      this.connectionError = err;
      this._initBroadcastChannel();
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    if (typeof setInterval === 'undefined') return;
    this._heartbeatTimer = setInterval(() => {
      try {
        if (this.roomId) {
          this.send(MSG_TYPE.PRESENCE_PING, {
            player: {
              id: this.userId,
              name: this.userName,
              isHost: this.isHost,
            },
          });
        }
      } catch (e) {}
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
    const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');

    try {
      if (this.isHost) {
        await this.send(MSG_TYPE.ROOM_CLOSED, { hostPlayerId: this.userId, roomCode: this.roomId });
      }
      await this.send(MSG_TYPE.PLAYER_LEAVE, {
        playerId: this.userId,
        userName: this.userName,
        isHost: this.isHost,
      });
    } catch {}

    // 清理 Firebase 狀態與監聽器
    if (this._fb && this._fb.db) {
      try {
        const playerRef = this._fb.ref(this._fb.db, `rooms/${cleanRoomId}/players/${this.userId}`);
        await this._fb.remove(playerRef);
        if (this.isHost) {
          // 房主離房時可標記或清理房間
          const snapRef = this._fb.ref(this._fb.db, `rooms/${cleanRoomId}/snapshot/status`);
          await this._fb.set(snapRef, 'CLOSED');
        }
      } catch (e) {}
      this._fbListeners.forEach((item) => {
        if (typeof item.unsub === 'function') item.unsub();
      });
      this._fbListeners = [];
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
   * 發送訊息封包給同房間所有玩家
   */
  async send(type, payload = {}) {
    if (!this.roomId) return;

    const envelope = {
      ...payload,
      type,
      roomId: this.roomId,
      senderId: this.userId,
      senderName: this.userName,
      timestamp: Date.now(),
      payload,
    };

    // 1. Firebase 即時通道發送
    if (this._fb && this._fb.db) {
      try {
        const cleanRoomId = String(this.roomId).replace(/[^a-zA-Z0-9]/g, '');
        const eventsRef = this._fb.ref(this._fb.db, `rooms/${cleanRoomId}/events`);
        await this._fb.push(eventsRef, envelope);
      } catch (err) {
        console.warn('[Firebase Send Error]', err);
      }
    }

    // 2. Supabase / Mock 通道發送
    if (this._channel && typeof this._channel.send === 'function') {
      const eventName =
        type === MSG_TYPE.ROOM_SYNC || type === MSG_TYPE.ROOM_SYNC_PAYLOAD
          ? 'room_sync'
          : 'room_msg';
      await this._channel.send({
        type: 'broadcast',
        event: eventName,
        payload: envelope,
      });
    }

    // 3. LocalStorage 匯流排廣播（同台電腦跨分頁 100% 互通）
    this.broadcast(envelope);
    return 'ok';
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

    // 防重複過濾
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

  sendSolution(moves, extra = {}) {
    this.send(MSG_TYPE.REPORT_PB, {
      playerId: this.userId,
      playerName: this.userName,
      moves: Number(moves),
      timestamp: Date.now(),
      ...extra,
    });
  }

  sendBid(moves) {
    this.send(MSG_TYPE.BID, {
      playerId: this.userId,
      playerName: this.userName,
      moves: Number(moves),
      timestamp: Date.now(),
    });
  }

  sendRoundEndSync(data) {
    this.send(MSG_TYPE.ROUND_END_SYNC, {
      ...data,
      timestamp: Date.now(),
    });
  }

  sendGameRestart(data) {
    this.send(MSG_TYPE.GAME_RESTART, {
      ...data,
      timestamp: Date.now(),
    });
  }

  sendMove(robotColor, direction) {
    this.send(MSG_TYPE.DEMO_MOVE, {
      playerId: this.userId,
      robotColor,
      direction,
      timestamp: Date.now(),
    });
  }

  forfeit() {
    this.send(MSG_TYPE.DEMO_FORFEIT, {
      playerId: this.userId,
      timestamp: Date.now(),
    });
  }

  sendNewRound(roundData) {
    this.send(MSG_TYPE.NEW_ROUND, {
      ...roundData,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  sendStartGame(roundData) {
    this.send(MSG_TYPE.START_GAME, {
      ...roundData,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  sendLobbyUpdate(data) {
    this.send(MSG_TYPE.LOBBY_UPDATE, {
      ...data,
      hostId: this.userId,
      timestamp: Date.now(),
    });
  }

  sendSyncState(targetPlayerId, syncData) {
    this.send(MSG_TYPE.SYNC_STATE, {
      targetPlayerId,
      hostId: this.userId,
      ...syncData,
      timestamp: Date.now(),
    });
  }

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

  sendCountdownStart(countdownEnd, durationSec = 120) {
    this.send(MSG_TYPE.COUNTDOWN_START, {
      countdownEnd,
      durationSec,
      timestamp: Date.now(),
    });
  }

  sendCountdownEnd() {
    this.send(MSG_TYPE.COUNTDOWN_END, {
      timestamp: Date.now(),
    });
  }
}
