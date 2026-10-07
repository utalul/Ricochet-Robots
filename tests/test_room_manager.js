/**
 * 測試：RoomManager 雙開本地連線傳輸（使用 Node 原生 BroadcastChannel）
 * 執行：node tests/test_room_manager.js
 */
import { RoomManager, MSG_TYPE, NETWORK_MODE } from '../src/network/RoomManager.js';
import { copyRoomInviteLink } from '../src/ui/MultiplayerHUD.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  console.assert(cond, msg);
  if (cond) {
    passed++;
    console.log(`  ✔ ${msg}`);
  } else {
    failed++;
    console.error(`  ✖ FAIL: ${msg}`);
  }
}
const section = (t) => console.log(`\n=== ${t} ===`);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  section('1. RoomManager 建立與雙分頁連線通訊');
  const roomId = 'room_test_' + Date.now();

  const clientA = new RoomManager();
  const clientB = new RoomManager();

  let aReceivedJoin = null;
  let aReceivedBid = null;
  let aReceivedMove = null;
  let aReceivedForfeit = null;

  clientA.on(MSG_TYPE.PLAYER_JOIN, (data) => {
    aReceivedJoin = data;
  });
  clientA.on(MSG_TYPE.BID, (data) => {
    aReceivedBid = data;
  });
  clientA.on(MSG_TYPE.DEMO_MOVE, (data) => {
    aReceivedMove = data;
  });
  clientA.on(MSG_TYPE.DEMO_FORFEIT, (data) => {
    aReceivedForfeit = data;
  });

  // Client A 建立房間
  const infoA = await clientA.createRoom(roomId, 'Alice');
  assert(clientA.isHost === true, 'Client A 為房主');
  assert(clientA.roomId === roomId, 'Client A 記錄正確 roomId');
  assert(infoA.roomId === roomId, 'createRoom 回傳正確 roomId');
  assert(clientA.mode === NETWORK_MODE.BROADCAST_CHANNEL, '預設使用 BroadcastChannel 雙開模擬');

  // Client B 加入房間
  const infoB = await clientB.joinRoom(roomId, 'Bob');
  assert(clientB.isHost === false, 'Client B 為一般玩家');
  assert(clientB.roomId === roomId, 'Client B 記錄正確 roomId');
  assert(infoB.roomId === roomId, 'joinRoom 回傳正確 roomId');

  await sleep(60);

  assert(aReceivedJoin !== null, 'Client A 收到 Client B 加入廣播');
  assert(aReceivedJoin?.payload?.player?.name === 'Bob', '加入玩家名稱為 Bob');

  // Client B 發送下注
  clientB.sendBid(6);
  await sleep(60);
  assert(aReceivedBid !== null, 'Client A 收到 Client B 下注廣播');
  assert(aReceivedBid?.payload?.moves === 6, '下注步數為 6');

  // Client B 發送滑動移動
  clientB.sendMove('red', 'up');
  await sleep(60);
  assert(aReceivedMove !== null, 'Client A 收到 Client B 移動廣播');
  assert(
    aReceivedMove?.payload?.robotColor === 'red' && aReceivedMove?.payload?.direction === 'up',
    '移動內容為 red 向上'
  );

  // Client B 發送放棄
  clientB.forfeit();
  await sleep(60);
  assert(aReceivedForfeit !== null, 'Client A 收到 Client B 放棄廣播');

  // 關閉房間清理
  await clientA.leaveRoom();
  await clientB.leaveRoom();

  section('2. 2 分鐘同步競速消息廣播 (REPORT_PB, ROUND_END_SYNC, GAME_RESTART)');
  const raceRoomId = 'room_race_' + Date.now();
  const host = new RoomManager();
  const player = new RoomManager();

  let hostReceivedPB = null;
  let playerReceivedRoundEnd = null;
  let playerReceivedRestart = null;

  host.on(MSG_TYPE.REPORT_PB, (data) => {
    hostReceivedPB = data;
  });
  player.on(MSG_TYPE.ROUND_END_SYNC, (data) => {
    playerReceivedRoundEnd = data;
  });
  player.on(MSG_TYPE.GAME_RESTART, (data) => {
    playerReceivedRestart = data;
  });

  await host.createRoom(raceRoomId, 'HostAlice');
  await player.joinRoom(raceRoomId, 'PlayerBob');
  await sleep(60);

  // 玩家回報 PB
  player.sendSolution(5);
  await sleep(60);
  assert(hostReceivedPB !== null, '房主收到玩家回報的個人最佳解 (PB)');
  assert(hostReceivedPB?.payload?.moves === 5, 'PB 步數為 5');

  // 房主廣播回合結算
  host.sendRoundEndSync({ round: 1, endResult: { minMoves: 5, winners: ['PlayerBob'] } });
  await sleep(60);
  assert(playerReceivedRoundEnd !== null, '玩家收到房主發送的回合結算同步');
  assert(playerReceivedRoundEnd?.payload?.endResult?.minMoves === 5, '結算最低步數為 5');

  // 房主廣播重新開局
  host.sendGameRestart({ resetAll: true });
  await sleep(60);
  assert(playerReceivedRestart !== null, '玩家收到房主發送的重新開局通知');

  await host.leaveRoom();
  await player.leaveRoom();

  section('3. 房間等待大廳與房主啟動廣播 (START_GAME, LOBBY_UPDATE)');
  const lobbyRoomId = 'room_lobby_' + Date.now();
  const lobbyHost = new RoomManager();
  const lobbyPlayer = new RoomManager();

  let playerReceivedStart = null;
  let playerReceivedLobbyUpdate = null;

  lobbyPlayer.on(MSG_TYPE.START_GAME, (data) => {
    playerReceivedStart = data;
  });
  lobbyPlayer.on(MSG_TYPE.LOBBY_UPDATE, (data) => {
    playerReceivedLobbyUpdate = data;
  });

  const hostInfo = await lobbyHost.createRoom(lobbyRoomId, 'HostAlice');
  assert(lobbyHost.roomId === lobbyRoomId, '大廳房主記錄正確 roomId');
  assert(hostInfo.roomId === lobbyRoomId, '大廳房主回傳正確 roomId');

  const playerInfo = await lobbyPlayer.joinRoom(lobbyRoomId, 'Bob');
  assert(lobbyPlayer.roomId === lobbyRoomId, '大廳玩家記錄正確 roomId');
  assert(playerInfo.roomId === lobbyRoomId, '大廳玩家回傳正確 roomId');
  await sleep(60);

  // 房主在大廳切換變體
  lobbyHost.sendLobbyUpdate({ useSilver: true });
  await sleep(60);
  assert(playerReceivedLobbyUpdate !== null, '玩家收到大廳變體更新');
  assert(playerReceivedLobbyUpdate?.payload?.useSilver === true, '變體設定更新為 useSilver: true');

  // 房主啟動遊戲
  lobbyHost.sendStartGame({ round: 1, duration: 120, useSilver: true });
  await sleep(60);
  assert(playerReceivedStart !== null, '玩家收到房主開始遊戲通知 (START_GAME)');
  assert(playerReceivedStart?.payload?.round === 1, '開始第 1 題');

  await lobbyHost.leaveRoom();
  await lobbyPlayer.leaveRoom();

  section('4. 連線模式動態切換');
  const mgr = new RoomManager();
  assert(mgr.mode === NETWORK_MODE.BROADCAST_CHANNEL, '預設無設定時為 BroadcastChannel');
  assert(mgr.getEffectiveMode() === NETWORK_MODE.BROADCAST_CHANNEL, 'getEffectiveMode 回傳 BroadcastChannel');

  // 模擬注入 Supabase 設定
  globalThis.window = {
    __SUPABASE_URL__: 'https://example.supabase.co',
    __SUPABASE_ANON_KEY__: 'mock_anon_key_123',
  };
  assert(
    mgr.getEffectiveMode() === NETWORK_MODE.SUPABASE_REALTIME,
    '設定 URL/Key 後 getEffectiveMode 轉為 Supabase Realtime'
  );
  await mgr.reconfigure();
  assert(mgr.mode === NETWORK_MODE.SUPABASE_REALTIME, 'reconfigure 後 mode 更新為 Supabase Realtime');

  // 清除設定還原
  delete globalThis.window.__SUPABASE_URL__;
  delete globalThis.window.__SUPABASE_ANON_KEY__;
  assert(mgr.getEffectiveMode() === NETWORK_MODE.BROADCAST_CHANNEL, '清除後還原為 BroadcastChannel');
  await mgr.reconfigure();
  assert(mgr.mode === NETWORK_MODE.BROADCAST_CHANNEL, 'reconfigure 後還原為 BroadcastChannel');
  delete globalThis.window;

  section('5. 複製邀請連結 (copyRoomInviteLink)');
  globalThis.window = {
    location: {
      href: 'https://example.com/ricochet/?test=123#old',
      origin: 'https://example.com',
      pathname: '/ricochet/',
    },
    isSecureContext: false, // 觸發 execCommand fallback
  };
  let execCommandArg = null;
  let toastMsg = null;
  globalThis.document = {
    createElement: () => ({
      style: {},
      value: '',
      focus: () => {},
      select: () => {},
      remove: () => {},
    }),
    body: {
      appendChild: () => {},
    },
    execCommand: (cmd) => {
      execCommandArg = cmd;
      return true;
    },
    getElementById: () => null,
  };

  const copiedText = await copyRoomInviteLink('8392', {
    showToast: (msg) => {
      toastMsg = msg;
    },
  });

  assert(copiedText.includes('#room=8392'), '產生的邀請連結格式包含 #room=8392');
  assert(!copiedText.includes('test=123'), '邀請連結已清除原本的 query 參數');
  assert(execCommandArg === 'copy', '非 secureContext 時順利觸發 execCommand copy fallback');
  assert(toastMsg && toastMsg.includes('8392'), '觸發 Toast 提示告知已複製');
  delete globalThis.window;
  delete globalThis.document;

  section('6. HELLO_JOIN、SYNC_STATE 與 PRESENCE_PING 狀態同步');
  const syncRoomId = 'room_sync_' + Date.now();
  const hostMgr = new RoomManager();
  const guestMgr = new RoomManager();

  let hostReceivedHello = null;
  let guestReceivedSyncState = null;
  let hostReceivedPresencePing = null;

  hostMgr.on(MSG_TYPE.HELLO_JOIN, (data) => {
    hostReceivedHello = data;
    // 房主回應全狀態同步
    hostMgr.sendSyncState(data.payload.player.id, {
      boardConfig: { quadBoardIds: ['A_01', 'B_01', 'C_01', 'D_01'] },
      robotPositions: { red: { r: 1, c: 1 }, blue: { r: 2, c: 2 } },
      useSilver: false,
      members: [{ id: hostMgr.userId, name: 'HostAlice', isHost: true }],
    });
  });

  guestMgr.on(MSG_TYPE.SYNC_STATE, (data) => {
    guestReceivedSyncState = data;
  });

  hostMgr.on(MSG_TYPE.PRESENCE_PING, (data) => {
    hostReceivedPresencePing = data;
  });

  await hostMgr.createRoom(syncRoomId, 'HostAlice');
  await guestMgr.joinRoom(syncRoomId, 'GuestBob');
  await sleep(80);

  assert(hostReceivedHello !== null, '房主收到新玩家 HELLO_JOIN 廣播');
  assert(hostReceivedHello?.payload?.player?.name === 'GuestBob', 'HELLO_JOIN 玩家名稱為 GuestBob');
  assert(guestReceivedSyncState !== null, '新玩家收到房主 SYNC_STATE 全狀態同步');
  assert(
    guestReceivedSyncState?.payload?.boardConfig?.quadBoardIds?.[0] === 'A_01',
    'SYNC_STATE 包含版圖配置 A_01'
  );
  assert(
    guestReceivedSyncState?.payload?.robotPositions?.red?.r === 1,
    'SYNC_STATE 包含機器人起點配置'
  );

  // 測試心跳
  guestMgr.send(MSG_TYPE.PRESENCE_PING, {
    player: { id: guestMgr.userId, name: guestMgr.userName, isHost: false },
  });
  await sleep(60);
  assert(hostReceivedPresencePing !== null, '房主收到心跳 PRESENCE_PING');
  assert(
    hostReceivedPresencePing?.payload?.player?.name === 'GuestBob',
    '心跳來源玩家為 GuestBob'
  );

  await hostMgr.leaveRoom();
  await guestMgr.leaveRoom();

  section('7. 大廳雙向握手 (REQUEST_ROOM_SYNC -> ROOM_SYNC_PAYLOAD -> ROOM_SYNC_ACK)');
  const handshakeRoomId = 'room_hs_' + Date.now();
  const hostHS = new RoomManager();
  const guestHS = new RoomManager();

  let hostGotReq = null;
  let guestGotPayload = null;
  let hostGotAck = null;

  // 房主監聽握手請求
  hostHS.on(MSG_TYPE.REQUEST_ROOM_SYNC, (data) => {
    hostGotReq = data;
    // 房主回應 ROOM_SYNC_PAYLOAD
    hostHS.send(MSG_TYPE.ROOM_SYNC_PAYLOAD, {
      hostId: hostHS.userId,
      members: [
        { id: hostHS.userId, name: hostHS.userName, isHost: true },
        { id: data.senderId, name: data.senderName, isHost: false },
      ],
      boardConfig: ['A_01', 'B_02', 'C_03', 'D_01'],
      robotPositions: { red: { r: 5, c: 5 }, blue: { r: 6, c: 6 } },
      useSilver: true,
    });
  });

  // 訪客監聽同步負載
  guestHS.on(MSG_TYPE.ROOM_SYNC_PAYLOAD, (data) => {
    guestGotPayload = data;
    // 訪客回傳 ACK
    guestHS.send(MSG_TYPE.ROOM_SYNC_ACK, {
      guestId: guestHS.userId,
      guestName: guestHS.userName,
    });
  });

  // 房主監聽 ACK
  hostHS.on(MSG_TYPE.ROOM_SYNC_ACK, (data) => {
    hostGotAck = data;
  });

  await hostHS.createRoom(handshakeRoomId, 'HostAlice');
  await guestHS.joinRoom(handshakeRoomId, 'GuestBob');

  // 模擬訪客 50ms 後發送 REQUEST_ROOM_SYNC
  await sleep(60);
  guestHS.send(MSG_TYPE.REQUEST_ROOM_SYNC, {
    sender: { id: guestHS.userId, name: guestHS.userName },
  });

  await sleep(100);

  assert(hostGotReq !== null, '房主成功收到訪客之 REQUEST_ROOM_SYNC 廣播');
  assert(hostGotReq?.senderName === 'GuestBob', 'REQUEST_ROOM_SYNC 包含訪客姓名 GuestBob');
  assert(guestGotPayload !== null, '訪客成功收到房主之 ROOM_SYNC_PAYLOAD 廣播');
  assert(
    guestGotPayload?.payload?.boardConfig?.[1] === 'B_02',
    'ROOM_SYNC_PAYLOAD 包含正確的 boardConfig (B_02)'
  );
  assert(
    guestGotPayload?.payload?.useSilver === true,
    'ROOM_SYNC_PAYLOAD 包含 useSilver: true'
  );
  assert(
    guestGotPayload?.payload?.members?.length === 2,
    'ROOM_SYNC_PAYLOAD 包含 2 位在線成員'
  );
  assert(hostGotAck !== null, '房主成功收到訪客之 ROOM_SYNC_ACK 回應');
  assert(hostGotAck?.payload?.guestName === 'GuestBob', 'ROOM_SYNC_ACK 訪客姓名為 GuestBob');

  await hostHS.leaveRoom();
  await guestHS.leaveRoom();

  section('8. 規格 3: 可靠握手協議 (HELLO_JOIN -> ROOM_SYNC)');
  const specRoomId = 'room_spec3_' + Date.now();
  const hostSpec = new RoomManager();
  const guestSpec = new RoomManager();

  let hostReceivedJoin = null;
  let guestReceivedSync = null;

  // 房主監聽 HELLO_JOIN 並回覆 ROOM_SYNC
  hostSpec.on(MSG_TYPE.HELLO_JOIN, (data) => {
    const user = data.user || data.payload?.user || data.player || data.payload?.player;
    hostReceivedJoin = user;
    hostSpec.send(MSG_TYPE.ROOM_SYNC, {
      type: MSG_TYPE.ROOM_SYNC,
      hostId: hostSpec.userId,
      players: [
        { id: hostSpec.userId, name: hostSpec.userName, isHost: true },
        { id: user.id, name: user.name, isHost: false },
      ],
      boardConfig: ['A_01', 'B_02', 'C_03', 'D_01'],
      robotPositions: { red: { r: 5, c: 5 }, blue: { r: 6, c: 6 }, silver: { r: 7, c: 7 } },
      useSilver: true,
    });
  });

  // 訪客監聽 ROOM_SYNC
  guestSpec.on(MSG_TYPE.ROOM_SYNC, (data) => {
    guestReceivedSync = data;
  });

  await hostSpec.createRoom(specRoomId, 'HostAlice');
  await guestSpec.joinRoom(specRoomId, 'GuestBob');

  // 訪客模擬 500ms 重發加入廣播
  guestSpec.send(MSG_TYPE.HELLO_JOIN, {
    type: 'HELLO_JOIN',
    user: { id: guestSpec.userId, name: guestSpec.userName },
  });

  await sleep(100);

  assert(hostReceivedJoin !== null, '房主成功收到訪客之 HELLO_JOIN 握手廣播');
  assert(hostReceivedJoin?.name === 'GuestBob', 'HELLO_JOIN 攜帶之 user.name 正確為 GuestBob');
  assert(guestReceivedSync !== null, '訪客成功收到房主之 ROOM_SYNC 完整狀態回應');
  assert(
    guestReceivedSync?.payload?.players?.length === 2,
    'ROOM_SYNC 包含 2 位在線玩家名單'
  );
  assert(
    Array.isArray(guestReceivedSync?.payload?.boardConfig) &&
      guestReceivedSync?.payload?.boardConfig?.length === 4,
    'ROOM_SYNC 包含完整的 4 張子版圖 boardConfig'
  );
  assert(
    guestReceivedSync?.payload?.robotPositions?.silver?.r === 7,
    'ROOM_SYNC 包含正確的 robotPositions'
  );
  assert(
    guestReceivedSync?.payload?.useSilver === true,
    'ROOM_SYNC 包含正確的 useSilver 變體設定'
  );

  await hostSpec.leaveRoom();
  await guestSpec.leaveRoom();

  section('9. LocalStorage 共享狀態匯流排與快照 (Storage Event Bus)');
  const storageStore = new Map();
  const storageListeners = new Set();
  globalThis.localStorage = {
    getItem: (k) => (storageStore.has(k) ? storageStore.get(k) : null),
    setItem: (k, v) => {
      const oldVal = storageStore.get(k) || null;
      storageStore.set(k, String(v));
      // 模擬瀏覽器跨分頁 storage 事件分發
      storageListeners.forEach((fn) => {
        try {
          fn({ key: k, newValue: String(v), oldValue: oldVal });
        } catch {}
      });
    },
    removeItem: (k) => storageStore.delete(k),
    clear: () => storageStore.clear(),
  };
  globalThis.window = {
    addEventListener: (type, fn) => {
      if (type === 'storage') storageListeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === 'storage') storageListeners.delete(fn);
    },
  };

  const busRoomId = 'bus_' + Date.now();
  const hostBus = new RoomManager();
  const guestBus = new RoomManager();

  await hostBus.createRoom(busRoomId, 'HostAlice');

  // 房主建立快照
  const initialSnapshot = {
    hostId: hostBus.userId,
    hostName: hostBus.userName,
    boardConfig: ['A_01', 'B_01', 'C_01', 'D_01'],
    robotPositions: { red: { r: 3, c: 3 } },
    useSilver: true,
    players: [{ id: hostBus.userId, name: hostBus.userName, isHost: true }],
  };
  hostBus.setRoomSnapshot(initialSnapshot);

  // 訪客加入前，直接讀取快照
  const loadedSnapshot = guestBus.getRoomSnapshot(busRoomId);
  assert(loadedSnapshot !== null, '訪客可直接從 LocalStorage 讀取房主快照');
  assert(loadedSnapshot?.boardConfig?.[0] === 'A_01', '快照版圖配置正確');
  assert(loadedSnapshot?.useSilver === true, '快照變體設定正確');

  // 訪客加入並透過 Storage Bus 接收事件
  let busReceivedMove = null;
  guestBus.on(MSG_TYPE.DEMO_MOVE, (data) => {
    busReceivedMove = data;
  });

  await guestBus.joinRoom(busRoomId, 'GuestBob');

  // 房主發送廣播（雙保險模式：寫入 LocalStorage bus + BroadcastChannel）
  hostBus.broadcast({
    type: MSG_TYPE.DEMO_MOVE,
    robotColor: 'blue',
    direction: 'left',
  });

  await sleep(60);

  assert(busReceivedMove !== null, '訪客透過 Storage Bus 成功接收廣播訊息');
  assert(busReceivedMove?.robotColor === 'blue', '廣播訊息內容正確');

  await hostBus.leaveRoom();
  await guestBus.leaveRoom();

  delete globalThis.window;
  delete globalThis.localStorage;

  section('測試結果');
  console.log(`  通過: ${passed}  失敗: ${failed}`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTest();
