/**
 * 全域常數定義：尺寸、方向、顏色、目標符號。
 */

/** 大地圖邊長 */
export const BOARD_SIZE = 16;
/** 子版圖邊長 */
export const SUB_BOARD_SIZE = 8;

/** 中央卡榫 (Central Hub) 佔據的座標 */
export const CENTER_HUB = Object.freeze([
  Object.freeze({ x: 7, y: 7 }),
  Object.freeze({ x: 8, y: 7 }),
  Object.freeze({ x: 7, y: 8 }),
  Object.freeze({ x: 8, y: 8 }),
]);

/** 子版圖原始檔中，卡榫缺口的位置（右下角） */
export const SUB_BOARD_NOTCH = Object.freeze({ x: 7, y: 7 });

/** 牆面方向 */
export const EDGES = Object.freeze({
  TOP: 'top',
  RIGHT: 'right',
  BOTTOM: 'bottom',
  LEFT: 'left',
});

/** 依順時針排序的牆面，用於旋轉計算 */
export const EDGE_ORDER_CW = Object.freeze(['top', 'right', 'bottom', 'left']);

/** 相對牆面（用於雙向補牆） */
export const OPPOSITE_EDGE = Object.freeze({
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
});

/** 方向位移量 (y 軸向下為正) */
export const DIRECTION_DELTA = Object.freeze({
  top: Object.freeze({ dx: 0, dy: -1 }),
  right: Object.freeze({ dx: 1, dy: 0 }),
  bottom: Object.freeze({ dx: 0, dy: 1 }),
  left: Object.freeze({ dx: -1, dy: 0 }),
});

/** 機器人 / 目標顏色 */
export const COLORS = Object.freeze({
  RED: 'red',
  GREEN: 'green',
  BLUE: 'blue',
  YELLOW: 'yellow',
  SILVER: 'silver',
  WHITE: 'silver',
  /** 彩色漩渦（任意顏色機器人皆可抵達） */
  MULTI: 'multi',
});

/** 漩渦目標可能使用的顏色標記（相容 Step1 資料的 'multi' 與規格的 'vortex'） */
export const VORTEX_COLORS = Object.freeze(['vortex', 'multi']);

/** 基礎 4 台機器人的顏色 */
export const ROBOT_COLORS = Object.freeze(['red', 'blue', 'yellow', 'green']);

/** 包含白色／銀色變體的 5 台機器人顏色 */
export const ROBOT_COLORS_5 = Object.freeze(['red', 'blue', 'yellow', 'green', 'silver']);

/** 所有可能機器人顏色清單 */
export const ALL_ROBOT_COLORS = Object.freeze(['red', 'blue', 'yellow', 'green', 'silver']);

/** 移動方向 */
export const DIRECTIONS = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
});

/** 移動方向 → 需檢查的牆面 */
export const DIRECTION_TO_EDGE = Object.freeze({
  up: 'top',
  down: 'bottom',
  left: 'left',
  right: 'right',
});

/** 目標符號 */
export const SHAPES = Object.freeze({
  STAR: 'star',
  MOON: 'moon',
  PLANET: 'planet',
  GEAR: 'gear',
  VORTEX: 'vortex',
});

/** 顯示用色碼 */
export const COLOR_HEX = Object.freeze({
  red: '#e53935',
  green: '#43a047',
  blue: '#1e88e5',
  yellow: '#fdd835',
  silver: '#cfd8dc',
  white: '#cfd8dc',
  multi: '#8e24aa',
});

/** 顯示用符號 */
export const SHAPE_SYMBOL = Object.freeze({
  star: '★',
  moon: '☾',
  planet: '◉',
  gear: '⚙',
  vortex: '✺',
});

/**
 * 四個象限（依 assembleBigBoard 參數順序：左上、右上、右下、左下）。
 * rotation：順時針旋轉 90° 的次數，使子版圖右下角缺口 (7,7) 轉向大地圖中央。
 *   左上 0 次 → 缺口 (7,7)
 *   右上 1 次 → 缺口 (0,7)
 *   右下 2 次 → 缺口 (0,0)
 *   左下 3 次 → 缺口 (7,0)
 */
export const QUADRANTS = Object.freeze([
  Object.freeze({ name: 'top-left', offsetX: 0, offsetY: 0, rotation: 0 }),
  Object.freeze({ name: 'top-right', offsetX: 8, offsetY: 0, rotation: 1 }),
  Object.freeze({ name: 'bottom-right', offsetX: 8, offsetY: 8, rotation: 2 }),
  Object.freeze({ name: 'bottom-left', offsetX: 0, offsetY: 8, rotation: 3 }),
]);
