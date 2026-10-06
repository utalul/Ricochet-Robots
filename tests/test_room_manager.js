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

  section('測試結果');
  console.log(`  通過: ${passed}  失敗: ${failed}`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTest();
