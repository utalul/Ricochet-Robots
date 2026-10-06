/**
 * 測試：RoomState 多人連線房間狀態機（2 分鐘同步競速與 17 題終局結算）
 * 執行：node tests/test_room_state.js
 */
import { RoomState, ROOM_PHASE, BID_STATUS } from '../src/network/RoomState.js';
import { assembleBigBoard } from '../src/core/BoardAssembler.js';

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

// 空白測試地圖
function emptyGrid() {
  const blank = (id) => ({ board_id: id, group: id, walls: [], targets: [] });
  return assembleBigBoard(blank('E1'), blank('E2'), blank('E3'), blank('E4'));
}

const baseRobots = () => ({
  red: { x: 5, y: 5 },
  blue: { x: 10, y: 10 },
  yellow: { x: 12, y: 2 },
  green: { x: 2, y: 13 },
});

// =====================================================
section('1. 120 秒同步競速與個人最佳解 (PB) 回報');
{
  const room = new RoomState({ countdownDuration: 120 });
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 0, y: 0 },
    duration: 120,
  });

  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });
  room.addPlayer({ id: 'p3', name: 'Charlie' });

  assert(room.phase === ROOM_PHASE.RACING, '開局階段直接進入 RACING 競速期');
  assert(room.countdownDuration === 120, '競賽倒數時長為 120 秒');
  assert(typeof room.countdownEnd === 'number', '具有倒數結束時間戳');

  // 1.1 回報解法：步數少者排在前面
  const res1 = room.reportSolution('p1', 10, { timestamp: 1000 });
  assert(res1.accepted && res1.isPB, 'Alice 回報 10 步成功');
  const res2 = room.reportSolution('p2', 6, { timestamp: 2000 });
  assert(res2.accepted && res2.isPB, 'Bob 回報 6 步成功');

  let lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p2' && lb[0].moves === 6, '步數少者優先：Bob (6步) 排第 1');
  assert(lb[1].playerId === 'p1' && lb[1].moves === 10, 'Alice (10步) 排第 2');

  // 1.2 步數相同時，先達成者排在前面
  room.reportSolution('p3', 6, { timestamp: 3000 });
  lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p2' && lb[1].playerId === 'p3', '步數相同 (6步) 時，先達成者 Bob (ts=2000) 優於 Charlie (ts=3000)');

  // 1.3 刷新個人最佳步數 (PB)
  const rejectSame = room.reportSolution('p1', 10, { timestamp: 4000 });
  assert(!rejectSame.accepted, 'Alice 重複回報相同步數 (10) 應被拒絕');
  const rejectWorse = room.reportSolution('p1', 12, { timestamp: 4000 });
  assert(!rejectWorse.accepted, 'Alice 回報更差步數 (12 > 10) 應被拒絕');

  const updateBetter = room.reportSolution('p1', 5, { timestamp: 4500 });
  assert(updateBetter.accepted, 'Alice 回報更少步數 (5 < 10) 接受並更新 PB');
  lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p1' && lb[0].moves === 5, 'Alice 刷新為 5 步躍升為第 1 名');

  // 1.4 非法步數 (< 2 步，不合轉向規則) 應被拒絕
  const rejectTooFew = room.reportSolution('p2', 1, { timestamp: 5000 });
  assert(!rejectTooFew.accepted, '回報 < 2 步應被拒絕');
}

// =====================================================
section('2. 回合結算與自動比對最低步數 (Auto-Scoring)');
{
  const room = new RoomState();
  const deck = [
    { color: 'red', shape: 'star', x: 0, y: 0 },
    { color: 'blue', shape: 'moon', x: 1, y: 1 },
  ];
  room.setTargetDeck(deck);
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: deck[0],
  });

  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });

  room.reportSolution('p1', 7, { timestamp: 1000 });
  room.reportSolution('p2', 5, { timestamp: 2000 });

  // 2 分鐘倒數結束，執行結算
  const endRes = room.endRound();
  assert(endRes.success, '回合結算成功');
  assert(room.phase === ROOM_PHASE.ROUND_END, '切換至 ROUND_END 階段');
  assert(endRes.minMoves === 5, '最低步數為 5 步');
  assert(room.roundWinner.playerId === 'p2', 'Bob (5步) 為本回合獲勝者');
  assert(room.players.get('p2').score === 1, 'Bob 得分 +1 (累計 1 分)');
  assert(room.players.get('p1').score === 0, 'Alice 未得最低步數得分為 0');

  // 目標圓片自牌堆中移除
  assert(room.completedTargets.length === 1, '已完成目標數為 1');
  assert(room.targetDeck.length === 1, '牌堆剩餘 1 張目標');
}

// =====================================================
section('3. 平手處理：多人步數相同且為最低，共同獲勝各得 1 分');
{
  const room = new RoomState();
  room.setTargetDeck([{ color: 'red', shape: 'star', x: 0, y: 0 }]);
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 0, y: 0 },
  });

  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });
  room.addPlayer({ id: 'p3', name: 'Charlie' });

  // Alice 與 Charlie 皆為 4 步最佳解，Bob 為 6 步
  room.reportSolution('p1', 4, { timestamp: 1000 });
  room.reportSolution('p2', 6, { timestamp: 2000 });
  room.reportSolution('p3', 4, { timestamp: 3000 });

  const endRes = room.endRound();
  assert(endRes.winners.length === 2, '共 2 位玩家平手並列第一');
  assert(room.players.get('p1').score === 1, 'Alice 獲得 1 分');
  assert(room.players.get('p3').score === 1, 'Charlie 獲得 1 分');
  assert(room.players.get('p2').score === 0, 'Bob 未得最低步數，分數為 0');
}

// =====================================================
section('4. 流標處理：120 秒內無人達成，目標洗回牌堆');
{
  const room = new RoomState();
  const deck = [{ color: 'red', shape: 'star', x: 0, y: 0 }];
  room.setTargetDeck(deck);
  // 抽出第 1 張
  const currentTarget = deck.pop();
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: currentTarget,
  });

  room.addPlayer({ id: 'p1', name: 'Alice' });
  // 無人回報解法，時間到結算
  const endRes = room.endRound();

  assert(endRes.isDraw === true, '無人達成判定為流標 isDraw = true');
  assert(room.roundWinner === null, '無人獲勝');
  assert(room.completedTargets.length === 0, '已完成目標數為 0');
  assert(room.targetDeck.length === 1, '流標目標已成功洗回牌堆');
}

// =====================================================
section('5. 17 題全部達成觸發 GAME_OVER 與終局頒獎台 (Podium)');
{
  const room = new RoomState();
  room.totalTargetsCount = 2; // 測試用設定總題數為 2
  room.setTargetDeck([
    { color: 'red', shape: 'star', x: 0, y: 0 },
    { color: 'blue', shape: 'moon', x: 1, y: 1 },
  ]);

  room.addPlayer({ id: 'p1', name: 'Alice', score: 0 });
  room.addPlayer({ id: 'p2', name: 'Bob', score: 0 });

  // 第 1 題
  const t1 = room.targetDeck.pop();
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: t1,
    round: 1,
  });
  room.reportSolution('p1', 5);
  room.endRound();
  assert(room.phase === ROOM_PHASE.ROUND_END, '第 1 題結算後進入 ROUND_END');

  // 第 2 題（最後一題）
  const t2 = room.targetDeck.pop();
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: t2,
    round: 2,
  });
  room.reportSolution('p1', 6);
  const finalRes = room.endRound();

  assert(finalRes.gameOver === true, '牌堆抽完觸發 gameOver = true');
  assert(room.phase === ROOM_PHASE.GAME_OVER, '狀態機轉入 GAME_OVER');

  // 檢查終局頒獎台
  const podium1 = room.getPodium();
  assert(podium1.champions.length === 1 && podium1.champions[0].name === 'Alice', 'Alice 獨得 2 分獲勝為單一冠軍');
  assert(podium1.isTie === false, '非平手');

  // 測試平手共同獲勝情境
  room.players.get('p2').score = 2; // 模擬 Bob 也是 2 分
  const podiumTie = room.getPodium();
  assert(podiumTie.champions.length === 2, 'Alice 與 Bob 同為 2 分');
  assert(podiumTie.isTie === true, '共同獲勝平手標記 isTie = true');
}

// =====================================================
section('6. 重新開始新的一局 (restartGame)');
{
  const room = new RoomState();
  room.addPlayer({ id: 'p1', name: 'Alice', score: 5 });
  room.addPlayer({ id: 'p2', name: 'Bob', score: 4 });
  room.completedTargets = [{ color: 'red', shape: 'star', x: 0, y: 0 }];

  const allTargets = [
    { color: 'red', shape: 'star', x: 0, y: 0 },
    { color: 'blue', shape: 'moon', x: 1, y: 1 },
  ];
  room.restartGame(allTargets);

  assert(room.players.get('p1').score === 0, 'Alice 分數歸零');
  assert(room.players.get('p2').score === 0, 'Bob 分數歸零');
  assert(room.completedTargets.length === 0, '已完成目標清空');
  assert(room.targetDeck.length === 2, '牌堆重置為完整目標數');
  assert(room.phase === ROOM_PHASE.RACING, '重新開局為 RACING 階段');
}

// =====================================================
section('7. 狀態快照序列化與反序列化 (Serialize / Deserialize)');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 3, y: 3 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice', score: 3 });
  room.reportSolution('p1', 6, { timestamp: 1234 });

  const snapshot = room.serialize();
  assert(snapshot.phase === ROOM_PHASE.RACING, '快照 phase 正確');
  assert(snapshot.bids.length === 1 && snapshot.bids[0].moves === 6, '快照 bids 正確');
  assert(snapshot.players.length === 1 && snapshot.players[0].score === 3, '快照 players 正確');

  const room2 = new RoomState();
  room2.deserialize(snapshot, grid);
  assert(room2.phase === ROOM_PHASE.RACING, '反序列化後 phase 一致');
  assert(room2.bids[0].moves === 6, '反序列化後 bids 一致');
  assert(room2.players.get('p1').score === 3, '反序列化後 player 分數一致');
}

// =====================================================
section('8. 白色機器人變體狀態同步 (useSilver in RoomState)');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.useSilver = true;
  room.startRound({
    grid,
    initialRobots: { ...baseRobots(), silver: { x: 0, y: 0 } },
    target: { color: 'vortex', shape: 'vortex', x: 3, y: 3 },
    useSilver: true,
  });
  assert(room.useSilver === true, 'startRound 設定 useSilver = true');
  assert('silver' in room.initialRobots, 'initialRobots 包含 silver');

  const snapshot = room.serialize();
  assert(snapshot.useSilver === true, '序列化快照包含 useSilver = true');

  const room2 = new RoomState();
  room2.deserialize(snapshot, grid);
  assert(room2.useSilver === true, '反序列化成功恢復 useSilver = true');
  assert('silver' in room2.initialRobots, '反序列化 initialRobots 包含 silver');
}

section('測試結果');
console.log(`  通過: ${passed}  失敗: ${failed}`);
if (failed > 0) process.exit(1);
