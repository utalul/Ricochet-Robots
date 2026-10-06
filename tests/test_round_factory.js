/**
 * 測試：RoundFactory 洗牌、版圖抽選、隨機落點與牌堆抽取
 * 執行：node tests/test_round_factory.js
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assembleBigBoard, collectTargets } from '../src/core/BoardAssembler.js';
import {
  shuffle,
  pickQuadrantBoards,
  randomRobotPositions,
  createTargetDeck,
  drawTarget,
} from '../src/core/RoundFactory.js';
import { ROBOT_COLORS } from '../src/core/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// 載入完整 12 張子版圖資料
const data = JSON.parse(readFileSync(join(__dirname, '../src/data/boards.json'), 'utf8'));
const sampleBoards = data.boards;

// =====================================================
section('1. shuffle 與偽隨機數產生器 (PRNG)');
{
  const arr = [1, 2, 3, 4, 5];
  // 固定 PRNG (線性同餘)
  let seed = 42;
  const prng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const shuffled = shuffle(arr, prng);
  assert(shuffled.length === arr.length, '洗牌後長度不變');
  assert(shuffled.sort().join(',') === arr.sort().join(','), '洗牌後元素不變');
  assert(shuffled !== arr, 'shuffle 回傳新陣列，不修改原陣列');
}

// =====================================================
section('2. pickQuadrantBoards');
{
  const picked = pickQuadrantBoards(sampleBoards);
  assert(picked.length === 4, '抽選 4 張版圖');
  const groups = new Set(picked.map((b) => b.group));
  assert(groups.size === 4, '4 張版圖屬於不同組別 (A, B, C, D)');
}

// =====================================================
section('3. randomRobotPositions');
{
  const grid = assembleBigBoard(...sampleBoards.slice(0, 4));
  const robots = randomRobotPositions(grid);
  const keys = Object.keys(robots);
  assert(keys.length === 4, '包含 4 台機器人');
  assert(ROBOT_COLORS.every((c) => robots[c]), '包含所有 ROBOT_COLORS');

  const positions = Object.values(robots);
  const posSet = new Set(positions.map((p) => `${p.x},${p.y}`));
  assert(posSet.size === 4, '機器人起點互不重疊');

  const inBounds = positions.every((p) => p.x >= 0 && p.x < 16 && p.y >= 0 && p.y < 16);
  assert(inBounds, '機器人起點皆在 16x16 範圍內');

  const notBlocked = positions.every((p) => !grid[p.y][p.x].blocked);
  assert(notBlocked, '機器人起點不在中央卡榫');

  const notTarget = positions.every((p) => !grid[p.y][p.x].target);
  assert(notTarget, '機器人起點不在目標格上');
}

// =====================================================
section('4. createTargetDeck 與 drawTarget');
{
  const grid = assembleBigBoard(...sampleBoards.slice(0, 4));
  const targets = collectTargets(grid);
  const deck = createTargetDeck(targets);
  assert(deck.length === targets.length, '牌堆張數等於地圖目標總數');

  const robots = {
    red: { x: targets[0].x, y: targets[0].y },
    blue: { x: 0, y: 0 },
    yellow: { x: 1, y: 0 },
    green: { x: 2, y: 0 },
  };

  const drawn = drawTarget(deck, robots);
  assert(drawn !== null, '成功抽取目標');
  assert(!(drawn.x === robots.red.x && drawn.y === robots.red.y), '跳過已有機器人站立之目標');
  assert(deck.length === targets.length - 1, '牌堆長度減少 1');
}

section('測試結果');
console.log(`  通過: ${passed}  失敗: ${failed}`);
if (failed > 0) process.exit(1);
