/**
 * RoomState.js
 * 碰撞機器人多人連線房間狀態機。
 *
 * 房間四階段：
 * 1. THINKING: 自由思考期，翻開新目標，機器人起點固定，棋盤鎖死不可移動，玩家可下注步數。
 * 2. COUNTDOWN: 60 秒沙漏期，第一位下注者觸發，全體倒數。可繼續下注（個人新下注必須 < 前一次）。即時排序。
 * 3. DEMONSTRATING: 路徑展示期，下注鎖定。排行榜第一名獲得獨占操作鎖 (Mutex Lock)，其餘觀看。
 *    - 成功：剛好等於下注步數達陣（且符合轉向規則），得標並進 ROUND_END。
 *    - 失敗/放棄：步數超過或點擊放棄，機器人彈回起點，操作權依序轉移至次順位玩家。全員失敗則無人得標。
 * 4. ROUND_END: 結算期，顯示得主與得分，固定機器人位置，準備下一輪。
 */
import { GameState } from '../core/GameState.js';
import { cloneRobots } from '../core/MovementEngine.js';

export const ROOM_PHASE = Object.freeze({
  THINKING: 'THINKING',
  COUNTDOWN: 'COUNTDOWN',
  DEMONSTRATING: 'DEMONSTRATING',
  ROUND_END: 'ROUND_END',
});

export const BID_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  SUCCESS: 'success',
  FAILED: 'failed',
});

export class RoomState {
  /**
   * @param {object} [options]
   * @param {number} [options.countdownDuration=60] 倒數沙漏時長（秒）
   */
  constructor({ countdownDuration = 60 } = {}) {
    this.phase = ROOM_PHASE.THINKING;
    this.round = 1;
    this.grid = null;
    this.target = null;
    this.initialRobots = null;
    this.gameState = new GameState();

    /** 玩家字典：id -> { id, name, isHost, score } */
    this.players = new Map();

    /** 下注列表：{ playerId, playerName, moves, timestamp, status } */
    this.bids = [];

    this.countdownDuration = countdownDuration;
    this.countdownEnd = null;

    /** 目前獨占操作展示的玩家 ID */
    this.activeDemonstratorId = null;
    this.demonstrationIndex = 0;

    /** 本回合獲勝者：{ playerId, playerName, moves } | null */
    this.roundWinner = null;
  }

  /**
   * 初始化 / 開始新回合。
   * @param {object} params
   * @param {Array<Array<object>>} params.grid
   * @param {Record<string,{x,y}>} params.initialRobots
   * @param {object} params.target
   * @param {number} [params.round]
   */
  startRound({ grid, initialRobots, target, round }) {
    if (!grid || !initialRobots || !target) {
      throw new Error('grid, initialRobots, and target are required to start a round');
    }
    this.grid = grid;
    this.initialRobots = cloneRobots(initialRobots);
    this.target = { ...target };
    if (typeof round === 'number') this.round = round;

    this.gameState.initRound(this.grid, this.initialRobots, this.target);
    this.phase = ROOM_PHASE.THINKING;
    this.bids = [];
    this.countdownEnd = null;
    this.activeDemonstratorId = null;
    this.demonstrationIndex = 0;
    this.roundWinner = null;
    return this;
  }

  // ---------- 玩家管理 ----------

  addPlayer({ id, name, isHost = false, score = 0 }) {
    if (!id) throw new Error('Player ID required');
    const existing = this.players.get(id);
    const player = {
      id,
      name: name || `Player_${id.slice(0, 4)}`,
      isHost: existing ? existing.isHost : isHost,
      score: existing ? existing.score : score,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    // 若正在展示的玩家離線，自動放棄轉移
    if (this.phase === ROOM_PHASE.DEMONSTRATING && this.activeDemonstratorId === id) {
      this.forfeitDemonstration(id);
    }
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  getPlayerList() {
    return Array.from(this.players.values());
  }

  // ---------- 下注與排行榜 ----------

  /**
   * 取得排序後的排行榜。
   * 排序規則：
   * 1. 步數少者優先 (moves 升冪)
   * 2. 步數相同時，先下注者優先 (timestamp 升冪)
   */
  getLeaderboard() {
    return [...this.bids].sort((a, b) => {
      if (a.moves !== b.moves) return a.moves - b.moves;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * 提交下注。
   * 規則：
   * - 僅限 THINKING 或 COUNTDOWN 階段。
   * - 步數必須為大於等於 2 之整數（規則要求至少轉向一次）。
   * - 若該玩家已下注過，新下注必須嚴格小於自己前一次下注。
   * - 第一位下注者觸發 COUNTDOWN 階段並啟動 60 秒倒數。
   */
  submitBid(playerId, moves, timestamp = Date.now()) {
    if (this.phase !== ROOM_PHASE.THINKING && this.phase !== ROOM_PHASE.COUNTDOWN) {
      return { accepted: false, reason: `Cannot bid in phase ${this.phase}` };
    }
    const m = Number(moves);
    if (!Number.isInteger(m) || m < 2) {
      return { accepted: false, reason: 'Bid moves must be an integer >= 2' };
    }

    const player = this.players.get(playerId);
    const playerName = player ? player.name : `Player_${String(playerId).slice(0, 4)}`;

    const existingIndex = this.bids.findIndex((b) => b.playerId === playerId);
    if (existingIndex >= 0) {
      const prev = this.bids[existingIndex];
      if (m >= prev.moves) {
        return {
          accepted: false,
          reason: `New bid (${m}) must be strictly lower than your previous bid (${prev.moves})`,
        };
      }
      // 更新玩家下注
      this.bids[existingIndex] = {
        ...prev,
        moves: m,
        timestamp,
      };
    } else {
      this.bids.push({
        playerId,
        playerName,
        moves: m,
        timestamp,
        status: BID_STATUS.PENDING,
      });
    }

    // 重新排序
    this.bids = this.getLeaderboard();

    let phaseChanged = false;
    // 第一個有效下注觸發 COUNTDOWN
    if (this.phase === ROOM_PHASE.THINKING) {
      this.phase = ROOM_PHASE.COUNTDOWN;
      this.countdownEnd = timestamp + this.countdownDuration * 1000;
      phaseChanged = true;
    }

    return {
      accepted: true,
      phaseChanged,
      moves: m,
      phase: this.phase,
      countdownEnd: this.countdownEnd,
      leaderboard: this.getLeaderboard(),
    };
  }

  // ---------- 倒數結束與展示期 ----------

  /**
   * 倒數結束，切換至 DEMONSTRATING 展示期。
   * 鎖定下注，取出排行榜第一名玩家解鎖操作權。
   */
  endCountdown() {
    if (this.phase !== ROOM_PHASE.COUNTDOWN && this.phase !== ROOM_PHASE.THINKING) {
      return { success: false, reason: `Cannot end countdown in phase ${this.phase}` };
    }

    this.bids = this.getLeaderboard();
    if (this.bids.length === 0) {
      // 無人下注直接結算（平手/無人得標）
      this.phase = ROOM_PHASE.ROUND_END;
      this.roundWinner = null;
      return { success: true, phase: this.phase, demonstrator: null, reason: 'NO_BIDS' };
    }

    this.phase = ROOM_PHASE.DEMONSTRATING;
    this.demonstrationIndex = 0;
    const topBid = this.bids[0];
    topBid.status = BID_STATUS.ACTIVE;
    this.activeDemonstratorId = topBid.playerId;

    // 確保棋盤機器人在起始位置
    this.gameState.resetToInitial();

    return {
      success: true,
      phase: this.phase,
      demonstrator: { ...topBid },
    };
  }

  /** 目前正在展示的下注項目 */
  getCurrentDemonstratorBid() {
    if (this.phase !== ROOM_PHASE.DEMONSTRATING || !this.activeDemonstratorId) return null;
    return this.bids.find((b) => b.playerId === this.activeDemonstratorId && b.status === BID_STATUS.ACTIVE) || null;
  }

  // ---------- 獨占操作鎖與移動驗證 ----------

  /**
   * 展示者執行移動（Mutex Lock 嚴格驗證）。
   * 只有 activeDemonstratorId 能操作。
   *
   * @param {string} playerId
   * @param {string} robotColor
   * @param {'up'|'down'|'left'|'right'} direction
   * @returns {{success:boolean, moved?:boolean, slide?:object, outcome?:string, reason?:string}}
   */
  applyDemonstratorMove(playerId, robotColor, direction) {
    if (this.phase !== ROOM_PHASE.DEMONSTRATING) {
      return { success: false, reason: `Board is locked: current phase is ${this.phase}` };
    }
    if (playerId !== this.activeDemonstratorId) {
      return {
        success: false,
        reason: `Mutex lock violation: Only active demonstrator (${this.activeDemonstratorId}) can move`,
      };
    }

    const curBid = this.getCurrentDemonstratorBid();
    if (!curBid) {
      return { success: false, reason: 'No active bid found for demonstrator' };
    }

    const slide = this.gameState.applyMove(robotColor, direction);
    if (!slide.moved) {
      return { success: true, moved: false, slide, outcome: 'BLOCKED' };
    }

    const moveCount = this.gameState.moveCount;
    const goal = this.gameState.checkGoalReached();

    // 1. 達陣成功判定：達陣且步數剛好等於下注步數
    if (goal.success && moveCount === curBid.moves) {
      curBid.status = BID_STATUS.SUCCESS;
      this.roundWinner = {
        playerId: curBid.playerId,
        playerName: curBid.playerName,
        moves: curBid.moves,
      };

      // 累加獲勝者分數
      const winnerPlayer = this.players.get(curBid.playerId);
      if (winnerPlayer) winnerPlayer.score = (winnerPlayer.score || 0) + 1;

      this.phase = ROOM_PHASE.ROUND_END;
      return {
        success: true,
        moved: true,
        slide,
        goal,
        outcome: 'SUCCESS',
        phase: this.phase,
        winner: this.roundWinner,
      };
    }

    // 2. 超過下注步數判定：步數超過宣布量直接失敗
    if (moveCount > curBid.moves) {
      const handover = this._failCurrentDemonstrator('Exceeded declared moves');
      return {
        success: true,
        moved: true,
        slide,
        outcome: 'FAILED_EXCEEDED',
        handover,
      };
    }

    return {
      success: true,
      moved: true,
      slide,
      goal,
      moveCount,
      targetMoves: curBid.moves,
      outcome: 'CONTINUED',
    };
  }

  /**
   * 展示者放棄展示（點擊「放棄」或違規逾時）。
   * 機器人彈回起點，權限移交給次順位玩家。
   */
  forfeitDemonstration(playerId) {
    if (this.phase !== ROOM_PHASE.DEMONSTRATING) {
      return { success: false, reason: `Cannot forfeit in phase ${this.phase}` };
    }
    if (playerId !== this.activeDemonstratorId) {
      return { success: false, reason: 'Only the active demonstrator can forfeit' };
    }
    const handover = this._failCurrentDemonstrator('Demonstrator forfeited');
    return { success: true, handover };
  }

  /** 內部處理展示失敗並轉移權限 */
  _failCurrentDemonstrator(reason) {
    const curBid = this.getCurrentDemonstratorBid();
    if (curBid) curBid.status = BID_STATUS.FAILED;

    // 機器人全體彈回起點
    this.gameState.resetToInitial();

    // 尋找次順位玩家
    this.demonstrationIndex++;
    if (this.demonstrationIndex < this.bids.length) {
      const nextBid = this.bids[this.demonstrationIndex];
      nextBid.status = BID_STATUS.ACTIVE;
      this.activeDemonstratorId = nextBid.playerId;
      return {
        phase: ROOM_PHASE.DEMONSTRATING,
        hasMore: true,
        nextDemonstrator: { ...nextBid },
        reason,
      };
    }

    // 全員失敗
    this.phase = ROOM_PHASE.ROUND_END;
    this.activeDemonstratorId = null;
    this.roundWinner = null;
    return {
      phase: ROOM_PHASE.ROUND_END,
      hasMore: false,
      nextDemonstrator: null,
      reason: 'ALL_BIDDERS_FAILED',
    };
  }

  // ---------- 狀態快照 (廣播同步) ----------

  serialize() {
    return {
      phase: this.phase,
      round: this.round,
      target: this.target ? { ...this.target } : null,
      initialRobots: this.initialRobots ? cloneRobots(this.initialRobots) : null,
      currentRobots: this.gameState?.grid ? this.gameState.getRobots() : null,
      moveCount: this.gameState ? this.gameState.moveCount : 0,
      history: this.gameState ? [...this.gameState.history] : [],
      bids: this.bids.map((b) => ({ ...b })),
      countdownEnd: this.countdownEnd,
      countdownDuration: this.countdownDuration,
      activeDemonstratorId: this.activeDemonstratorId,
      demonstrationIndex: this.demonstrationIndex,
      roundWinner: this.roundWinner ? { ...this.roundWinner } : null,
      players: Array.from(this.players.values()),
    };
  }

  deserialize(snapshot, grid) {
    if (!snapshot) return;
    this.phase = snapshot.phase;
    this.round = snapshot.round || 1;
    this.target = snapshot.target ? { ...snapshot.target } : null;
    this.initialRobots = snapshot.initialRobots ? cloneRobots(snapshot.initialRobots) : null;
    this.countdownEnd = snapshot.countdownEnd;
    this.countdownDuration = snapshot.countdownDuration || 60;
    this.activeDemonstratorId = snapshot.activeDemonstratorId;
    this.demonstrationIndex = snapshot.demonstrationIndex || 0;
    this.roundWinner = snapshot.roundWinner ? { ...snapshot.roundWinner } : null;
    this.bids = (snapshot.bids || []).map((b) => ({ ...b }));

    if (snapshot.players) {
      this.players.clear();
      snapshot.players.forEach((p) => this.players.set(p.id, { ...p }));
    }

    if (grid && this.initialRobots && this.target) {
      this.grid = grid;
      this.gameState.initRound(grid, this.initialRobots, this.target);
      if (snapshot.currentRobots) {
        this.gameState.robots = cloneRobots(snapshot.currentRobots);
      }
      this.gameState.moveCount = snapshot.moveCount || 0;
      this.gameState.history = snapshot.history ? [...snapshot.history] : [];
    }
  }
}
