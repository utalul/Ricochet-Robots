/**
 * RoomState.js
 * 碰撞機器人多人連線房間狀態機（升級版：全員 2 分鐘同步競速模式＋17 題終局結算）。
 *
 * 房間三大階段：
 * 1. RACING: 全員 2 分鐘 (120 秒) 同步試走競賽期。
 *    - 各玩家在本地棋盤獨立試走，不受他人干擾。
 *    - 玩家達陣且符合轉向規則 (目標機器人移動次數 >= 2) 時，系統自動記錄並廣播個人最佳步數 (PB)。
 *    - 玩家可隨時復原 (Z) 或重回起點 (R) 繼續尋求更少步數更新 PB。
 *    - 即時排行榜維護：步數由少到多、時間由先到後排序。
 * 2. ROUND_END: 回合結算期。
 *    - 120 秒倒數結束或全員結算，全體棋盤鎖定。
 *    - 自動比對排行榜：步數最少者獲勝 (+1 分)；若有平手則共同獲勝（各得 1 分）。
 *    - 目標圓片自 17 片牌堆中移除；若流標（無人達陣）則洗回牌堆。
 *    - 等待開始下一題（機器人保留在當前位置作為新回合起點）。
 * 3. GAME_OVER: 終局頒獎期。
 *    - 17 片目標圓片全數被贏得後觸發，彈出頒獎終局視窗，展示總排名與冠軍（支援平手共享榮譽）。
 */
import { GameState } from '../core/GameState.js';
import { cloneRobots } from '../core/MovementEngine.js';

export const ROOM_PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  RACING: 'RACING',
  ROUND_END: 'ROUND_END',
  GAME_OVER: 'GAME_OVER',
  // 相容舊版常數
  THINKING: 'THINKING',
  COUNTDOWN: 'COUNTDOWN',
  DEMONSTRATING: 'DEMONSTRATING',
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
   * @param {number} [options.countdownDuration=120] 競賽倒數時長（預設 120 秒）
   */
  constructor({ countdownDuration = 120 } = {}) {
    this.phase = ROOM_PHASE.LOBBY;
    this.round = 1;
    this.grid = null;
    this.target = null;
    this.initialRobots = null;
    this.gameState = new GameState();

    /** 玩家字典：id -> { id, name, isHost, score } */
    this.players = new Map();

    /** 排行榜與解法清單：{ playerId, playerName, moves, timestamp, status, path, finalRobots } */
    this.bids = [];

    this.countdownDuration = countdownDuration;
    this.countdownEnd = null;

    /** 本回合獲勝名單 */
    this.roundWinner = null;
    this.roundWinners = [];
    this.isDraw = false;

    /** 17 題牌堆管理 */
    this.targetDeck = [];
    this.completedTargets = [];
    this.totalTargetsCount = 17;

    /** 是否啟用白色機器人變體 */
    this.useSilver = false;

    /** 舊版相容屬性 */
    this.activeDemonstratorId = null;
    this.demonstrationIndex = 0;
  }

  /** 設定 17 題完整目標牌堆 */
  setTargetDeck(targets) {
    if (Array.isArray(targets)) {
      this.targetDeck = targets.map((t) => ({ ...t }));
      this.totalTargetsCount = this.targetDeck.length || 17;
    }
    return this;
  }

  /**
   * 初始化 / 開始新回合。
   * 預設直接進入 RACING 階段（120 秒同步競速）。
   */
  startRound({
    grid,
    initialRobots,
    target,
    round,
    duration = 120,
    targetDeck = null,
    useSilver = false,
    phase = ROOM_PHASE.RACING,
  }) {
    if (!grid || !initialRobots || !target) {
      throw new Error('grid, initialRobots, and target are required to start a round');
    }
    this.grid = grid;
    this.initialRobots = cloneRobots(initialRobots);
    this.target = { ...target };
    this.useSilver = Boolean(useSilver || (initialRobots && initialRobots.silver));
    if (typeof round === 'number') this.round = round;
    if (Array.isArray(targetDeck)) this.targetDeck = [...targetDeck];

    this.gameState.initRound(this.grid, this.initialRobots, this.target);
    this.phase = phase;
    this.countdownDuration = duration;
    this.countdownEnd = phase === ROOM_PHASE.THINKING ? null : Date.now() + duration * 1000;

    this.bids = [];
    this.roundWinner = null;
    this.roundWinners = [];
    this.isDraw = false;
    this.activeDemonstratorId = null;
    this.demonstrationIndex = 0;
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

  // ---------- 解法回報與即時排行榜 (Personal Best) ----------

  /**
   * 取得排序後的排行榜。
   * 規則：
   * 1. 步數少者優先 (moves 升冪)
   * 2. 步數相同時，先達成者優先 (timestamp 升冪)
   */
  getLeaderboard() {
    return [...this.bids].sort((a, b) => {
      if (a.moves !== b.moves) return a.moves - b.moves;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * 回報玩家個人最佳步數 (PB)。
   * @param {string} playerId
   * @param {number} moves
   * @param {object} [extra]
   */
  reportSolution(
    playerId,
    moves,
    { timestamp = Date.now(), path = null, finalRobots = null } = {}
  ) {
    if (
      this.phase !== ROOM_PHASE.RACING &&
      this.phase !== ROOM_PHASE.COUNTDOWN &&
      this.phase !== ROOM_PHASE.THINKING
    ) {
      return { accepted: false, reason: `Cannot report solution in phase ${this.phase}` };
    }

    const m = Number(moves);
    if (!Number.isInteger(m) || m < 2) {
      return { accepted: false, reason: 'Moves must be an integer >= 2' };
    }

    const player = this.players.get(playerId);
    const playerName = player ? player.name : `Player_${String(playerId).slice(0, 4)}`;

    const existingIndex = this.bids.findIndex((b) => b.playerId === playerId);
    if (existingIndex >= 0) {
      const prev = this.bids[existingIndex];
      if (m >= prev.moves) {
        return {
          accepted: false,
          reason: `New solution (${m}) must be strictly fewer steps than previous PB (${prev.moves})`,
        };
      }
      this.bids[existingIndex] = {
        ...prev,
        moves: m,
        timestamp,
        path,
        finalRobots: finalRobots ? cloneRobots(finalRobots) : null,
        status: BID_STATUS.ACTIVE,
      };
    } else {
      this.bids.push({
        playerId,
        playerName,
        moves: m,
        timestamp,
        path,
        finalRobots: finalRobots ? cloneRobots(finalRobots) : null,
        status: BID_STATUS.ACTIVE,
      });
    }

    this.bids = this.getLeaderboard();

    let phaseChanged = false;
    if (this.phase === ROOM_PHASE.THINKING) {
      this.phase = ROOM_PHASE.COUNTDOWN;
      this.countdownEnd = timestamp + this.countdownDuration * 1000;
      phaseChanged = true;
    }

    return {
      accepted: true,
      isPB: true,
      moves: m,
      phaseChanged,
      phase: this.phase,
      countdownEnd: this.countdownEnd,
      leaderboard: this.getLeaderboard(),
    };
  }

  /** 相容舊版下注介面 */
  submitBid(playerId, moves, timestamp = Date.now()) {
    return this.reportSolution(playerId, moves, { timestamp });
  }

  // ---------- 回合結算與 17 題終局判定 ----------

  /**
   * 結算本回合：
   * 1. 若有解法：步數最少者獲勝 (+1 分)；平手者均獲得 1 分。
   *    目標圓片自剩餘牌堆移除。若 17 題全達成，轉入 GAME_OVER。
   * 2. 若無解法 (流標)：目標圓片洗回牌堆，轉入 ROUND_END。
   */
  endRound() {
    if (this.phase === ROOM_PHASE.ROUND_END || this.phase === ROOM_PHASE.GAME_OVER) {
      return { success: false, reason: `Round already ended in phase ${this.phase}` };
    }

    this.bids = this.getLeaderboard();

    if (this.bids.length > 0) {
      const minMoves = this.bids[0].moves;
      const winners = this.bids.filter((b) => b.moves === minMoves);
      this.roundWinners = winners;
      this.roundWinner = winners[0];
      this.isDraw = false;

      // 各獲勝者 +1 分
      for (const w of winners) {
        w.status = BID_STATUS.SUCCESS;
        const player = this.players.get(w.playerId);
        if (player) {
          player.score = (player.score || 0) + 1;
        }
      }

      // 目標圓片已贏得，記錄並從牌堆中移除
      if (this.target) {
        this.completedTargets.push({ ...this.target });
      }
      if (this.targetDeck && this.targetDeck.length > 0 && this.target) {
        const idx = this.targetDeck.findIndex(
          (t) => t.x === this.target.x && t.y === this.target.y
        );
        if (idx >= 0) this.targetDeck.splice(idx, 1);
      }

      // 檢查是否 17 題全部達成
      const isGameOver =
        (this.targetDeck && this.targetDeck.length === 0) ||
        this.completedTargets.length >= this.totalTargetsCount;

      this.phase = isGameOver ? ROOM_PHASE.GAME_OVER : ROOM_PHASE.ROUND_END;

      return {
        success: true,
        phase: this.phase,
        winners,
        minMoves,
        isDraw: false,
        gameOver: isGameOver,
        completedCount: this.completedTargets.length,
        remainingCount: this.targetDeck ? this.targetDeck.length : 0,
      };
    }

    // 流標處理：目標圓片洗回剩餘牌堆
    this.isDraw = true;
    this.roundWinners = [];
    this.roundWinner = null;

    if (this.target && this.targetDeck) {
      const alreadyIn = this.targetDeck.some(
        (t) => t.x === this.target.x && t.y === this.target.y
      );
      if (!alreadyIn) {
        this.targetDeck.push({ ...this.target });
      }
    }

    this.phase = ROOM_PHASE.ROUND_END;
    return {
      success: true,
      phase: this.phase,
      winners: [],
      minMoves: null,
      isDraw: true,
      gameOver: false,
      completedCount: this.completedTargets.length,
      remainingCount: this.targetDeck ? this.targetDeck.length : 0,
    };
  }

  /** 相容舊版 endCountdown */
  endCountdown() {
    if (this.phase === ROOM_PHASE.RACING) {
      return this.endRound();
    }
    if (this.phase === ROOM_PHASE.COUNTDOWN) {
      // 若為舊版沙漏倒數，且無展示者設定，亦可支援 endRound
      if (this.bids.length === 0) {
        return this.endRound();
      }
      // 舊版 DEMONSTRATING
      this.phase = ROOM_PHASE.DEMONSTRATING;
      this.demonstrationIndex = 0;
      const topBid = this.bids[0];
      topBid.status = BID_STATUS.ACTIVE;
      this.activeDemonstratorId = topBid.playerId;
      this.gameState.resetToInitial();
      return {
        success: true,
        phase: this.phase,
        demonstrator: { ...topBid },
      };
    }
    return this.endRound();
  }

  /**
   * 終局頒獎榜單：
   * 依總分由高至低排名，若最高分有多人則 isTie = true（共同獲勝）。
   */
  getPodium() {
    const list = Array.from(this.players.values());
    const rankings = [...list].sort((a, b) => (b.score || 0) - (a.score || 0));
    const topScore = rankings.length > 0 ? rankings[0].score || 0 : 0;
    const champions = topScore > 0 ? rankings.filter((p) => (p.score || 0) === topScore) : [];
    const isTie = champions.length > 1;

    return {
      rankings,
      champions,
      topScore,
      isTie,
      totalCompleted: this.completedTargets.length,
    };
  }

  /** 重新開始新的一局（重設所有玩家得分與 17 題牌堆） */
  restartGame(allTargets = null) {
    for (const p of this.players.values()) {
      p.score = 0;
    }
    this.completedTargets = [];
    if (Array.isArray(allTargets)) {
      this.targetDeck = allTargets.map((t) => ({ ...t }));
      this.totalTargetsCount = this.targetDeck.length || 17;
    }
    this.round = 1;
    this.roundWinner = null;
    this.roundWinners = [];
    this.isDraw = false;
    this.phase = ROOM_PHASE.RACING;
    return this;
  }

  // ---------- 舊版獨占操作鎖相容介面 ----------

  getCurrentDemonstratorBid() {
    if (this.phase !== ROOM_PHASE.DEMONSTRATING || !this.activeDemonstratorId) return null;
    return (
      this.bids.find(
        (b) => b.playerId === this.activeDemonstratorId && b.status === BID_STATUS.ACTIVE
      ) || null
    );
  }

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

    if (goal.success && moveCount === curBid.moves) {
      curBid.status = BID_STATUS.SUCCESS;
      this.roundWinner = {
        playerId: curBid.playerId,
        playerName: curBid.playerName,
        moves: curBid.moves,
      };
      this.roundWinners = [this.roundWinner];

      const winnerPlayer = this.players.get(curBid.playerId);
      if (winnerPlayer) winnerPlayer.score = (winnerPlayer.score || 0) + 1;

      if (this.target) this.completedTargets.push({ ...this.target });
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

  _failCurrentDemonstrator(reason) {
    const curBid = this.getCurrentDemonstratorBid();
    if (curBid) curBid.status = BID_STATUS.FAILED;

    this.gameState.resetToInitial();
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

    this.phase = ROOM_PHASE.ROUND_END;
    this.activeDemonstratorId = null;
    this.roundWinner = null;
    this.roundWinners = [];
    return {
      phase: ROOM_PHASE.ROUND_END,
      hasMore: false,
      nextDemonstrator: null,
      reason: 'ALL_BIDDERS_FAILED',
    };
  }

  // ---------- 狀態快照序列化與反序列化 ----------

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
      roundWinners: this.roundWinners.map((w) => ({ ...w })),
      isDraw: this.isDraw,
      useSilver: this.useSilver,
      completedTargetsCount: this.completedTargets.length,
      remainingTargetsCount: this.targetDeck ? this.targetDeck.length : 0,
      totalTargetsCount: this.totalTargetsCount,
      players: Array.from(this.players.values()),
    };
  }

  deserialize(snapshot, grid) {
    if (!snapshot) return;
    this.phase = snapshot.phase;
    this.round = snapshot.round || 1;
    this.target = snapshot.target ? { ...snapshot.target } : null;
    this.initialRobots = snapshot.initialRobots ? cloneRobots(snapshot.initialRobots) : null;
    this.useSilver = Boolean(snapshot.useSilver || (snapshot.initialRobots && snapshot.initialRobots.silver));
    this.countdownEnd = snapshot.countdownEnd;
    this.countdownDuration = snapshot.countdownDuration || 120;
    this.activeDemonstratorId = snapshot.activeDemonstratorId;
    this.demonstrationIndex = snapshot.demonstrationIndex || 0;
    this.roundWinner = snapshot.roundWinner ? { ...snapshot.roundWinner } : null;
    this.roundWinners = Array.isArray(snapshot.roundWinners)
      ? snapshot.roundWinners.map((w) => ({ ...w }))
      : this.roundWinner
      ? [this.roundWinner]
      : [];
    this.isDraw = Boolean(snapshot.isDraw);
    this.bids = (snapshot.bids || []).map((b) => ({ ...b }));
    this.totalTargetsCount = snapshot.totalTargetsCount || 17;

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
