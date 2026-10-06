/**
 * 測試：RoomState 多人連線房間狀態機
 * 執行：node tests/test_room_state.js
 */
import { RoomState, ROOM_PHASE, BID_STATUS } from '../src/network/RoomState.js';
import { assembleBigBoard } from '../src/core/BoardAssembler.js';
import { DIRECTION_DELTA, OPPOSITE_EDGE } from '../src/core/constants.js';

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
const samePos = (a, b) => a.x === b.x && a.y === b.y;

// 空白測試地圖
function emptyGrid() {
  const blank = (id) => ({ board_id: id, group: id, walls: [], targets: [] });
  return assembleBigBoard(blank('E1'), blank('E2'), blank('E3'), blank('E4'));
}
function addWall(grid, x, y, edge) {
  grid[y][x][edge] = true;
  const { dx, dy } = DIRECTION_DELTA[edge];
  const row = grid[y + dy];
  if (row && row[x + dx]) row[x + dx][OPPOSITE_EDGE[edge]] = true;
}

const baseRobots = () => ({
  red: { x: 5, y: 5 },
  blue: { x: 10, y: 10 },
  yellow: { x: 12, y: 2 },
  green: { x: 2, y: 13 },
});

// =====================================================
section('1. 下注排序規則');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 0, y: 0 },
  });

  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });
  room.addPlayer({ id: 'p3', name: 'Charlie' });

  // 1.1 步數少者優先
  room.submitBid('p1', 10, 1000);
  room.submitBid('p2', 6, 2000);
  let lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p2' && lb[0].moves === 6, '步數少者優先：Bob (6) 排在 Alice (10) 前');

  // 1.2 步數相同時，先下注者優先
  room.submitBid('p3', 6, 3000);
  lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p2' && lb[1].playerId === 'p3', '步數相同 (6) 時，先下注者 Bob (ts=2000) 優於 Charlie (ts=3000)');

  // 1.3 同一玩家重複下注：新下注必須嚴格小於前一次
  const rejected1 = room.submitBid('p1', 10, 4000);
  assert(!rejected1.accepted, 'Alice 重複下注相同步數 (10) 應被拒絕');
  const rejected2 = room.submitBid('p1', 12, 4000);
  assert(!rejected2.accepted, 'Alice 下注更多步數 (12 > 10) 應被拒絕');

  const accepted = room.submitBid('p1', 5, 4500);
  assert(accepted.accepted, 'Alice 下注更少步數 (5 < 10) 接受');
  lb = room.getLeaderboard();
  assert(lb[0].playerId === 'p1' && lb[0].moves === 5, 'Alice 喊 5 步躍升為第 1 名');

  // 1.4 非法步數拒絕 (moves < 2)
  const rejectedZero = room.submitBid('p2', 1, 5000);
  assert(!rejectedZero.accepted, '下注 < 2 步應被拒絕（不合轉向規則）');
}

// =====================================================
section('2. 沙漏倒數觸發邏輯');
{
  const room = new RoomState({ countdownDuration: 60 });
  room.startRound({
    grid: emptyGrid(),
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 0, y: 0 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });

  assert(room.phase === ROOM_PHASE.THINKING, '開局為 THINKING 階段');
  assert(room.countdownEnd === null, '思考期無倒數結束時間');

  // 第一位下注者觸發倒數
  const res1 = room.submitBid('p1', 8, 10000);
  assert(room.phase === ROOM_PHASE.COUNTDOWN, '第一位下注者觸發切換至 COUNTDOWN 階段');
  assert(res1.phaseChanged === true, '回傳 phaseChanged = true');
  assert(room.countdownEnd === 10000 + 60 * 1000, '倒數結束時間為 10000 + 60000');

  // 第二位下注者不應改變倒數結束時間
  const prevEnd = room.countdownEnd;
  const res2 = room.submitBid('p2', 7, 15000);
  assert(room.phase === ROOM_PHASE.COUNTDOWN, '第二位下注維持 COUNTDOWN 階段');
  assert(res2.phaseChanged === false, '回傳 phaseChanged = false');
  assert(room.countdownEnd === prevEnd, '倒數結束時間不被重置');
}

// =====================================================
section('3. 獨占操作鎖 (Mutex Lock) 與展示移動');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 0, y: 0 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });

  room.submitBid('p1', 8, 1000);
  room.submitBid('p2', 6, 2000);

  // 思考中禁止任何人移動
  const earlyMove = room.applyDemonstratorMove('p2', 'red', 'up');
  assert(!earlyMove.success, '倒數尚未結束前禁止移動棋盤');

  // 倒數結束切換至 DEMONSTRATING
  const endRes = room.endCountdown();
  assert(endRes.success && room.phase === ROOM_PHASE.DEMONSTRATING, '切換至 DEMONSTRATING 階段');
  assert(room.activeDemonstratorId === 'p2', '第 1 名 Bob (6步) 取得展示權限');

  // 非展示者 (Alice) 嘗試移動 → Mutex Lock 阻擋
  const aliceMove = room.applyDemonstratorMove('p1', 'red', 'up');
  assert(!aliceMove.success, 'Alice 移動被 Mutex Lock 拒絕');

  // 展示者 (Bob) 移動 → 允許
  const bobMove = room.applyDemonstratorMove('p2', 'red', 'up');
  assert(bobMove.success && bobMove.moved, 'Bob 移動成功');
}

// =====================================================
section('4. 展示失敗與操作權依序轉移');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 3, y: 3 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });
  room.addPlayer({ id: 'p3', name: 'Charlie' });

  room.submitBid('p1', 6, 1000); // 排名 3
  room.submitBid('p2', 2, 2000); // 排名 1 (2步)
  room.submitBid('p3', 4, 3000); // 排名 2 (4步)

  room.endCountdown();
  assert(room.activeDemonstratorId === 'p2', '第一順位展示者為 Bob (2步)');

  // Bob 走了 2 步但沒達陣，第 3 步超過宣布步數 → 自動判定失敗轉移
  room.applyDemonstratorMove('p2', 'red', 'up');   // 步數 1
  room.applyDemonstratorMove('p2', 'red', 'right'); // 步數 2
  const failMove = room.applyDemonstratorMove('p2', 'red', 'down'); // 步數 3 > 2 步！
  assert(failMove.outcome === 'FAILED_EXCEEDED', '超過 2 步自動判定失敗');
  assert(room.activeDemonstratorId === 'p3', '操作權自動轉移至次順位 Charlie (4步)');
  assert(samePos(room.gameState.robots.red, baseRobots().red), '機器人彈回初始位置');
  assert(room.gameState.moveCount === 0, '步數計數器歸零');

  // Charlie 發現無法達成，主動點擊「放棄」
  const forfeitRes = room.forfeitDemonstration('p3');
  assert(forfeitRes.success, 'Charlie 放棄成功');
  assert(room.activeDemonstratorId === 'p1', '操作權轉移至第三順位 Alice (6步)');
  assert(samePos(room.gameState.robots.red, baseRobots().red), '機器人再次彈回初始位置');

  // Alice 也放棄 → 全員失敗
  const finalForfeit = room.forfeitDemonstration('p1');
  assert(finalForfeit.success, 'Alice 放棄成功');
  assert(room.phase === ROOM_PHASE.ROUND_END, '全員失敗進入 ROUND_END');
  assert(room.activeDemonstratorId === null, '展示者清空');
  assert(room.roundWinner === null, '無人獲勝');
}

// =====================================================
section('5. 成功達陣與得分結算');
{
  const grid = emptyGrid();
  // 建立 (3,3) 牆角目標
  addWall(grid, 3, 3, 'top');
  addWall(grid, 3, 3, 'left');

  const room = new RoomState();
  const init = {
    red: { x: 12, y: 10 },
    blue: { x: 2, y: 10 },
    yellow: { x: 15, y: 15 },
    green: { x: 0, y: 15 },
  };
  room.startRound({
    grid,
    initialRobots: init,
    target: { color: 'red', shape: 'star', x: 3, y: 3 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice' });

  // Alice 宣告 2 步
  room.submitBid('p1', 2, 1000);
  room.endCountdown();

  // 執行 2 步達陣
  room.applyDemonstratorMove('p1', 'red', 'left'); // (12,10) -> (3,10)
  const winMove = room.applyDemonstratorMove('p1', 'red', 'up'); // (3,10) -> (3,3)

  assert(winMove.outcome === 'SUCCESS', '剛好 2 步達陣判定 SUCCESS');
  assert(room.phase === ROOM_PHASE.ROUND_END, '回合狀態切換至 ROUND_END');
  assert(room.roundWinner && room.roundWinner.playerId === 'p1', 'Alice 為本回合獲勝者');
  assert(room.players.get('p1').score === 1, 'Alice 累計得分 +1');
}

// =====================================================
section('6. 狀態快照序列化與反序列化 (Serialize / Deserialize)');
{
  const room = new RoomState();
  const grid = emptyGrid();
  room.startRound({
    grid,
    initialRobots: baseRobots(),
    target: { color: 'red', shape: 'star', x: 3, y: 3 },
  });
  room.addPlayer({ id: 'p1', name: 'Alice', score: 2 });
  room.submitBid('p1', 4, 1000);

  const snapshot = room.serialize();
  assert(snapshot.phase === ROOM_PHASE.COUNTDOWN, '快照 phase 正確');
  assert(snapshot.bids.length === 1 && snapshot.bids[0].moves === 4, '快照 bids 正確');
  assert(snapshot.players.length === 1 && snapshot.players[0].score === 2, '快照 players 正確');

  const room2 = new RoomState();
  room2.deserialize(snapshot, grid);
  assert(room2.phase === ROOM_PHASE.COUNTDOWN, '反序列化後 phase 一致');
  assert(room2.bids[0].moves === 4, '反序列化後 bids 一致');
  assert(room2.players.get('p1').score === 2, '反序列化後 player 分數一致');
}

section('測試結果');
console.log(`  通過: ${passed}  失敗: ${failed}`);
if (failed > 0) process.exit(1);
