/**
 * RoundFactory
 * 隨機開局工具：子版圖洗牌、機器人隨機落點（支援 4 色或 5 色白/銀機器人變體）、目標牌堆。
 * 所有函式皆接受可注入的 rng（預設 Math.random），方便測試重現。
 */
import { ROBOT_COLORS, ROBOT_COLORS_5 } from './constants.js';

/** Fisher–Yates 洗牌，回傳新陣列 */
export function shuffle(array, rng = Math.random) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 從子版圖清單中挑出 4 張不同組別並隨機排列象限。
 * 同組別若有多張（例如 A_01 / A_02 正反面），每組隨機取 1 張。
 */
export function pickQuadrantBoards(boards, rng = Math.random) {
  const byGroup = new Map();
  for (const b of boards) {
    if (!byGroup.has(b.group)) byGroup.set(b.group, []);
    byGroup.get(b.group).push(b);
  }
  if (byGroup.size < 4) throw new Error(`Need boards from at least 4 groups (got ${byGroup.size})`);
  const groups = shuffle([...byGroup.keys()], rng).slice(0, 4);
  return groups.map((g) => {
    const list = byGroup.get(g);
    return list[Math.floor(rng() * list.length)];
  });
}

/**
 * 為機器人隨機挑選不重疊、非卡榫、非目標格的起點。
 * 支援 4 色或選用白色機器人變體（5 台）。
 * @param {Array<Array<object>>} grid
 * @param {() => number} [rng]
 * @param {boolean|{useSilver?:boolean, colors?:string[]}} [options]
 */
export function randomRobotPositions(grid, rng = Math.random, options = {}) {
  let robotColors = ROBOT_COLORS;
  if (Array.isArray(options)) {
    robotColors = options;
  } else if (typeof options === 'boolean') {
    robotColors = options ? ROBOT_COLORS_5 : ROBOT_COLORS;
  } else if (options && typeof options === 'object') {
    if (options.colors) robotColors = options.colors;
    else if (options.useSilver) robotColors = ROBOT_COLORS_5;
  }

  const candidates = [];
  for (const row of grid) {
    for (const cell of row) {
      if (!cell.blocked && !cell.target) candidates.push({ x: cell.x, y: cell.y });
    }
  }
  if (candidates.length < robotColors.length) throw new Error('Not enough free cells for robots');
  const picked = shuffle(candidates, rng).slice(0, robotColors.length);
  const robots = {};
  robotColors.forEach((c, i) => {
    robots[c] = picked[i];
  });
  return robots;
}

/** 建立洗好的目標牌堆（回傳新陣列，從尾端 pop 取牌） */
export function createTargetDeck(targets, rng = Math.random) {
  return shuffle(targets.map((t) => ({ ...t })), rng);
}

/**
 * 從牌堆抽出下一個目標，跳過目前已有機器人站著的目標（避免 0 步即在目標上）。
 * 會直接修改 deck。牌堆抽完時回傳 null。
 */
export function drawTarget(deck, robots) {
  const occupied = new Set(Object.values(robots).map((p) => `${p.x},${p.y}`));
  for (let i = deck.length - 1; i >= 0; i--) {
    const t = deck[i];
    if (!occupied.has(`${t.x},${t.y}`)) {
      deck.splice(i, 1);
      return t;
    }
  }
  return null;
}
