/**
 * main.js
 * 整合單機練習模式與多人連線模式（至多 100 人即時競標與展示）。
 */
import { assembleBigBoard, collectTargets } from './core/BoardAssembler.js';
import { GameState, GOAL_REASON, isVortexTarget } from './core/GameState.js';
import {
  pickQuadrantBoards,
  randomRobotPositions,
  createTargetDeck,
  drawTarget,
} from './core/RoundFactory.js';
import { ROBOT_COLORS } from './core/constants.js';
import { BoardRenderer, createTargetIcon } from './ui/BoardRenderer.js';
import { InputController } from './ui/InputController.js';
import { RoomManager, MSG_TYPE } from './network/RoomManager.js';
import { RoomState, ROOM_PHASE, BID_STATUS } from './network/RoomState.js';
import { MultiplayerHUD } from './ui/MultiplayerHUD.js';

const DATA_URL = new URL('./data/boards.json', import.meta.url);
const FALLBACK_DATA_URL = new URL('./data/sample_boards.json', import.meta.url);

const COLOR_NAMES = Object.freeze({
  red: '紅色',
  blue: '藍色',
  yellow: '黃色',
  green: '綠色',
  multi: '彩色',
  vortex: '彩色',
});

const ROBOT_NAMES = Object.freeze({
  red: '紅',
  blue: '藍',
  yellow: '黃',
  green: '綠',
});

const SHAPE_NAMES = Object.freeze({
  star: '星星',
  moon: '月亮',
  planet: '行星',
  gear: '齒輪',
  vortex: '漩渦',
});

const DIR_NAMES = Object.freeze({
  up: '▲ 上',
  down: '▼ 下',
  left: '◀ 左',
  right: '▶ 右',
});

// ---------- DOM 參照 ----------
const elBoard = document.getElementById('board');
const elTargetIcon = document.getElementById('target-icon');
const elTargetText = document.getElementById('target-text');
const elMoveCount = document.getElementById('move-count');
const elSolvedCount = document.getElementById('solved-count');
const elHistory = document.getElementById('history');
const elBtnUndo = document.getElementById('btn-undo');
const elBtnReset = document.getElementById('btn-reset');
const elToast = document.getElementById('toast');
const elModal = document.getElementById('modal');
const elModalTitle = document.getElementById('modal-title');
const elModalDetail = document.getElementById('modal-detail');
const elModalNext = document.getElementById('modal-next');
const elMpContainer = document.getElementById('mp-container');
const robotButtons = Array.from(document.querySelectorAll('.robot-btn'));

// ---------- 全域狀態 ----------
let currentMode = 'solo'; // 'solo' | 'multi'

// 單機狀態
const soloGameState = new GameState();
let allBoards = [];
let currentGrid = null;
let currentQuadBoards = [];
let targetDeck = [];
let currentTarget = null;
let selectedRobot = 'red';
let solvedCount = 0;
let isVictory = false;
let toastTimer = null;

// 多人連線狀態
const roomManager = new RoomManager();
const roomState = new RoomState({ countdownDuration: 60 });
let mpHUD = null;

// UI 模組
let renderer = null;
let inputController = null;

// ---------- UI 輔助函式 ----------

function showToast(message, type = 'info', durationMs = 2600) {
  if (!elToast) return;
  clearTimeout(toastTimer);
  elToast.textContent = message;
  elToast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => {
    elToast.classList.remove('show');
  }, durationMs);
}

function showModal(title, detailHtml) {
  if (!elModal) return;
  elModalTitle.textContent = title;
  elModalDetail.innerHTML = detailHtml;
  elModal.removeAttribute('hidden');
  isVictory = true;
  elModalNext?.focus();
}

function hideModal() {
  if (!elModal) return;
  elModal.setAttribute('hidden', '');
  isVictory = false;
}

function getTargetDescription(target) {
  if (!target) return '無目標';
  if (isVortexTarget(target)) {
    return '請將 <strong class="hl" style="color:#ba68c8">【任意機器人】</strong> 移動至 <strong class="hl" style="color:#ba68c8">【彩色漩渦】</strong>';
  }
  const colorName = COLOR_NAMES[target.color] ?? target.color;
  const shapeName = SHAPE_NAMES[target.shape] ?? target.shape;
  return `請將 <strong class="hl">${colorName}機器人</strong> 移動至 <strong class="hl">${colorName}${shapeName}</strong>`;
}

/** 刷新單機面板資訊 */
function updateHUD() {
  const activeGame = currentMode === 'multi' && mpHUD?.inRoom ? roomState.gameState : soloGameState;
  if (!activeGame || !activeGame.grid) return;

  if (elMoveCount) elMoveCount.textContent = String(activeGame.moveCount);
  if (elSolvedCount) elSolvedCount.textContent = String(solvedCount);

  // Undo / Reset 按鈕狀態 (多人模式展示中僅能由展示者重回起點)
  const canUndo = activeGame.history.length > 0 && currentMode === 'solo';
  const canReset = activeGame.history.length > 0 && currentMode === 'solo';
  if (elBtnUndo) elBtnUndo.disabled = !canUndo;
  if (elBtnReset) elBtnReset.disabled = !canReset;

  // 機器人選取按鈕外觀與步數計數
  robotButtons.forEach((btn) => {
    const c = btn.dataset.select;
    const isSel = c === selectedRobot;
    btn.setAttribute('aria-pressed', String(isSel));
    const countEl = btn.querySelector('.count');
    if (countEl) countEl.textContent = String(activeGame.countMovesOf(c));
  });

  // 移動歷史列表
  if (elHistory) {
    if (activeGame.history.length === 0) {
      elHistory.innerHTML = '<li class="empty">尚未移動</li>';
    } else {
      elHistory.innerHTML = '';
      activeGame.history.forEach((h) => {
        const li = document.createElement('li');
        const robotName = ROBOT_NAMES[h.color] ?? h.color;
        const dirName = DIR_NAMES[h.direction] ?? h.direction;
        li.innerHTML = `<span class="dot sm ${h.color}"></span> ${robotName} ${dirName}`;
        elHistory.appendChild(li);
      });
      elHistory.scrollTop = elHistory.scrollHeight;
    }
  }
}

/** 切換選取的機器人 */
function selectRobot(color) {
  if (!ROBOT_COLORS.includes(color)) return;
  selectedRobot = color;
  const activeGame = currentMode === 'multi' && mpHUD?.inRoom ? roomState.gameState : soloGameState;
  if (activeGame?.grid) {
    renderer?.renderRobots(activeGame.getRobots(), selectedRobot, { animate: false });
  }
  updateHUD();
}

// ---------- 核心移動處理 (支援單機與多人 Mutex Lock) ----------

function handleMove(direction) {
  if (isVictory) return;
  if (!selectedRobot) selectedRobot = 'red';

  // 多人連線模式
  if (currentMode === 'multi' && mpHUD?.inRoom) {
    // 檢查是否處於展示階段
    if (roomState.phase !== ROOM_PHASE.DEMONSTRATING) {
      if (roomState.phase === ROOM_PHASE.THINKING || roomState.phase === ROOM_PHASE.COUNTDOWN) {
        showToast('💡 思考／競標中，棋盤已鎖定不可操作！請輸入步數下注', 'warn', 2000);
      }
      renderer.bump(selectedRobot, direction);
      return;
    }

    // 檢查是否為當前獨占展示者 (Mutex Lock)
    if (roomState.activeDemonstratorId !== roomManager.userId) {
      const curBid = roomState.getCurrentDemonstratorBid();
      const demoName = curBid ? curBid.playerName : '其他玩家';
      showToast(`👀 觀戰中：現由【${demoName}】獨占展示，棋盤已鎖定`, 'info', 2000);
      renderer.bump(selectedRobot, direction);
      return;
    }

    // 當前展示者執行移動
    const res = roomState.applyDemonstratorMove(roomManager.userId, selectedRobot, direction);
    if (!res.success) {
      showToast(res.reason, 'warn');
      return;
    }

    if (res.moved) {
      // 廣播移動給所有觀戰者
      roomManager.sendMove(selectedRobot, direction);
      renderer.drawTrail(selectedRobot, res.slide.path);
      renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
      updateHUD();

      const curBid = roomState.getCurrentDemonstratorBid();
      mpHUD.updateDemonstratorBanner({
        isDemonstrator: true,
        demonstratorName: roomManager.userName,
        targetMoves: curBid ? curBid.moves : 0,
        currentMoves: roomState.gameState.moveCount,
      });

      if (res.outcome === 'SUCCESS') {
        renderer.celebrate(roomState.target.x, roomState.target.y);
        showModal('🎉 成功達陣！', `您以剛好 <strong>${curBid.moves}</strong> 步達成目標！獲得 1 點積分！`);
        mpHUD.updatePhase(ROOM_PHASE.ROUND_END);
        mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
        mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
      } else if (res.outcome === 'FAILED_EXCEEDED') {
        showToast('⚠️ 步數超過宣告值！展示失敗，操作權轉移給次順位玩家', 'warn', 3500);
        renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
        updateHUD();
        mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
        updateDemonstratorState();
      }
    } else {
      renderer.bump(selectedRobot, direction);
    }
    return;
  }

  // 單機模式
  const slide = soloGameState.applyMove(selectedRobot, direction);
  if (slide.moved) {
    renderer.drawTrail(selectedRobot, slide.path);
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();

    const check = soloGameState.checkGoalReached();
    if (check.success) {
      solvedCount++;
      updateHUD();
      renderer.celebrate(currentTarget.x, currentTarget.y);
      const robotName = COLOR_NAMES[check.robot] ?? check.robot;
      const detail = `花費 <strong>${soloGameState.moveCount}</strong> 步完成目標！<br>（${robotName}機器人移動 ${check.robotMoves} 次符合轉向規範）`;
      showModal('🎉 成功達陣！', detail);
    } else if (check.reason === GOAL_REASON.NO_RICOCHET) {
      showToast('⚠️ 未轉向：抵達目標的機器人本身必須至少移動 2 次！', 'warn', 3000);
    } else if (check.reason === GOAL_REASON.WRONG_COLOR) {
      const curRobot = COLOR_NAMES[check.robot] ?? check.robot;
      const targetColor = COLOR_NAMES[currentTarget.color] ?? currentTarget.color;
      showToast(`⚠️ 目標要求【${targetColor}】，目前格上是【${curRobot}】機器人`, 'warn', 2500);
    }
  } else {
    renderer.bump(selectedRobot, direction);
  }
}

/** 復原最後一步 (單機專屬) */
function handleUndo() {
  if (currentMode === 'multi') return;
  if (soloGameState.history.length === 0) {
    showToast('已在起點，無法復原', 'info');
    return;
  }
  const undone = soloGameState.undo();
  if (undone) {
    hideModal();
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();
  }
}

/** 重設回合（機器人回到起點） */
function handleReset() {
  if (currentMode === 'multi') {
    if (roomState.phase === ROOM_PHASE.DEMONSTRATING && roomState.activeDemonstratorId === roomManager.userId) {
      roomState.gameState.resetToInitial();
      roomManager.send('DEMO_RESET', {});
      renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
      updateHUD();
      const curBid = roomState.getCurrentDemonstratorBid();
      mpHUD.updateDemonstratorBanner({
        isDemonstrator: true,
        demonstratorName: roomManager.userName,
        targetMoves: curBid ? curBid.moves : 0,
        currentMoves: 0,
      });
      showToast('展示重設：機器人已回起點，可重新嘗試', 'info');
    }
    return;
  }

  if (soloGameState.history.length === 0 && !isVictory) {
    showToast('目前已在初始位置', 'info');
    return;
  }
  hideModal();
  soloGameState.resetToInitial();
  renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
  updateHUD();
  showToast('本回合已重設至起點', 'info');
}

/** 下一題目（機器人留在原處，換新目標） */
function handleNextRound() {
  hideModal();

  if (currentMode === 'multi') {
    if (!roomManager.isHost) {
      showToast('只有房主可以開啟下一輪', 'info');
      return;
    }
    // 房主啟動下一輪
    startMultiplayerRound();
    return;
  }

  // 單機模式
  if (targetDeck.length === 0) {
    const targets = collectTargets(currentGrid);
    targetDeck = createTargetDeck(targets);
    showToast('所有目標皆已完成，牌堆已重新洗牌！', 'info');
  }

  const nextTarget = drawTarget(targetDeck, soloGameState.getRobots());
  if (!nextTarget) {
    showToast('無可用目標', 'warn');
    return;
  }
  currentTarget = nextTarget;
  soloGameState.initRound(currentGrid, soloGameState.getRobots(), currentTarget);

  if (elTargetIcon) {
    elTargetIcon.innerHTML = '';
    elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
  }
  if (elTargetText) {
    elTargetText.innerHTML = getTargetDescription(currentTarget);
  }

  renderer.setTarget(currentTarget);
  renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });
  updateHUD();
}

/** 重新洗牌開新局（重新拼裝版圖與機器人位置） */
function handleNewGame() {
  hideModal();
  try {
    currentQuadBoards = pickQuadrantBoards(allBoards);
    currentGrid = assembleBigBoard(...currentQuadBoards);
    const targets = collectTargets(currentGrid);
    targetDeck = createTargetDeck(targets);
    const initialRobots = randomRobotPositions(currentGrid);
    currentTarget = drawTarget(targetDeck, initialRobots);

    soloGameState.initRound(currentGrid, initialRobots, currentTarget);

    renderer.setBoard(currentGrid);
    renderer.setTarget(currentTarget);
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });

    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(currentTarget);
    }

    updateHUD();
    showToast('全新地圖與目標已生成！', 'success');
  } catch (err) {
    console.error('新開局失敗:', err);
    showToast('開局失敗：' + err.message, 'warn');
  }
}

// ---------- 多人連線核心邏輯 ----------

function setupMultiplayerNetwork() {
  // 1. 玩家加入
  roomManager.on(MSG_TYPE.PLAYER_JOIN, ({ payload }) => {
    roomState.addPlayer(payload.player);
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    showToast(`👋 玩家【${payload.player.name}】加入了房間！`, 'info', 2000);

    // 房主主動發送當前全狀態同步
    if (roomManager.isHost) {
      const quadIds = currentQuadBoards.map((b) => b.board_id);
      roomManager.sendSyncResponse(payload.player.id, {
        snapshot: roomState.serialize(),
        quadBoardIds: quadIds,
      });
    }
  });

  // 2. 玩家離開
  roomManager.on(MSG_TYPE.PLAYER_LEAVE, ({ payload }) => {
    const p = roomState.getPlayer(payload.playerId);
    const pName = p ? p.name : '玩家';
    roomState.removePlayer(payload.playerId);
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    showToast(`🚪 玩家【${pName}】離開了房間`, 'info', 2000);
    updateDemonstratorState();
  });

  // 3. 狀態請求與同步
  roomManager.on(MSG_TYPE.SYNC_REQUEST, ({ payload }) => {
    if (roomManager.isHost) {
      const quadIds = currentQuadBoards.map((b) => b.board_id);
      roomManager.sendSyncResponse(payload.requesterId, {
        snapshot: roomState.serialize(),
        quadBoardIds: quadIds,
      });
    }
  });

  roomManager.on(MSG_TYPE.SYNC_RESPONSE, ({ payload }) => {
    // 僅接收給自己的同步回應
    if (payload.targetPlayerId && payload.targetPlayerId !== roomManager.userId) return;

    if (payload.snapshot) {
      // 根據版圖 ID 拼裝同一張地圖
      if (payload.quadBoardIds && payload.quadBoardIds.length === 4) {
        currentQuadBoards = payload.quadBoardIds.map((id) => allBoards.find((b) => b.board_id === id) || allBoards[0]);
        currentGrid = assembleBigBoard(...currentQuadBoards);
        renderer.setBoard(currentGrid);
      }

      roomState.deserialize(payload.snapshot, currentGrid);
      currentTarget = roomState.target;

      if (currentTarget) {
        renderer.setTarget(currentTarget);
        if (elTargetIcon) {
          elTargetIcon.innerHTML = '';
          elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
        }
        if (elTargetText) {
          elTargetText.innerHTML = getTargetDescription(currentTarget);
        }
      }

      if (roomState.gameState?.robots) {
        renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: false });
      }

      mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
      mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
      mpHUD.updatePhase(roomState.phase, {
        countdownEnd: roomState.countdownEnd,
        countdownDuration: roomState.countdownDuration,
      });

      updateDemonstratorState();
      updateHUD();
      showToast('已同步房主最新遊戲狀態！', 'success');
    }
  });

  // 4. 新回合開局
  roomManager.on(MSG_TYPE.NEW_ROUND, ({ payload }) => {
    if (payload.quadBoardIds && payload.quadBoardIds.length === 4) {
      currentQuadBoards = payload.quadBoardIds.map((id) => allBoards.find((b) => b.board_id === id) || allBoards[0]);
      currentGrid = assembleBigBoard(...currentQuadBoards);
      renderer.setBoard(currentGrid);
    }

    currentTarget = payload.target;
    roomState.startRound({
      grid: currentGrid,
      initialRobots: payload.initialRobots,
      target: payload.target,
      round: payload.round,
    });

    renderer.setTarget(currentTarget);
    renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: false });

    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(currentTarget);
    }

    hideModal();
    mpHUD.updatePhase(ROOM_PHASE.THINKING);
    mpHUD.updateLeaderboard([], null);
    updateHUD();
    showToast(`🔔 第 ${payload.round} 回合開始！請觀察路線並下注`, 'info', 3000);
  });

  // 5. 下注競標廣播
  roomManager.on(MSG_TYPE.BID, ({ payload }) => {
    const res = roomState.submitBid(payload.playerId, payload.moves, payload.timestamp);
    if (res.accepted) {
      mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);

      if (res.phaseChanged) {
        mpHUD.updatePhase(ROOM_PHASE.COUNTDOWN, {
          countdownEnd: roomState.countdownEnd,
          countdownDuration: roomState.countdownDuration,
        });
        showToast(`⏳【${payload.playerName}】率先喊出 ${payload.moves} 步！60 秒沙漏倒數開始！`, 'info', 3500);
      } else {
        showToast(`📢【${payload.playerName}】下注了 ${payload.moves} 步！`, 'info', 1800);
      }
    }
  });

  // 6. 倒數計時與結束
  roomManager.on(MSG_TYPE.COUNTDOWN_START, ({ payload }) => {
    roomState.phase = ROOM_PHASE.COUNTDOWN;
    roomState.countdownEnd = payload.countdownEnd;
    mpHUD.updatePhase(ROOM_PHASE.COUNTDOWN, {
      countdownEnd: payload.countdownEnd,
      durationSec: payload.durationSec,
    });
  });

  roomManager.on(MSG_TYPE.COUNTDOWN_END, () => {
    startDemonstratingPhase();
  });

  // 7. 展示者移動同步
  roomManager.on(MSG_TYPE.DEMO_MOVE, ({ payload }) => {
    const res = roomState.applyDemonstratorMove(payload.playerId, payload.robotColor, payload.direction);
    if (res.success && res.moved) {
      renderer.drawTrail(payload.robotColor, res.slide.path);
      renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
      updateHUD();

      const curBid = roomState.getCurrentDemonstratorBid();
      mpHUD.updateDemonstratorBanner({
        isDemonstrator: roomState.activeDemonstratorId === roomManager.userId,
        demonstratorName: curBid ? curBid.playerName : '展示者',
        targetMoves: curBid ? curBid.moves : 0,
        currentMoves: roomState.gameState.moveCount,
      });

      if (res.outcome === 'SUCCESS') {
        renderer.celebrate(roomState.target.x, roomState.target.y);
        const winPlayer = roomState.getPlayer(res.winner.playerId);
        const winName = winPlayer ? winPlayer.name : '玩家';
        showModal('🏆 回合結算！', `【${winName}】以 <strong>${res.winner.moves}</strong> 步成功達陣！`);
        mpHUD.updatePhase(ROOM_PHASE.ROUND_END);
        mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
        mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
      } else if (res.outcome === 'FAILED_EXCEEDED') {
        showToast(`⚠️【${curBid?.playerName}】步數超過宣告值展示失敗，操作權轉移！`, 'warn', 3000);
        renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
        updateHUD();
        mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
        updateDemonstratorState();
      }
    }
  });

  // 8. 展示者放棄 / 重設
  roomManager.on(MSG_TYPE.DEMO_FORFEIT, ({ payload }) => {
    const curBid = roomState.getCurrentDemonstratorBid();
    const curName = curBid ? curBid.playerName : '展示者';
    roomState.forfeitDemonstration(payload.playerId);
    renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();
    mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
    showToast(`【${curName}】放棄展示，操作權轉移給次順位玩家！`, 'info', 2500);
    updateDemonstratorState();
  });

  roomManager.on('DEMO_RESET', () => {
    roomState.gameState.resetToInitial();
    renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();
    const curBid = roomState.getCurrentDemonstratorBid();
    mpHUD.updateDemonstratorBanner({
      isDemonstrator: roomState.activeDemonstratorId === roomManager.userId,
      demonstratorName: curBid ? curBid.playerName : '展示者',
      targetMoves: curBid ? curBid.moves : 0,
      currentMoves: 0,
    });
  });
}

/** 房主開新回合 */
function startMultiplayerRound() {
  if (!roomManager.isHost) return;

  currentQuadBoards = pickQuadrantBoards(allBoards);
  currentGrid = assembleBigBoard(...currentQuadBoards);
  renderer.setBoard(currentGrid);

  const targets = collectTargets(currentGrid);
  targetDeck = createTargetDeck(targets);
  const initialRobots = randomRobotPositions(currentGrid);
  currentTarget = drawTarget(targetDeck, initialRobots);

  const roundNum = (roomState.round || 0) + 1;
  roomState.startRound({
    grid: currentGrid,
    initialRobots,
    target: currentTarget,
    round: roundNum,
  });

  renderer.setTarget(currentTarget);
  renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: false });

  if (elTargetIcon) {
    elTargetIcon.innerHTML = '';
    elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
  }
  if (elTargetText) {
    elTargetText.innerHTML = getTargetDescription(currentTarget);
  }

  hideModal();
  mpHUD.updatePhase(ROOM_PHASE.THINKING);
  mpHUD.updateLeaderboard([], null);
  updateHUD();

  // 廣播給房間內所有人
  roomManager.sendNewRound({
    round: roundNum,
    quadBoardIds: currentQuadBoards.map((b) => b.board_id),
    initialRobots,
    target: currentTarget,
  });

  showToast(`🔔 第 ${roundNum} 回合已開始！自由思考中`, 'info', 3000);
}

/** 倒數結束切換至展示階段 */
function startDemonstratingPhase() {
  const res = roomState.endCountdown();
  if (res.success) {
    mpHUD.updatePhase(roomState.phase);
    mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
    renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();

    if (res.demonstrator) {
      updateDemonstratorState();
      const isMe = res.demonstrator.playerId === roomManager.userId;
      if (isMe) {
        showToast(`🎯 您以 ${res.demonstrator.moves} 步獲得展示權！請開始移動`, 'success', 3500);
      } else {
        showToast(`👀 由【${res.demonstrator.playerName}】以 ${res.demonstrator.moves} 步取得展示權`, 'info', 3000);
      }
    } else {
      showToast('本回合無人下注，回合結束！', 'info');
    }
  }
}

/** 刷新展示者狀態與 Banner */
function updateDemonstratorState() {
  if (roomState.phase !== ROOM_PHASE.DEMONSTRATING) {
    if (roomState.phase === ROOM_PHASE.ROUND_END && !roomState.roundWinner) {
      showToast('🏁 所有下注者皆已展示完畢，無人得標！', 'info');
      mpHUD.updatePhase(ROOM_PHASE.ROUND_END);
    }
    return;
  }

  const curBid = roomState.getCurrentDemonstratorBid();
  if (!curBid) {
    roomState.phase = ROOM_PHASE.ROUND_END;
    mpHUD.updatePhase(ROOM_PHASE.ROUND_END);
    showToast('🏁 全員失敗，無人得標！', 'info');
    return;
  }

  const isMe = curBid.playerId === roomManager.userId;
  mpHUD.updateDemonstratorBanner({
    isDemonstrator: isMe,
    demonstratorName: curBid.playerName,
    targetMoves: curBid.moves,
    currentMoves: roomState.gameState.moveCount,
  });

  if (isMe) {
    showToast(`🎯 輪到您展示！目標在 ${curBid.moves} 步內達陣`, 'success', 3000);
  } else {
    showToast(`👀 轉移展示權：現由【${curBid.playerName}】展示（${curBid.moves} 步）`, 'info', 2500);
  }
}

// ---------- 初始化主程序 ----------

async function init() {
  try {
    renderer = new BoardRenderer(elBoard);

    // 載入子版圖資料
    let res = await fetch(DATA_URL).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch(FALLBACK_DATA_URL);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allBoards = data.boards;

    // 實例化多人 HUD
    mpHUD = new MultiplayerHUD({
      container: elMpContainer,
      handlers: {
        modeChanged: (mode) => {
          currentMode = mode;
          hideModal();
          if (mode === 'solo') {
            // 切回單機模式
            renderer.setBoard(currentGrid);
            renderer.setTarget(currentTarget);
            renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });
            updateHUD();
          } else {
            // 多人模式：若已在房則呈現多人遊戲狀態
            if (mpHUD.inRoom && roomState.grid) {
              renderer.setBoard(roomState.grid);
              renderer.setTarget(roomState.target);
              renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: false });
            }
          }
        },
        createRoom: async ({ roomId, userName }) => {
          try {
            const info = await roomManager.createRoom(roomId, userName);
            roomState.addPlayer({ id: info.userId, name: info.userName, isHost: true });
            mpHUD.setInRoom(true, info);
            mpHUD.updatePlayers(roomState.getPlayerList(), true);
            showToast(`房間【${roomId}】建立成功！您是房主 👑`, 'success');

            // 房主立即初始化第一輪
            startMultiplayerRound();
          } catch (err) {
            console.error('建立房間失敗:', err);
            showToast('建立房間失敗：' + err.message, 'warn');
          }
        },
        joinRoom: async ({ roomId, userName }) => {
          try {
            const info = await roomManager.joinRoom(roomId, userName);
            roomState.addPlayer({ id: info.userId, name: info.userName, isHost: false });
            mpHUD.setInRoom(true, info);
            mpHUD.updatePlayers(roomState.getPlayerList(), false);
            showToast(`成功加入房間【${roomId}】！正在同步遊戲資料…`, 'success');
          } catch (err) {
            console.error('加入房間失敗:', err);
            showToast('加入房間失敗：' + err.message, 'warn');
          }
        },
        leaveRoom: async () => {
          await roomManager.leaveRoom();
          mpHUD.setInRoom(false);
          showToast('已離開房間', 'info');
        },
        submitBid: (moves) => {
          const bidRes = roomState.submitBid(roomManager.userId, moves, Date.now());
          if (bidRes.accepted) {
            roomManager.sendBid(moves);
            mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);

            if (bidRes.phaseChanged) {
              roomManager.sendCountdownStart(roomState.countdownEnd);
              mpHUD.updatePhase(ROOM_PHASE.COUNTDOWN, {
                countdownEnd: roomState.countdownEnd,
                countdownDuration: roomState.countdownDuration,
              });
              showToast(`⏳ 您率先下注 ${moves} 步！60 秒倒數已啟動！`, 'success', 3000);
            } else {
              showToast(`下注成功：${moves} 步`, 'info');
            }
          } else {
            showToast('下注無效：' + bidRes.reason, 'warn');
          }
        },
        countdownExpired: () => {
          if (roomManager.isHost) {
            roomManager.sendCountdownEnd();
            startDemonstratingPhase();
          }
        },
        forfeit: () => {
          roomState.forfeitDemonstration(roomManager.userId);
          roomManager.forfeit();
          renderer.renderRobots(roomState.gameState.getRobots(), selectedRobot, { animate: true });
          updateHUD();
          mpHUD.updateLeaderboard(roomState.getLeaderboard(), roomState.activeDemonstratorId);
          showToast('您已放棄展示，操作權轉移給次順位玩家', 'info');
          updateDemonstratorState();
        },
        resetDemo: () => {
          handleReset();
        },
        nextRound: () => {
          startMultiplayerRound();
        },
        settingsChanged: async ({ url, key }) => {
          try {
            await roomManager.reconfigure();
            const modeName = roomManager.mode;
            if (url && key) {
              showToast(`已成功套用 Supabase 設定！切換為：${modeName}`, 'success', 3500);
            } else {
              showToast(`已還原為本地雙分頁模擬：${modeName}`, 'info', 3000);
            }
            if (mpHUD.inRoom && mpHUD.roomInfo) {
              mpHUD.roomInfo.mode = modeName;
              mpHUD.setInRoom(true, mpHUD.roomInfo);
            }
          } catch (err) {
            console.error('套用連線設定失敗:', err);
            showToast('套用連線設定失敗：' + err.message, 'warn');
          }
        },
      },
    });

    setupMultiplayerNetwork();

    // 綁定輸入控制器
    inputController = new InputController({
      boardElement: elBoard,
      controlsRoot: document.body,
      cellFromClient: (cx, cy) => renderer.cellFromClient(cx, cy),
      getRobots: () => {
        const active = currentMode === 'multi' && mpHUD?.inRoom ? roomState.gameState : soloGameState;
        return active?.grid ? active.getRobots() : {};
      },
      getSelected: () => selectedRobot,
      handlers: {
        select: (c) => selectRobot(c),
        move: (dir) => handleMove(dir),
        undo: () => handleUndo(),
        reset: () => handleReset(),
        next: () => handleNextRound(),
        newGame: () => handleNewGame(),
        confirm: () => {
          if (isVictory) handleNextRound();
        },
        cancel: () => {
          if (isVictory) hideModal();
        },
      },
    });
    inputController.attach();

    // 啟動單機第一局
    handleNewGame();
  } catch (err) {
    console.error('遊戲載入失敗:', err);
    if (elTargetText) {
      elTargetText.textContent = `載入失敗：${err.message}（請使用 HTTP 伺服器開啟，如 npm.cmd start）`;
    }
    showToast('遊戲載入失敗：' + err.message, 'warn', 5000);
  }
}

init();
