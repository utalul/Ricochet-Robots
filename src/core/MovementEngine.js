/**
 * MovementEngine
 * 無狀態的滑動與碰撞運算。所有函式皆為純函式，不會修改傳入的 grid 或 robots。
 *
 * grid[y][x] = { top, right, bottom, left, blocked, ... }（由 BoardAssembler 產生，牆面雙向一致）
 * robots     = { red: {x,y}, blue: {x,y}, yellow: {x,y}, green: {x,y} }
 */
import { DIRECTION_TO_EDGE, DIRECTION_DELTA } from './constants.js';

export const STOP_REASON = Object.freeze({
  WALL: 'wall',   // 牆壁、外圍邊界、中央卡榫
  ROBOT: 'robot', // 其他機器人
});

/** 判斷方向是否合法 */
export function isValidDirection(direction) {
  return Object.prototype.hasOwnProperty.call(DIRECTION_TO_EDGE, direction);
}

/** 回傳佔據 (x, y) 的機器人顏色（排除 exceptColor），無則回傳 null */
export function robotAt(robots, x, y, exceptColor = null) {
  for (const [color, pos] of Object.entries(robots)) {
    if (color !== exceptColor && pos && pos.x === x && pos.y === y) return color;
  }
  return null;
}

/**
 * 計算機器人朝指定方向無煞車滑動的結果。
 * 每一步依序檢查：
 *   1. 當前格在該方向是否有牆 → 停（wall）
 *   2. 下一格超出邊界或為中央卡榫 → 停（wall）
 *   3. 下一格有其他機器人 → 停（robot）
 *
 * @param {Array<Array<object>>} grid
 * @param {Record<string,{x:number,y:number}>} robots
 * @param {string} movingColor
 * @param {'up'|'down'|'left'|'right'} direction
 * @returns {{moved:boolean, color:string, direction:string, from:{x,y}, to:{x,y}, path:Array<{x,y}>, distance:number, stoppedBy:'wall'|'robot', blocker:string|null}}
 */
export function calculateSlide(grid, robots, movingColor, direction) {
  if (!Array.isArray(grid) || grid.length === 0) throw new Error('Invalid grid');
  if (!isValidDirection(direction)) throw new Error(`Invalid direction: ${direction}`);
  const start = robots?.[movingColor];
  if (!start) throw new Error(`Unknown robot: ${movingColor}`);

  const height = grid.length;
  const width = grid[0].length;
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) {
    throw new Error(`Robot ${movingColor} out of bounds at (${start.x},${start.y})`);
  }

  const edge = DIRECTION_TO_EDGE[direction];
  const { dx, dy } = DIRECTION_DELTA[edge];

  let x = start.x;
  let y = start.y;
  const path = [{ x, y }];
  let stoppedBy = STOP_REASON.WALL;
  let blocker = null;

  // 最多走 max(width, height) 步，避免異常資料造成無窮迴圈
  for (let step = 0; step < Math.max(width, height); step++) {
    if (grid[y][x][edge]) break; // 1. 牆

    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) break; // 2. 邊界
    if (grid[ny][nx].blocked) break; // 2. 中央卡榫

    const other = robotAt(robots, nx, ny, movingColor); // 3. 機器人
    if (other) {
      stoppedBy = STOP_REASON.ROBOT;
      blocker = other;
      break;
    }

    x = nx;
    y = ny;
    path.push({ x, y });
  }

  return {
    moved: path.length > 1,
    color: movingColor,
    direction,
    from: { x: start.x, y: start.y },
    to: { x, y },
    path,
    distance: path.length - 1,
    stoppedBy,
    blocker,
  };
}

/** 回傳套用滑動結果後的新 robots 物件（不修改原物件） */
export function applySlide(robots, slide) {
  if (!slide.moved) return cloneRobots(robots);
  return { ...cloneRobots(robots), [slide.color]: { ...slide.to } };
}

/** 深拷貝機器人位置字典 */
export function cloneRobots(robots) {
  const out = {};
  for (const [color, pos] of Object.entries(robots)) out[color] = { x: pos.x, y: pos.y };
  return out;
}
