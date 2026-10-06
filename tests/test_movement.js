/**
 * 測試：MovementEngine 滑動/碰撞 與 GameState 回合規則
 * 執行：npm test  （或 node tests/test_movement.js）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assembleBigBoard } from '../src/core/BoardAssembler.js';
import { calculateSlide, applySlide } from '../src/core/MovementEngine.js';
import { GameState, GOAL_REASON } from '../src/core/GameState.js';
import { DIRECTION_DELTA, OPPOSITE_EDGE } from '../src/core/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- 迷你測試框架 ----------
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  console.assert(cond, msg);
  if (cond) {
    passed++;
    console.log(`  ✔ ${msg}`);
  } else {
    failed++;
  }
}
const section = (t) => console.log(`\n=== ${t} ===`);
const samePos = (a, b) => a.x === b.x && a.y === b.y;
const fmt = (p) => `(${p.x},${p.y})`;

// ---------- 測試地圖 ----------
/** 只有外圍邊界與中央卡榫的空白大地圖 */
function emptyGrid() {
  const blank = (id) => ({ board_id: id, group: id, walls: [], targets: [] });
  return assembleBigBoard(blank('E1'), blank('E2'), blank('E3'), blank('E4'));
}
/** 在測試地圖上加一面雙向牆 */
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
section('1. 外牆阻擋');
{
  const grid = emptyGrid();
  const robots = baseRobots();
  const left = calculateSlide(grid, robots, 'red', 'left');
  assert(left.moved && samePos(left.to, { x: 0, y: 5 }), `red 向左停在 x=0：${fmt(left.to)}`);
  assert(left.stoppedBy === 'wall', 'stoppedBy = wall');
  assert(left.path.length === 6 && samePos(left.path[0], { x: 5, y: 5 }) && samePos(left.path[5], { x: 0, y: 5 }), 'path 含起點至終點共 6 格且連續');
  assert(left.path.every((p, i) => i === 0 || Math.abs(p.x - left.path[i - 1].x) + Math.abs(p.y - left.path[i - 1].y) === 1), 'path 每步相鄰');

  const right = calculateSlide(grid, robots, 'red', 'right');
  assert(samePos(right.to, { x: 15, y: 5 }), `red 向右停在 x=15：${fmt(right.to)}`);
  const up = calculateSlide(grid, robots, 'red', 'up');
  assert(samePos(up.to, { x: 5, y: 0 }), `red 向上停在 y=0：${fmt(up.to)}`);
  const down = calculateSlide(grid, robots, 'red', 'down');
  assert(samePos(down.to, { x: 5, y: 15 }), `red 向下停在 y=15：${fmt(down.to)}`);
  assert(samePos(robots.red, { x: 5, y: 5 }), 'calculateSlide 不修改傳入的 robots');
}

// =====================================================
section('2. 中央卡榫阻擋');
{
  const grid = emptyGrid();
  const robots = { ...baseRobots(), red: { x: 7, y: 0 }, blue: { x: 15, y: 8 }, yellow: { x: 8, y: 15 }, green: { x: 0, y: 7 } };
  const r = calculateSlide(grid, robots, 'red', 'down');
  assert(samePos(r.to, { x: 7, y: 6 }) && r.stoppedBy === 'wall', `從上方往下停在 (7,6)：${fmt(r.to)}`);
  const b = calculateSlide(grid, robots, 'blue', 'left');
  assert(samePos(b.to, { x: 9, y: 8 }), `從右方往左停在 (9,8)：${fmt(b.to)}`);
  const y = calculateSlide(grid, robots, 'yellow', 'up');
  assert(samePos(y.to, { x: 8, y: 9 }), `從下方往上停在 (8,9)：${fmt(y.to)}`);
  const g = calculateSlide(grid, robots, 'green', 'right');
  assert(samePos(g.to, { x: 6, y: 7 }), `從左方往右停在 (6,7)：${fmt(g.to)}`);
  assert([r, b, y, g].every((s) => s.path.every((p) => !grid[p.y][p.x].blocked)), '所有路徑皆未進入卡榫');
}

// =====================================================
section('3. 內部牆壁阻擋');
{
  const grid = emptyGrid();
  addWall(grid, 3, 5, 'right'); // (3,5) 與 (4,5) 之間有牆
  const r = calculateSlide(grid, baseRobots(), 'red', 'left');
  assert(samePos(r.to, { x: 4, y: 5 }) && r.stoppedBy === 'wall', `red 向左被 (4,5).left 牆擋下：${fmt(r.to)}`);
}

// =====================================================
section('4. 機器人障礙撞擊');
{
  const grid = emptyGrid();
  const robots = { ...baseRobots(), red: { x: 2, y: 4 }, blue: { x: 10, y: 4 } };
  const r = calculateSlide(grid, robots, 'red', 'right');
  assert(samePos(r.to, { x: 9, y: 4 }), `red 停在 blue 前一格 (9,4)：${fmt(r.to)}`);
  assert(r.stoppedBy === 'robot' && r.blocker === 'blue', 'stoppedBy = robot, blocker = blue');
  assert(samePos(robots.blue, { x: 10, y: 4 }), 'blue 位置不變');
  const next = applySlide(robots, r);
  assert(samePos(next.red, { x: 9, y: 4 }) && samePos(next.blue, { x: 10, y: 4 }) && samePos(robots.red, { x: 2, y: 4 }), 'applySlide 回傳新物件且不重疊');

  const gs = new GameState().initRound(grid, robots, { color: 'red', shape: 'star', x: 0, y: 0 });
  gs.applyMove('red', 'right');
  const robotsNow = gs.getRobots();
  assert(samePos(robotsNow.red, { x: 9, y: 4 }) && samePos(robotsNow.blue, { x: 10, y: 4 }), 'GameState 中 red 停在 blue 前一格，blue 不動');
}

// =====================================================
section('5. 零距離無效移動');
{
  const grid = emptyGrid();
  const robots = { ...baseRobots(), red: { x: 0, y: 5 } };
  const s = calculateSlide(grid, robots, 'red', 'left');
  assert(s.moved === false && s.distance === 0 && samePos(s.to, s.from), '緊貼外牆向左：moved=false, distance=0');
  assert(s.path.length === 1, 'path 僅含起點');

  const gs = new GameState().initRound(grid, robots, { color: 'red', shape: 'star', x: 15, y: 15 });
  gs.applyMove('red', 'left');
  assert(gs.moveCount === 0 && gs.history.length === 0, 'GameState 步數維持 0、歷史為空');

  // 緊貼其他機器人
  const robots2 = { ...baseRobots(), red: { x: 3, y: 4 }, blue: { x: 4, y: 4 } };
  const s2 = calculateSlide(grid, robots2, 'red', 'right');
  assert(!s2.moved && s2.stoppedBy === 'robot', '緊貼機器人：moved=false, stoppedBy=robot');

  // 緊貼中央卡榫
  const robots3 = { ...baseRobots(), red: { x: 7, y: 6 } };
  const s3 = calculateSlide(grid, robots3, 'red', 'down');
  assert(!s3.moved && s3.stoppedBy === 'wall', '緊貼卡榫：moved=false');
}

// =====================================================
section('6. 復原與重設');
{
  const grid = emptyGrid();
  const init = baseRobots();
  const gs = new GameState().initRound(grid, init, { color: 'red', shape: 'star', x: 3, y: 3 });
  gs.applyMove('red', 'up');    // (5,5) → (5,0)
  gs.applyMove('red', 'right'); // (5,0) → (15,0)
  gs.applyMove('red', 'down');  // (15,0) → (15,15)
  assert(gs.moveCount === 3 && gs.history.length === 3, '連續 3 步：moveCount=3');
  assert(samePos(gs.robots.red, { x: 15, y: 15 }), `第 3 步後 red 在 (15,15)：${fmt(gs.robots.red)}`);

  const undone = gs.undo();
  assert(undone && undone.direction === 'down', 'undo 回傳最後一步');
  assert(samePos(gs.robots.red, { x: 15, y: 0 }) && gs.moveCount === 2, `undo 後 red 回到 (15,0)，moveCount=2`);

  gs.applyMove('blue', 'left'); // 另一台再走一步
  gs.resetToInitial();
  const r = gs.getRobots();
  assert(Object.keys(init).every((c) => samePos(r[c], init[c])), 'resetToInitial 全部機器人回到起點');
  assert(gs.moveCount === 0 && gs.history.length === 0, 'reset 後 moveCount=0、歷史清空');
  assert(gs.undo() === null && gs.moveCount === 0, '無歷史時 undo 回傳 null 且步數不變為負');

  init.red.x = 99; // 外部修改不應影響回合起點
  gs.resetToInitial();
  assert(gs.robots.red.x === 5, 'initialRobots 為深拷貝，不受外部修改影響');
}

// =====================================================
section('7. 達陣規則');
{
  // 目標 (3,3) 位於 L 型牆角（上、左有牆）
  const grid = emptyGrid();
  addWall(grid, 3, 3, 'top');
  addWall(grid, 3, 3, 'left');
  const redTarget = { color: 'red', shape: 'star', x: 3, y: 3 };
  const vortexTarget = { color: 'vortex', shape: 'vortex', x: 3, y: 3 };

  // (a) 正確顏色 + 轉向：red 向左撞 blue 停 (3,10)，再向上停 (3,3)
  {
    const gs = new GameState().initRound(grid, {
      red: { x: 12, y: 10 }, blue: { x: 2, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    assert(gs.checkGoalReached().reason === GOAL_REASON.NOT_REACHED, '開局：未達陣');
    gs.applyMove('red', 'left');
    gs.applyMove('red', 'up');
    const res = gs.checkGoalReached();
    assert(samePos(gs.robots.red, redTarget), `red 抵達目標 ${fmt(gs.robots.red)}`);
    assert(res.success && res.robot === 'red' && res.reason === GOAL_REASON.SUCCESS, '正確顏色 + 轉向 → 成功');
  }

  // (b) 錯誤顏色抵達
  {
    const gs = new GameState().initRound(grid, {
      red: { x: 2, y: 10 }, blue: { x: 12, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    gs.applyMove('blue', 'left');
    gs.applyMove('blue', 'up');
    const res = gs.checkGoalReached();
    assert(samePos(gs.robots.blue, redTarget), 'blue 停在紅色目標格');
    assert(!res.success && res.reason === GOAL_REASON.WRONG_COLOR, '錯誤顏色 → 失敗 (wrong_color)');
  }

  // (c) 彩色漩渦：任意顏色抵達
  for (const color of ['green', 'yellow']) {
    const others = ['red', 'blue', 'yellow', 'green'].filter((c) => c !== color);
    const robots = { [color]: { x: 12, y: 10 }, [others[0]]: { x: 2, y: 10 }, [others[1]]: { x: 15, y: 15 }, [others[2]]: { x: 0, y: 15 } };
    const gs = new GameState().initRound(grid, robots, vortexTarget);
    gs.applyMove(color, 'left');
    gs.applyMove(color, 'up');
    const res = gs.checkGoalReached();
    assert(res.success && res.robot === color, `漩渦目標：${color} 抵達 → 成功`);
  }
  {
    // Step1 資料格式 color: 'multi' 亦視為漩渦
    const gs = new GameState().initRound(grid, {
      blue: { x: 12, y: 10 }, red: { x: 2, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, { color: 'multi', shape: 'vortex', x: 3, y: 3 });
    gs.applyMove('blue', 'left');
    gs.applyMove('blue', 'up');
    assert(gs.checkGoalReached().success, "漩渦目標（color: 'multi'）：blue 抵達 → 成功");
  }

  // (d) 1 步直達（未轉向）→ 不合規
  {
    const gs = new GameState().initRound(grid, {
      red: { x: 3, y: 12 }, blue: { x: 10, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    gs.applyMove('red', 'up');
    const res = gs.checkGoalReached();
    assert(samePos(gs.robots.red, redTarget), 'red 一步直達目標格');
    assert(!res.success && res.reached && res.reason === GOAL_REASON.NO_RICOCHET, '1 步直達 → 不合規 (no_ricochet)');

    // 復原後改走合規路線（先移別台當擋板，再一步抵達）也應成功
    gs.undo();
    gs.applyMove('blue', 'left'); // (10,10) → (0,10)
    gs.applyMove('red', 'up');
    const res2 = gs.checkGoalReached();
    assert(gs.moveCount === 2 && res2.robotMoves === 1, '總步數 2，但 red 本身只移動 1 次');
    assert(!res2.success && res2.reason === GOAL_REASON.NO_RICOCHET, '其他機器人先移動、目標機器人 1 步抵達 → 仍不合規 (no_ricochet)');
  }
  {
    // 其他機器人多步 + 目標機器人 1 步 → 不合規
    const gs = new GameState().initRound(grid, {
      red: { x: 3, y: 12 }, blue: { x: 10, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    gs.applyMove('blue', 'up');
    gs.applyMove('blue', 'left');
    gs.applyMove('yellow', 'up');
    gs.applyMove('red', 'up');
    const res = gs.checkGoalReached();
    assert(gs.moveCount === 4 && !res.success && res.reason === GOAL_REASON.NO_RICOCHET, '總步數 4、red 僅 1 步 → 不合規');
  }
  {
    // 目標機器人 2 步，中間穿插其他機器人移動 → 成功
    const gs = new GameState().initRound(grid, {
      red: { x: 12, y: 10 }, blue: { x: 2, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    gs.applyMove('red', 'left');   // → (3,10) 撞 blue
    gs.applyMove('blue', 'down');  // blue 離開
    gs.applyMove('red', 'up');     // → (3,3)
    const res = gs.checkGoalReached();
    assert(res.success && res.robotMoves === 2 && gs.moveCount === 3, '目標機器人移動 2 次（中間穿插他台）→ 成功');
    gs.undo();
    assert(gs.checkGoalReached().reason === GOAL_REASON.NOT_REACHED, 'undo 後重新判定為未達陣');
  }
  {
    const gs = new GameState().initRound(grid, {
      red: { x: 13, y: 3 }, blue: { x: 10, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, vortexTarget);
    gs.applyMove('red', 'left');
    assert(gs.checkGoalReached().reason === GOAL_REASON.NO_RICOCHET, '漩渦目標 1 步直達 → 同樣不合規');
  }
  {
    const gs = new GameState().initRound(grid, {
      red: { x: 3, y: 3 }, blue: { x: 10, y: 10 }, yellow: { x: 15, y: 15 }, green: { x: 0, y: 15 },
    }, redTarget);
    assert(gs.checkGoalReached().reason === GOAL_REASON.NO_RICOCHET, '起點即在目標格（0 步）→ 不合規');
  }
}

// =====================================================
section('8. 實際範例地圖整合');
{
  const data = JSON.parse(readFileSync(join(__dirname, '../src/data/sample_boards.json'), 'utf8'));
  const grid = assembleBigBoard(...data.boards.slice(0, 4));
  // 紅星位於 (1,2)，上方與右方有牆
  const target = { color: 'red', shape: 'star', x: 1, y: 2 };
  const gs = new GameState().initRound(grid, {
    red: { x: 1, y: 15 }, blue: { x: 10, y: 10 }, yellow: { x: 12, y: 3 }, green: { x: 4, y: 14 },
  }, target);
  const s = gs.applyMove('red', 'up');
  assert(samePos(s.to, target) && s.stoppedBy === 'wall', `red 由 (1,15) 向上被紅星上方牆擋在 ${fmt(s.to)}`);
  assert(gs.checkGoalReached().reason === GOAL_REASON.NO_RICOCHET, '範例地圖 1 步直達 → 不合規');
}

// =====================================================
section('9. 錯誤輸入處理');
{
  const grid = emptyGrid();
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  assert(throws(() => calculateSlide(grid, baseRobots(), 'red', 'north')), '非法方向拋出錯誤');
  assert(throws(() => calculateSlide(grid, baseRobots(), 'purple', 'up')), '未知機器人拋出錯誤');
  assert(throws(() => new GameState().applyMove('red', 'up')), '未 initRound 即移動拋出錯誤');
  assert(throws(() => new GameState().initRound(grid, { ...baseRobots(), red: { x: 7, y: 7 } }, { color: 'red', x: 0, y: 0 })), '機器人放在卡榫拋出錯誤');
  assert(throws(() => new GameState().initRound(grid, { ...baseRobots(), red: { x: 10, y: 10 } }, { color: 'red', x: 0, y: 0 })), '機器人重疊拋出錯誤');
  assert(new GameState().checkGoalReached().reason === GOAL_REASON.NO_ROUND, '未初始化時 checkGoalReached 回傳 no_round');
}

// =====================================================
section('10. 白色機器人變體 (Silver Robot) 碰撞與達陣規則');
{
  const grid = emptyGrid();
  addWall(grid, 3, 3, 'left');
  addWall(grid, 3, 3, 'top');
  const redTarget = { color: 'red', shape: 'circle', x: 3, y: 3 };
  const vortexTarget = { color: 'vortex', shape: 'vortex', x: 3, y: 3 };

  // (a) 白色機器人作為障礙物阻擋其他機器人
  {
    const robots = {
      red: { x: 0, y: 5 },
      blue: { x: 10, y: 10 },
      yellow: { x: 15, y: 15 },
      green: { x: 0, y: 15 },
      silver: { x: 6, y: 5 },
    };
    const slide = calculateSlide(grid, robots, 'red', 'right');
    assert(samePos(slide.to, { x: 5, y: 5 }), 'red 向右被 silver 機器人擋在 (5,5)');
    assert(slide.stoppedBy === 'robot' && slide.blocker === 'silver', 'stoppedBy 為 robot 且 blocker 為 silver');

    // silver 亦可被其他機器人阻擋
    const slideSilver = calculateSlide(grid, { ...robots, blue: { x: 6, y: 8 } }, 'silver', 'down');
    assert(samePos(slideSilver.to, { x: 6, y: 7 }), 'silver 向下被 blue 擋在 (6,7)');
    assert(slideSilver.stoppedBy === 'robot' && slideSilver.blocker === 'blue', 'silver 被 blue 阻擋');
  }

  // (b) 白色機器人無法達成有色目標 (wrong_color)
  {
    const robots = {
      red: { x: 0, y: 0 },
      blue: { x: 2, y: 10 },
      yellow: { x: 15, y: 15 },
      green: { x: 0, y: 15 },
      silver: { x: 12, y: 10 },
    };
    const gs = new GameState().initRound(grid, robots, redTarget);
    gs.applyMove('silver', 'left'); // (12,10) -> (3,10) 被 blue 擋
    gs.applyMove('silver', 'up');   // (3,10) -> (3,3) 被 (3,3).top 擋
    assert(samePos(gs.robots.silver, { x: 3, y: 3 }), 'silver 移動 2 步抵達 (3,3)');
    const res = gs.checkGoalReached();
    assert(res.robot === 'silver', '停在目標格的為 silver 機器人');
    assert(!res.success, 'silver 抵達紅色目標不可獲勝 (success=false)');
    assert(res.reason === GOAL_REASON.WRONG_COLOR, 'silver 抵達有色目標原因為 wrong_color');
  }

  // (c) 白色機器人達成彩色漩渦目標 (vortex)
  {
    // 1 步直達漩渦目標：不合規 (no_ricochet)
    const robots1 = {
      red: { x: 0, y: 0 },
      blue: { x: 10, y: 10 },
      yellow: { x: 15, y: 15 },
      green: { x: 0, y: 15 },
      silver: { x: 3, y: 10 },
    };
    const gs1 = new GameState().initRound(grid, robots1, vortexTarget);
    gs1.applyMove('silver', 'up'); // 1 步直達 (3,3)
    const res1 = gs1.checkGoalReached();
    assert(samePos(gs1.robots.silver, { x: 3, y: 3 }), 'silver 1 步抵達漩渦');
    assert(!res1.success && res1.reason === GOAL_REASON.NO_RICOCHET, 'silver 1 步直達漩渦不合規 (no_ricochet)');

    // 2 步轉向達陣漩渦目標：成功獲勝！
    const robots2 = {
      red: { x: 0, y: 0 },
      blue: { x: 2, y: 10 },
      yellow: { x: 15, y: 15 },
      green: { x: 0, y: 15 },
      silver: { x: 12, y: 10 },
    };
    const gs2 = new GameState().initRound(grid, robots2, vortexTarget);
    gs2.applyMove('silver', 'left'); // 轉向第 1 步 -> (3,10)
    gs2.applyMove('silver', 'up');   // 轉向第 2 步 -> (3,3)
    const res2 = gs2.checkGoalReached();
    assert(res2.success, 'silver 移動 2 步達成漩渦目標成功 (success=true)');
    assert(res2.robot === 'silver', '達陣機器人為 silver');
    assert(res2.reason === GOAL_REASON.SUCCESS, '原因為 success');
  }

  // (d) 5 台機器人回合重設與歷史維護
  {
    const robots = {
      red: { x: 0, y: 0 },
      blue: { x: 1, y: 0 },
      yellow: { x: 2, y: 0 },
      green: { x: 3, y: 0 },
      silver: { x: 4, y: 0 },
    };
    const gs = new GameState().initRound(grid, robots, redTarget);
    assert(Object.keys(gs.getRobots()).length === 5, 'GameState 支援 5 台機器人');
    gs.applyMove('silver', 'down');
    assert(gs.robots.silver.y === 15, 'silver 滑動至底部');
    assert(gs.countMovesOf('silver') === 1, 'silver 移動計數為 1');
    gs.resetToInitial();
    assert(samePos(gs.robots.silver, { x: 4, y: 0 }), 'resetToInitial 成功復原 silver 起點');
    assert(gs.moveCount === 0, '步數歸零');
  }
}

section('測試結果');
console.log(`  通過: ${passed}  失敗: ${failed}`);
if (failed > 0) process.exit(1);
