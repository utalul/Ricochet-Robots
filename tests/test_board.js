/**
 * 測試：子版圖旋轉與 16×16 大地圖拼裝
 * 執行：npm test  （或 node tests/test_board.js）
 * 選項：--quiet 不印出完整 JSON
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  rotateBoard,
  rotatePointCW,
  rotateEdgeCW,
  assembleBigBoard,
  collectTargets,
} from '../src/core/BoardAssembler.js';
import { BOARD_SIZE, CENTER_HUB, QUADRANTS, EDGE_ORDER_CW } from '../src/core/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUIET = process.argv.includes('--quiet');

// ---------- 迷你測試框架 ----------
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  console.assert(cond, msg);
  if (cond) passed++;
  else failed++;
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------- 載入資料 ----------
const data = JSON.parse(readFileSync(join(__dirname, '../src/data/sample_boards.json'), 'utf8'));
const boards = data.boards;
const [A, B, C, D] = boards;

/**
 * 獨立的封閉式旋轉公式（與 rotateBoard 的逐次旋轉實作不同），用來交叉驗證。
 * r=0:(x,y)  r=1:(7-y,x)  r=2:(7-x,7-y)  r=3:(y,7-x)
 */
function expectedPoint(x, y, r) {
  switch (r) {
    case 0: return { x, y };
    case 1: return { x: 7 - y, y: x };
    case 2: return { x: 7 - x, y: 7 - y };
    case 3: return { x: y, y: 7 - x };
    default: throw new Error('bad r');
  }
}
const expectedEdge = (edge, r) => EDGE_ORDER_CW[(EDGE_ORDER_CW.indexOf(edge) + r) % 4];

// =====================================================
section('1. 基本旋轉函式');
{
  const p = rotatePointCW(1, 1);
  assert(p.x === 6 && p.y === 1, 'rotatePointCW(1,1) 應為 (6,1)');
  const n = rotatePointCW(7, 7);
  assert(n.x === 0 && n.y === 7, '缺口 (7,7) 旋轉一次應為 (0,7)');
  assert(rotateEdgeCW('top') === 'right', 'top → right');
  assert(rotateEdgeCW('right') === 'bottom', 'right → bottom');
  assert(rotateEdgeCW('bottom') === 'left', 'bottom → left');
  assert(rotateEdgeCW('left') === 'top', 'left → top');
}

// =====================================================
section('2. rotateBoard');
{
  const sample = {
    board_id: 'T',
    group: 'T',
    walls: [{ x: 1, y: 1, edge: 'top' }, { x: 1, y: 1, edge: 'right' }],
    targets: [{ x: 1, y: 1, color: 'yellow', shape: 'star' }],
  };
  const r1 = rotateBoard(sample, 1);
  assert(r1.walls[0].x === 6 && r1.walls[0].y === 1 && r1.walls[0].edge === 'right', '(1,1,top) 旋轉 1 次 → (6,1,right)');
  assert(r1.walls[1].x === 6 && r1.walls[1].y === 1 && r1.walls[1].edge === 'bottom', '(1,1,right) 旋轉 1 次 → (6,1,bottom)');
  assert(r1.targets[0].x === 6 && r1.targets[0].y === 1, '目標 (1,1) 旋轉 1 次 → (6,1)');
  assert(sample.walls[0].x === 1 && sample.walls[0].edge === 'top', 'rotateBoard 不應修改原始資料');

  for (const b of boards) {
    const r4 = rotateBoard(b, 4);
    assert(JSON.stringify(r4.walls) === JSON.stringify(b.walls), `[${b.board_id}] 旋轉 4 次牆壁應還原`);
    assert(JSON.stringify(r4.targets) === JSON.stringify(b.targets), `[${b.board_id}] 旋轉 4 次目標應還原`);
    const neg = rotateBoard(b, -1);
    const r3 = rotateBoard(b, 3);
    assert(JSON.stringify(neg.walls) === JSON.stringify(r3.walls), `[${b.board_id}] 旋轉 -1 次應等同 3 次`);

    for (let r = 0; r < 4; r++) {
      const rb = rotateBoard(b, r);
      const ok = b.walls.every((w, i) => {
        const e = expectedPoint(w.x, w.y, r);
        return rb.walls[i].x === e.x && rb.walls[i].y === e.y && rb.walls[i].edge === expectedEdge(w.edge, r);
      });
      assert(ok, `[${b.board_id}] 旋轉 ${r} 次牆壁符合封閉式公式`);
      const okT = b.targets.every((t, i) => {
        const e = expectedPoint(t.x, t.y, r);
        return rb.targets[i].x === e.x && rb.targets[i].y === e.y && rb.targets[i].color === t.color;
      });
      assert(okT, `[${b.board_id}] 旋轉 ${r} 次目標符合封閉式公式`);
    }
  }
}

// =====================================================
section('3. assembleBigBoard 結構');
const grid = assembleBigBoard(A, B, C, D);
{
  assert(grid.length === BOARD_SIZE, '大地圖應有 16 列');
  assert(grid.every((row) => row.length === BOARD_SIZE), '每列應有 16 格');
  const allBool = grid.flat().every((c) => EDGE_ORDER_CW.every((e) => typeof c[e] === 'boolean'));
  assert(allBool, '每格皆含 top/right/bottom/left 布林值');
  const coordsOk = grid.every((row, y) => row.every((c, x) => c.x === x && c.y === y));
  assert(coordsOk, 'grid[y][x] 的座標欄位一致');
}

// =====================================================
section('4. 缺口對準中央');
QUADRANTS.forEach((q, i) => {
  const rb = rotateBoard(boards[i], q.rotation);
  const ax = rb.notch.x + q.offsetX;
  const ay = rb.notch.y + q.offsetY;
  const hit = CENTER_HUB.some((c) => c.x === ax && c.y === ay);
  console.log(`  ${q.name.padEnd(12)} ${boards[i].board_id} rot=${q.rotation} 缺口→(${ax},${ay}) ${hit ? 'OK' : 'FAIL'}`);
  assert(hit, `[${boards[i].board_id}] 缺口應落在中央卡榫`);
});

// =====================================================
section('5. 目標座標無錯位');
QUADRANTS.forEach((q, i) => {
  for (const t of boards[i].targets) {
    const e = expectedPoint(t.x, t.y, q.rotation);
    const gx = e.x + q.offsetX;
    const gy = e.y + q.offsetY;
    const cell = grid[gy][gx];
    const ok = cell.target && cell.target.color === t.color && cell.target.shape === t.shape;
    console.log(`  ${boards[i].board_id} ${t.color}/${t.shape} 原(${t.x},${t.y}) → 大地圖(${gx},${gy}) ${ok ? 'OK' : 'FAIL'}`);
    assert(ok, `[${boards[i].board_id}] 目標 ${t.color}/${t.shape} 應位於 (${gx},${gy})`);
  }
});
{
  const targets = collectTargets(grid);
  const expectedCount = boards.reduce((s, b) => s + b.targets.length, 0);
  assert(targets.length === expectedCount, `目標總數應為 ${expectedCount}（實際 ${targets.length}）`);
  const keys = new Set(targets.map((t) => `${t.color}/${t.shape}`));
  assert(keys.size === targets.length, '目標顏色/符號組合不重複');
  assert(targets.every((t) => !grid[t.y][t.x].blocked), '目標不可位於中央卡榫');
}

// =====================================================
section('6. 牆壁無錯位（原始牆 → 大地圖）');
QUADRANTS.forEach((q, i) => {
  let ok = true;
  for (const w of boards[i].walls) {
    const e = expectedPoint(w.x, w.y, q.rotation);
    const edge = expectedEdge(w.edge, q.rotation);
    if (!grid[e.y + q.offsetY][e.x + q.offsetX][edge]) {
      ok = false;
      console.log(`  缺牆: ${boards[i].board_id} (${w.x},${w.y},${w.edge}) → (${e.x + q.offsetX},${e.y + q.offsetY},${edge})`);
    }
  }
  assert(ok, `[${boards[i].board_id}] 所有牆壁正確映射`);
});

// 目標 L 型角落：每個目標格至少有兩面相鄰（非對面）的牆
{
  const targets = collectTargets(grid);
  const isCorner = (c) =>
    (c.top && c.right) || (c.right && c.bottom) || (c.bottom && c.left) || (c.left && c.top);
  assert(targets.every((t) => isCorner(grid[t.y][t.x])), '每個目標格旋轉後仍位於 L 型牆角');
}

// =====================================================
section('7. 牆壁雙向一致性');
{
  let ok = true;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const c = grid[y][x];
      if (x + 1 < BOARD_SIZE && c.right !== grid[y][x + 1].left) {
        ok = false;
        console.log(`  不一致: (${x},${y}).right vs (${x + 1},${y}).left`);
      }
      if (y + 1 < BOARD_SIZE && c.bottom !== grid[y + 1][x].top) {
        ok = false;
        console.log(`  不一致: (${x},${y}).bottom vs (${x},${y + 1}).top`);
      }
    }
  }
  assert(ok, '相鄰格之間牆壁雙向一致');
}

// =====================================================
section('8. 外圍邊界');
{
  const last = BOARD_SIZE - 1;
  let ok = true;
  for (let i = 0; i < BOARD_SIZE; i++) {
    ok &&= grid[0][i].top && grid[last][i].bottom && grid[i][0].left && grid[i][last].right;
  }
  assert(ok, '外圍四邊皆有牆');
}

// =====================================================
section('9. 中央卡榫四周牆壁檢查');
{
  for (const { x, y } of CENTER_HUB) {
    const c = grid[y][x];
    const ok = c.blocked && c.top && c.right && c.bottom && c.left;
    console.log(`  卡榫 (${x},${y}) blocked=${c.blocked} T=${c.top} R=${c.right} B=${c.bottom} L=${c.left} ${ok ? 'OK' : 'FAIL'}`);
    assert(ok, `卡榫 (${x},${y}) 應為 blocked 且四面皆牆`);
  }
  const neighbours = [
    { x: 7, y: 6, edge: 'bottom' }, { x: 8, y: 6, edge: 'bottom' },
    { x: 9, y: 7, edge: 'left' },   { x: 9, y: 8, edge: 'left' },
    { x: 7, y: 9, edge: 'top' },    { x: 8, y: 9, edge: 'top' },
    { x: 6, y: 7, edge: 'right' },  { x: 6, y: 8, edge: 'right' },
  ];
  for (const n of neighbours) {
    const v = grid[n.y][n.x][n.edge];
    const blocked = grid[n.y][n.x].blocked;
    console.log(`  鄰格 (${n.x},${n.y}).${n.edge.padEnd(6)} = ${v} ${v && !blocked ? 'OK' : 'FAIL'}`);
    assert(v && !blocked, `鄰格 (${n.x},${n.y}) 面向卡榫的 ${n.edge} 應有牆且可進入`);
  }
  const blockedCount = grid.flat().filter((c) => c.blocked).length;
  assert(blockedCount === 4, `只有 4 格為 blocked（實際 ${blockedCount}）`);
}

// =====================================================
section('10. 錯誤輸入處理');
{
  let threw = false;
  try { assembleBigBoard(A, B, C); } catch { threw = true; }
  assert(threw, '缺少子版圖應拋出錯誤');
  threw = false;
  try { rotateBoard({ board_id: 'X', walls: [{ x: 8, y: 0, edge: 'top' }], targets: [] }, 1); } catch { threw = true; }
  assert(threw, '座標超出範圍應拋出錯誤');
  threw = false;
  try { rotateBoard({ board_id: 'X', walls: [{ x: 0, y: 0, edge: 'up' }], targets: [] }, 1); } catch { threw = true; }
  assert(threw, '非法 edge 應拋出錯誤');
}

// =====================================================
// ASCII 視覺化（# = 中央卡榫；目標以 顏色字母+符號字母 表示）
function renderAscii(g) {
  const colorCh = { red: 'r', green: 'g', blue: 'b', yellow: 'y', multi: 'm' };
  const shapeCh = { star: 'S', moon: 'M', planet: 'P', gear: 'G', vortex: 'V' };
  const lines = [];
  lines.push('    ' + g[0].map((_, x) => String(x).padStart(2, ' ').padEnd(4, ' ')).join(''));
  for (let y = 0; y < g.length; y++) {
    lines.push('    ' + g[y].map((c) => '+' + (c.top ? '---' : '   ')).join('') + '+');
    let mid = String(y).padStart(3, ' ') + ' ';
    for (const c of g[y]) {
      let content = '   ';
      if (c.blocked) content = '###';
      else if (c.target) content = ' ' + colorCh[c.target.color] + shapeCh[c.target.shape];
      mid += (c.left ? '|' : ' ') + content;
    }
    mid += g[y][g.length - 1].right ? '|' : ' ';
    lines.push(mid);
  }
  lines.push('    ' + g[g.length - 1].map((c) => '+' + (c.bottom ? '---' : '   ')).join('') + '+');
  return lines.join('\n');
}

section('拼裝結果 ASCII 視覺化');
console.log(renderAscii(grid));

// 輸出 JSON
const outDir = join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'assembled_board.json');
writeFileSync(outFile, JSON.stringify(grid, null, 2));

if (!QUIET) {
  section('16×16 大地圖 JSON（每行一列 grid[y]）');
  console.log('[');
  grid.forEach((row, y) => console.log('  ' + JSON.stringify(row) + (y < grid.length - 1 ? ',' : '')));
  console.log(']');
}
console.log(`\n完整 JSON 已寫入: ${outFile}`);

// =====================================================
section('11. 完整 12 張子版圖與 81 種全拼裝組合驗證 (boards.json)');
{
  const fullData = JSON.parse(readFileSync(join(__dirname, '../src/data/boards.json'), 'utf8'));
  const all12 = fullData.boards;
  assert(all12.length === 12, 'boards.json 包含完整的 12 張版圖');

  const groups = { A: [], B: [], C: [], D: [] };
  for (const b of all12) {
    if (groups[b.group]) groups[b.group].push(b);
  }
  assert(groups.A.length === 3 && groups.B.length === 3 && groups.C.length === 3 && groups.D.length === 3, 'A, B, C, D 各組皆有 3 張子版圖');

  // 遍歷 3 x 3 x 3 x 3 = 81 種組合
  let validCombinations = 0;
  for (const a of groups.A) {
    for (const b of groups.B) {
      for (const c of groups.C) {
        for (const d of groups.D) {
          const g = assembleBigBoard(a, b, c, d);
          const tList = collectTargets(g);
          const uniqueKeys = new Set(tList.map((t) => `${t.color}_${t.shape}`));

          const okTargets = tList.length === 17 && uniqueKeys.size === 17;
          const okBounds = tList.every((t) => t.x >= 0 && t.x < 16 && t.y >= 0 && t.y < 16 && !g[t.y][t.x].blocked);
          const okHub = CENTER_HUB.every((hub) => g[hub.y][hub.x].blocked);

          if (okTargets && okBounds && okHub) {
            validCombinations++;
          }
        }
      }
    }
  }
  assert(validCombinations === 81, `所有 81 種子版圖拼裝組合（3^4）皆合規且具備完整 17 個目標（實際成功 ${validCombinations} 種）`);
}

section('測試結果');
console.log(`  通過: ${passed}  失敗: ${failed}`);
if (failed > 0) process.exit(1);
