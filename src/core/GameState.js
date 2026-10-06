/**
 * GameState
 * 單回合狀態管理：目標、機器人位置、步數、歷史紀錄、復原與重設、達陣檢核。
 */
import { calculateSlide, cloneRobots, isValidDirection } from './MovementEngine.js';
import { ROBOT_COLORS, VORTEX_COLORS } from './constants.js';

/** 達陣檢核結果原因碼 */
export const GOAL_REASON = Object.freeze({
  SUCCESS: 'success',
  NO_ROUND: 'no_round',         // 尚未初始化回合
  NOT_REACHED: 'not_reached',   // 沒有機器人停在目標格
  WRONG_COLOR: 'wrong_color',   // 停在目標格的機器人顏色不符
  NO_RICOCHET: 'no_ricochet',   // 未轉向（0 步或 1 步直達），不合規
});

/** 目標是否為彩色漩渦（任意顏色皆可達陣） */
export function isVortexTarget(target) {
  return !!target && (VORTEX_COLORS.includes(target.color) || target.shape === 'vortex');
}

export class GameState {
  constructor() {
    this.grid = null;
    this.initialRobots = null;
    this.robots = null;
    this.target = null;
    this.moveCount = 0;
    this.history = [];
  }

  /**
   * 初始化回合。
   * @param {Array<Array<object>>} grid 16×16 大地圖
   * @param {Record<string,{x:number,y:number}>} initialRobots 回合起點位置
   * @param {{color:string, shape:string, x:number, y:number}} target 回合目標
   */
  initRound(grid, initialRobots, target) {
    if (!Array.isArray(grid) || grid.length === 0) throw new Error('Invalid grid');
    const size = grid.length;
    const inBounds = (p) => Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;

    const seen = new Set();
    for (const color of ROBOT_COLORS) {
      const p = initialRobots?.[color];
      if (!inBounds(p)) throw new Error(`Robot ${color} missing or out of bounds`);
      if (grid[p.y][p.x].blocked) throw new Error(`Robot ${color} placed on center hub`);
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) throw new Error(`Robots overlap at (${key})`);
      seen.add(key);
    }
    if (!target || !inBounds(target)) throw new Error('Target missing or out of bounds');
    if (!isVortexTarget(target) && !ROBOT_COLORS.includes(target.color)) {
      throw new Error(`Invalid target color: ${target.color}`);
    }

    this.grid = grid;
    this.initialRobots = cloneRobots(initialRobots);
    this.robots = cloneRobots(initialRobots);
    this.target = { ...target };
    this.moveCount = 0;
    this.history = [];
    return this;
  }

  _ensureRound() {
    if (!this.grid) throw new Error('Round not initialized. Call initRound() first.');
  }

  /** 取得目前機器人位置（拷貝） */
  getRobots() {
    this._ensureRound();
    return cloneRobots(this.robots);
  }

  /**
   * 執行移動。只有實際移動（moved: true）才會更新位置、步數與歷史。
   * @returns 滑動結果（同 calculateSlide）
   */
  applyMove(color, direction) {
    this._ensureRound();
    if (!ROBOT_COLORS.includes(color)) throw new Error(`Unknown robot: ${color}`);
    if (!isValidDirection(direction)) throw new Error(`Invalid direction: ${direction}`);

    const slide = calculateSlide(this.grid, this.robots, color, direction);
    if (slide.moved) {
      this.robots[color] = { ...slide.to };
      this.moveCount++;
      this.history.push({
        color,
        direction,
        from: { ...slide.from },
        to: { ...slide.to },
        path: slide.path.map((p) => ({ ...p })),
      });
    }
    return slide;
  }

  /** 復原最後一步，回傳被復原的歷史項目；無歷史時回傳 null */
  undo() {
    this._ensureRound();
    const last = this.history.pop();
    if (!last) return null;
    this.robots[last.color] = { ...last.from };
    this.moveCount--;
    return last;
  }

  /** 全部機器人彈回回合起點 */
  resetToInitial() {
    this._ensureRound();
    this.robots = cloneRobots(this.initialRobots);
    this.moveCount = 0;
    this.history = [];
  }

  /** 指定機器人在本回合歷史中的移動次數 */
  countMovesOf(color) {
    return this.history.filter((h) => h.color === color).length;
  }

  /**
   * 達陣檢核。
   * 規則：
   *   1. 有機器人停在 target 座標
   *   2. 顏色相符（漩渦目標任意顏色皆可）
   *   3. 至少轉向一次：抵達目標的那台機器人本身移動次數必須 ≥ 2
   *      （即使總步數 > 1，若該機器人只移動 1 次即達陣，仍判定 no_ricochet）
   * @returns {{success:boolean, reached:boolean, robot:string|null, robotMoves:number, reason:string}}
   */
  checkGoalReached() {
    if (!this.grid || !this.target) {
      return { success: false, reached: false, robot: null, robotMoves: 0, reason: GOAL_REASON.NO_ROUND };
    }
    const { x, y } = this.target;
    const vortex = isVortexTarget(this.target);
    const onTarget = ROBOT_COLORS.filter((c) => this.robots[c].x === x && this.robots[c].y === y);

    if (onTarget.length === 0) {
      return { success: false, reached: false, robot: null, robotMoves: 0, reason: GOAL_REASON.NOT_REACHED };
    }
    const robot = vortex ? onTarget[0] : onTarget.find((c) => c === this.target.color) ?? null;
    if (!robot) {
      const other = onTarget[0];
      return { success: false, reached: false, robot: other, robotMoves: this.countMovesOf(other), reason: GOAL_REASON.WRONG_COLOR };
    }
    const robotMoves = this.countMovesOf(robot);
    if (robotMoves < 2) {
      return { success: false, reached: true, robot, robotMoves, reason: GOAL_REASON.NO_RICOCHET };
    }
    return { success: true, reached: true, robot, robotMoves, reason: GOAL_REASON.SUCCESS };
  }
}
