/**
 * BoardAssembler
 * 負責 8×8 子版圖的旋轉，以及 4 張子版圖拼裝成 16×16 大地圖。
 *
 * 座標系：左上角為 (0,0)，x 向右遞增，y 向下遞增。
 * 子版圖原始方向：卡榫缺口位於右下角 (7,7)。
 * 大地圖輸出：grid[y][x] = { x, y, top, right, bottom, left, blocked, target }
 */
import {
  BOARD_SIZE,
  SUB_BOARD_SIZE,
  CENTER_HUB,
  EDGE_ORDER_CW,
  OPPOSITE_EDGE,
  DIRECTION_DELTA,
  QUADRANTS,
} from './constants.js';

const MAX_SUB = SUB_BOARD_SIZE - 1; // 7

/** 將旋轉次數正規化為 0~3（支援負數＝逆時針） */
function normalizeTimes(times) {
  const t = Number.isInteger(times) ? times : 0;
  return ((t % 4) + 4) % 4;
}

/** 單一座標順時針旋轉 90°：(x, y) → (7 - y, x) */
export function rotatePointCW(x, y, size = SUB_BOARD_SIZE) {
  return { x: size - 1 - y, y: x };
}

/** 單一牆面順時針旋轉 90°：top → right → bottom → left → top */
export function rotateEdgeCW(edge) {
  const idx = EDGE_ORDER_CW.indexOf(edge);
  if (idx < 0) throw new Error(`Invalid edge: ${edge}`);
  return EDGE_ORDER_CW[(idx + 1) % 4];
}

/** 檢查子版圖資料格式 */
export function validateSubBoard(board) {
  if (!board || typeof board !== 'object') throw new Error('Board must be an object');
  const id = board.board_id ?? '(unknown)';
  const inRange = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SUB;

  if (!Array.isArray(board.walls)) throw new Error(`[${id}] walls must be an array`);
  if (!Array.isArray(board.targets)) throw new Error(`[${id}] targets must be an array`);

  for (const w of board.walls) {
    if (!inRange(w.x) || !inRange(w.y)) throw new Error(`[${id}] wall out of range: ${JSON.stringify(w)}`);
    if (!EDGE_ORDER_CW.includes(w.edge)) throw new Error(`[${id}] invalid wall edge: ${JSON.stringify(w)}`);
  }
  for (const t of board.targets) {
    if (!inRange(t.x) || !inRange(t.y)) throw new Error(`[${id}] target out of range: ${JSON.stringify(t)}`);
    if (t.x === MAX_SUB && t.y === MAX_SUB) throw new Error(`[${id}] target placed on hub notch (7,7)`);
  }
  return true;
}

/**
 * 將 8×8 子版圖順時針旋轉 90° × times 次。
 * 回傳新物件（不修改原始資料），牆壁座標/方向與目標座標皆同步更新。
 * @param {object} board 子版圖
 * @param {number} times 旋轉次數（負數為逆時針）
 */
export function rotateBoard(board, times = 1) {
  validateSubBoard(board);
  const n = normalizeTimes(times);

  let walls = board.walls.map((w) => ({ ...w }));
  let targets = board.targets.map((t) => ({ ...t }));

  for (let i = 0; i < n; i++) {
    walls = walls.map((w) => ({ ...w, ...rotatePointCW(w.x, w.y), edge: rotateEdgeCW(w.edge) }));
    targets = targets.map((t) => ({ ...t, ...rotatePointCW(t.x, t.y) }));
  }

  // 缺口位置同步追蹤，方便驗證
  let notch = { x: MAX_SUB, y: MAX_SUB };
  if (board.notch) notch = { ...board.notch };
  for (let i = 0; i < n; i++) notch = rotatePointCW(notch.x, notch.y);

  return {
    ...board,
    rotation: normalizeTimes((board.rotation ?? 0) + n),
    notch,
    walls,
    targets,
  };
}

/** 建立空白 16×16 網格 */
function createEmptyGrid(size = BOARD_SIZE) {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      x,
      y,
      top: false,
      right: false,
      bottom: false,
      left: false,
      blocked: false,
      target: null,
    })),
  );
}

/** 在大地圖上設牆，並同步補上相鄰格的對側牆（保證雙向一致） */
function setWall(grid, x, y, edge) {
  const size = grid.length;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  grid[y][x][edge] = true;
  const { dx, dy } = DIRECTION_DELTA[edge];
  const nx = x + dx;
  const ny = y + dy;
  if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
    grid[ny][nx][OPPOSITE_EDGE[edge]] = true;
  }
}

/**
 * 將 4 張子版圖拼裝成 16×16 大地圖。
 * 參數順序對應象限：左上、右上、右下、左下。
 * 每張子版圖會自動旋轉，使其缺口 (7,7) 對準大地圖中央 (7,7)~(8,8)。
 *
 * @returns {Array<Array<{x:number,y:number,top:boolean,right:boolean,bottom:boolean,left:boolean,blocked:boolean,target:object|null}>>}
 *          grid[y][x]
 */
export function assembleBigBoard(boardA, boardB, boardC, boardD) {
  const boards = [boardA, boardB, boardC, boardD];
  boards.forEach((b, i) => {
    if (!b) throw new Error(`Missing board for quadrant ${QUADRANTS[i].name}`);
  });

  const grid = createEmptyGrid();

  boards.forEach((board, i) => {
    const q = QUADRANTS[i];
    const rotated = rotateBoard(board, q.rotation);

    // 驗證缺口已對準中央卡榫
    const nx = rotated.notch.x + q.offsetX;
    const ny = rotated.notch.y + q.offsetY;
    if (!CENTER_HUB.some((c) => c.x === nx && c.y === ny)) {
      throw new Error(`[${board.board_id}] notch (${nx},${ny}) not aligned with center hub`);
    }

    for (const w of rotated.walls) {
      setWall(grid, w.x + q.offsetX, w.y + q.offsetY, w.edge);
    }

    for (const t of rotated.targets) {
      const cell = grid[t.y + q.offsetY][t.x + q.offsetX];
      if (cell.target) {
        throw new Error(`Duplicate target at (${cell.x},${cell.y})`);
      }
      cell.target = { color: t.color, shape: t.shape, board_id: board.board_id };
    }
  });

  // 外圍邊界補牆
  const last = BOARD_SIZE - 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    grid[0][i].top = true;
    grid[last][i].bottom = true;
    grid[i][0].left = true;
    grid[i][last].right = true;
  }

  // 中央卡榫：不可進入，四面皆牆，並讓四周相鄰格面向卡榫的一側也有牆
  for (const { x, y } of CENTER_HUB) {
    grid[y][x].blocked = true;
    for (const edge of EDGE_ORDER_CW) setWall(grid, x, y, edge);
  }

  return grid;
}

/** 取得大地圖上所有目標（含絕對座標） */
export function collectTargets(grid) {
  const result = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell.target) result.push({ x: cell.x, y: cell.y, ...cell.target });
    }
  }
  return result;
}
